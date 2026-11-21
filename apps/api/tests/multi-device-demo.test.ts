import { scheduleCriticalReminders } from '../src/modules/alert-delivery/reminders.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import webpush from 'web-push';
import { createDatabase } from '@iot/database';
import { buildPayload } from '../../../tools/device-simulator/src/payload.js';
import { parseScenario, type ReplayValues } from '../../../tools/device-simulator/src/replay.js';
import { createApp } from '../src/app.js';
import { hashSecret, newSecret, SESSION_COOKIE } from '../src/modules/auth.js';
import { deliverTelegramNotification, telegramNotifier } from '../src/modules/notifications.js';
import { deliverWebPush, webPushNotifier } from '../src/modules/web-push.js';
import { featureFixture } from './helpers.js';

const testUrl = process.env.TEST_MULTI_DEVICE_DATABASE_URL;
const origin = 'https://airguard.example.test';
const sample = (file: string, pick: (value: ReplayValues) => boolean) => {
  const scenario = readFileSync(
    new URL(`../../../tools/device-simulator/scenarios/${file}`, import.meta.url),
    'utf8',
  );
  return parseScenario(scenario).samples.find(({ values }) => pick(values))!.values;
};

describe.skipIf(!testUrl)('multi-device AirGuard demo', () => {
  const db = createDatabase(testUrl ?? 'postgresql://localhost/airguard_multi_test');
  const push = {
    ...webpush.generateVAPIDKeys(),
    subject: 'mailto:demo@example.test',
  };
  const app = createApp({
    db,
    origin,
    webPush: push,
    notify: async (tx, incident) => {
      await telegramNotifier(true)(tx, incident);
      await webPushNotifier()(tx, incident);
    },
  });
  const prefix = `multi-${randomUUID()}`;
  afterAll(() => db.$disconnect());

  const gas = sample('gas-warning.json', (row) => row.gas === 'active');
  const flame = sample('incident.json', (row) => row.flame === 'active');
  const normal = sample('incident.json', (row) => row.flame === 'normal');

  type Sensor = Pick<
    Awaited<ReturnType<typeof featureFixture>>,
    'deviceId' | 'bootId' | 'deviceHeaders'
  >;

  async function postSample(f: Sensor, seq: number, value: ReplayValues) {
    const payload = buildPayload({
      deviceId: f.deviceId,
      bootId: f.bootId,
      bootCounter: '1',
      seq: String(seq),
      uptime: seq * 5000,
      now: new Date(),
      sample: value,
    });
    const result = await request(app)
      .post('/api/v1/device/telemetry')
      .set(f.deviceHeaders)
      .send(payload);
    expect(result.status).toBe(200);
  }

  it('maps distinct sensors and open incidents to their assigned rooms and scopes delivery history by incident', async () => {
    const gasDevice = await featureFixture(db, app, `${prefix}-gas`);
    const admin = gasDevice.headers.admin!;
    const api = request(app);
    async function createSensor(name: string): Promise<Sensor> {
      const created = await api
        .post('/api/v1/devices')
        .set(admin)
        .send({ name, source_kind: 'simulator' });
      expect(created.status).toBe(201);
      const deviceId = created.body.data.id as string;
      const credential = await api.post(`/api/v1/devices/${deviceId}/credentials`).set(admin);
      expect(credential.status).toBe(201);
      return {
        deviceId,
        bootId: randomUUID(),
        deviceHeaders: {
          Authorization: `DeviceKey ${credential.body.data.key}`,
        },
      };
    }
    const [temperature, flameDevice, connectivity] = await Promise.all(
      ['temperature', 'flame', 'connectivity'].map((name) => createSensor(`${prefix}-${name}`)),
    );
    const devices = [temperature!, gasDevice, flameDevice!, connectivity!];
    const area = (await api.post('/api/v1/spaces/areas').set(admin).send({ name: prefix })).body
      .data;
    const roomA = (
      await api.post('/api/v1/spaces/rooms').set(admin).send({ name: 'Room A', area_id: area.id })
    ).body.data;
    const roomB = (
      await api.post('/api/v1/spaces/rooms').set(admin).send({ name: 'Room B', area_id: area.id })
    ).body.data;
    const spaces = (await api.get('/api/v1/spaces').set(admin)).body.data;
    for (const [index, device] of devices.entries()) {
      expect(
        spaces.devices.find((row: { id: string }) => row.id === device.deviceId).room_id,
      ).toBeNull();
      const room = index < 2 ? roomA : roomB;
      expect(
        (
          await api
            .put(`/api/v1/spaces/devices/${device.deviceId}/room`)
            .set(admin)
            .send({ room_id: room.id })
        ).status,
      ).toBe(200);
      expect(
        (
          await api
            .put(`/api/v1/spaces/devices/${device.deviceId}/position`)
            .set(admin)
            .send({ room_id: room.id, x: index % 2 ? 0.7 : 0.3, y: 0.5 })
        ).status,
      ).toBe(200);
    }
    await Promise.all([
      postSample(
        temperature!,
        1,
        sample('environment.json', (row) => row.temperature_c === 36),
      ),
      postSample(gasDevice!, 1, gas),
      postSample(flameDevice!, 1, flame),
      postSample(
        connectivity!,
        1,
        sample('connectivity.json', () => true),
      ),
    ]);
    const mapUrl = `/api/v1/spaces/areas/${area.id}/map`;
    const map = (await api.get(mapUrl).set(admin)).body.data;
    const mapRoomA = map.rooms.find((room: { id: string }) => room.id === roomA.id);
    const mapRoomB = map.rooms.find((room: { id: string }) => room.id === roomB.id);
    expect(mapRoomA.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: temperature!.deviceId,
          status: 'online',
          open_incidents: [],
        }),
        expect.objectContaining({
          id: gasDevice!.deviceId,
          status: 'online',
          open_incidents: [expect.objectContaining({ condition: 'gas', severity: 'warning' })],
        }),
      ]),
    );
    expect(mapRoomB.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: connectivity!.deviceId,
          status: 'online',
          open_incidents: [],
        }),
        expect.objectContaining({
          id: flameDevice!.deviceId,
          status: 'online',
          open_incidents: [
            expect.objectContaining({
              condition: 'flame',
              severity: 'critical',
            }),
          ],
        }),
      ]),
    );
    const messages: string[] = [];
    for (let index = 0; index < 2; index++) {
      await deliverTelegramNotification(
        db,
        async (text) => {
          messages.push(text);
          return { ok: true };
        },
        new Date(),
        true,
        origin,
      );
    }
    for (const [device, room, condition] of [
      [gasDevice!, roomA, 'gas'],
      [flameDevice!, roomB, 'flame'],
    ] as const) {
      const before = (
        await api.get(`/api/v1/alerts/incidents?device_id=${device.deviceId}`).set(admin)
      ).body.data;
      expect(before).toHaveLength(1);
      expect(before[0].condition).toBe(condition);
      const id = before[0].id;
      expect(
        (await api.get(`/api/v1/alerts/incidents/${id}/support`).set(admin)).body.data.location,
      ).toMatchObject({ room_name: room.name, area_name: prefix });
      expect(
        (await api.get(`/api/v1/alerts/delivery-history?incident_id=${id}`).set(admin)).body.data,
      ).toMatchObject([
        {
          incident_id: id,
          condition,
          channel: 'telegram',
          location: `${prefix} / ${room.name}`,
        },
      ]);
      const sent = messages.filter(text => text.includes(`/app/alerts/${id}`));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain(condition === 'flame' ? '🔥 Phát hiện lửa' : '⚠️ Phát hiện khí gas');
      expect(sent[0]).toContain(`${prefix} / ${room.name}`);
      await api.put(`/api/v1/spaces/devices/${device.deviceId}/room`).set(admin)
        .send({room_id:null,expected_room_id:room.id}).expect(200);
      const history=(await api.get(`/api/v1/alerts/delivery-history?incident_id=${id}`).set(admin)).body.data;
      expect(history[0].location).toBe(`${prefix} / ${room.name}`);
      expect(await db.deviceRoomAssignment.findUnique({where:{deviceId:device.deviceId}})).toBeNull();
    }
    await postSample(flameDevice!, 2, normal);
    expect(
      (await api.get(`/api/v1/alerts/incidents?device_id=${flameDevice!.deviceId}`).set(admin)).body
        .data[0].status,
    ).toBe('ended');
    expect(
      (await api.get(`/api/v1/alerts/incidents?device_id=${gasDevice!.deviceId}`).set(admin)).body
        .data[0].status,
    ).toBe('active');
  });

  it('sends a single WARNING to two browser subscriptions and one Telegram group and records retries on the same delivery', async () => {
    const name = `${prefix}-fanout`;
    const f = await featureFixture(db, app, name);
    const admin = f.headers.admin!;
    const user = await db.user.findUniqueOrThrow({
      where: { email: `${name}-admin@test.local` },
    });
    const token = newSecret();
    const second = { ...admin, Cookie: `${SESSION_COOKIE}=${token}` };
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const endpoints = ['edge', 'chrome'].map(
      (kind) => `https://fcm.googleapis.com/fcm/send/${kind}-${prefix}`,
    );
    for (const [index, headers] of [admin, second].entries()) {
      const registration = await request(app)
        .post('/api/v1/push/subscription')
        .set(headers)
        .send({
          subscription: {
            endpoint: endpoints[index],
            keys: { p256dh: push.publicKey, auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
          },
          application_server_key: push.publicKey,
          include_simulators: true,
        });
      expect(registration.status).toBe(200);
    }
    await postSample(f, 1, gas);
    await postSample(f, 2, gas);
    const incident = await db.alertIncident.findFirstOrThrow({
      where: { deviceId: f.deviceId },
    });
    expect(incident.severity).toBe('warning');
    expect(await db.alertIncident.count({ where: { deviceId: f.deviceId } })).toBe(1);
    const history = `/api/v1/alerts/delivery-history?incident_id=${incident.id}`;
    const initial = (await request(app).get(history).set(admin)).body.data;
    expect(initial).toHaveLength(3);
    expect(initial.filter((row: { channel: string }) => row.channel === 'webpush')).toHaveLength(2);
    const calls: string[] = [];
    const mockPush = (success: boolean) => async (target: { endpoint: string }) => {
      calls.push(target.endpoint);
      return success
        ? { ok: true as const }
        : {
            ok: false as const,
            retryable: true,
            code: 'WEB_PUSH_NETWORK_ERROR',
          };
    };
    const now = new Date();
    await deliverWebPush(db, push, mockPush(false), now);
    await deliverWebPush(db, push, mockPush(true), now);
    await deliverWebPush(db, push, mockPush(true), new Date(now.getTime() + 10000));
    const group: string[] = [];
    await deliverTelegramNotification(
      db,
      async (text) => {
        group.push(text);
        return { ok: true };
      },
      now,
      true,
      origin,
    );
    expect(new Set(calls)).toEqual(new Set(endpoints));
    expect(calls).toHaveLength(3);
    expect(group).toHaveLength(1);
    expect(group[0]).toContain(`/app/alerts/${incident.id}`);
    const final = (await request(app).get(history).set(admin)).body.data;
    expect(final.map((row: { id: string }) => row.id)).toEqual(
      initial.map((row: { id: string }) => row.id),
    );
    expect(final.every((row: { status: string }) => row.status === 'sent')).toBe(true);
    expect(
      final.find((row: { attempt_count: number }) => row.attempt_count === 2).attempts,
    ).toMatchObject([
      { number: 1, outcome: 'retry' },
      { number: 2, outcome: 'sent' },
    ]);
    expect((await request(app).get(history).set(f.headers.viewer!)).body.data).toEqual([]);
  });
  it('deduplicates critical rounds and suppresses queued reminders after receipt or recovery', async () => {
    const f = await featureFixture(db, app, prefix + '-remind');
    await postSample(f, 1, flame);
    const incident = await db.alertIncident.findFirstOrThrow({ where: { deviceId: f.deviceId } });
    const calls: string[] = [];
    const send = async (text: string) => {
      calls.push(text);
      return { ok: true as const };
    };
    const clock = new Date(Date.now() + 1000);
    await deliverTelegramNotification(db, send, clock);
    const next = new Date(clock.getTime() + 11000);
    const schedule = (at: Date) => scheduleCriticalReminders(db, 'telegram', 10, at);
    await Promise.all([schedule(next), schedule(next)]);
    expect(
      await db.telegramNotification.count({ where: { incidentId: incident.id, round: 1 } }),
    ).toBe(1);
    await deliverTelegramNotification(db, send, next);
    expect(calls.at(-1)).toContain('Nhắc lại · lần 1');
    const later = new Date(next.getTime() + 11000);
    await schedule(later);
    await request(app)
      .post(`/api/v1/alerts/incidents/${incident.id}/receipts`)
      .set(f.headers.admin!)
      .send({})
      .expect(200);
    await deliverTelegramNotification(db, send, later);
    expect(calls.length).toBe(2);
    expect(
      await db.telegramNotification.findFirst({ where: { incidentId: incident.id, round: 2 } }),
    ).toMatchObject({ status: 'skipped', lastErrorCode: 'REMINDER_STOPPED' });
    await postSample(f, 2, normal);
    await postSample(f, 3, flame);
    await deliverTelegramNotification(db, send, later);
    const final = new Date(later.getTime() + 11000);
    await schedule(final);
    await postSample(f, 4, normal);
    await deliverTelegramNotification(db, send, final);
    expect(calls.length).toBe(3);
  });

  it('a receipt cancels only its own queued critical Push while the other device still receives a reminder', async () => {
    // Reuse the signed-in fixture strategy without adding extra logins to the rate-limited app.
    const app = createApp({ db, origin, webPush: push, notify: webPushNotifier() });
    const f = await featureFixture(db, app, prefix + '-paired');
    const admin = f.headers.admin!;
    const api = request(app);
    const second = (
      await api
        .post('/api/v1/devices')
        .set(admin)
        .send({ name: 'second', source_kind: 'simulator' })
    ).body.data.id;
    const key = (await api.post(`/api/v1/devices/${second}/credentials`).set(admin)).body.data.key;
    const sub = (
      await api
        .post('/api/v1/push/subscription')
        .set(admin)
        .send({
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/' + randomUUID(),
            keys: { p256dh: push.publicKey, auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
          },
          persistent: true,
          application_server_key: push.publicKey,
          include_simulators: true,
          device_ids: [f.deviceId, second],
        })
    ).body.data.id;
    await postSample(f, 1, flame);
    const other = {
      deviceId: second,
      bootId: randomUUID(),
      deviceHeaders: { Authorization: 'DeviceKey ' + key },
    };
    await postSample(other, 1, flame);
    const incidents = await db.alertIncident.findMany({
      where: { deviceId: { in: [f.deviceId, second] } },
    });
    const mine = incidents.find((i) => i.deviceId === f.deviceId)!;
    const theirs = incidents.find((i) => i.deviceId === second)!;
    const clock = new Date(Date.now() + 1000);
    const send = async (_t: unknown, p: { incident_id: string; round?: number }) => {
      if (p.round) reminders.push(p.incident_id);
      return { ok: true as const };
    };
    const reminders: string[] = [];
    // Other receivers from the earlier fanout also have jobs in this isolated database.
    async function drain(at: Date) {
      for (let n = 0; n < 30; n++)
        if (!(await deliverWebPush(db, push, send, at)).processed) return;
      throw new Error('Push queue did not drain');
    }
    await drain(clock);
    const next = new Date(clock.getTime() + 11000);
    await Promise.all([1, 2].map(() => scheduleCriticalReminders(db, 'webpush', 10, next)));
    await api.post(`/api/v1/alerts/incidents/${mine.id}/receipts`).set(admin).send({}).expect(200);
    await drain(next);
    expect(reminders).toContain(theirs.id);
    expect(reminders).not.toContain(mine.id);
    expect(
      await db.webPushDelivery.count({
        where: { incidentId: theirs.id, subscriptionId: sub, round: 1, status: 'sent' },
      }),
    ).toBe(1);
  });
});
