import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, describe } from 'vitest';
import request from 'supertest';
import webpush from 'web-push';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { hashSecret, newSecret, SESSION_COOKIE } from '../src/modules/auth.js';
import { deliverTelegramNotification, telegramNotifier } from '../src/modules/notifications.js';
import { deliverWebPush, webPushNotifier, type PushPayload } from '../src/modules/web-push.js';
import { featureFixture } from './helpers.js';

const testUrl = process.env.TEST_ALERT_DELIVERY_DATABASE_URL;
describe.skipIf(!testUrl)('alert delivery history (isolated PostgreSQL database)', () => {
  const db = createDatabase(testUrl ?? 'postgresql://localhost/airguard_alert_test');
  const config = { ...webpush.generateVAPIDKeys(), subject: 'mailto:airguard@example.test' };
  const prefix = `delivery-${randomUUID()}`;
  let telegramEnabled = false;
  const app = createApp({
    db, origin: 'https://airguard.example.test', webPush: config,
    notify: async (tx, incident) => {
      if (telegramEnabled) await telegramNotifier(true)(tx, incident);
      await webPushNotifier()(tx, incident);
    },
  });
  let f: Awaited<ReturnType<typeof featureFixture>>;
  beforeAll(async () => { f = await featureFixture(db, app, prefix); });
  afterAll(() => db.$disconnect());

  it('keeps one job, snapshots location, records retry and preserves user receipt and history after logout', async () => {
    const viewer = f.headers.viewer!;
    const operator = f.headers.operator!;
    const viewerUser = await db.user.findUniqueOrThrow({ where: { email: `${prefix}-viewer@test.local` } });
    const area = await db.monitoringArea.create({ data: { name: 'Khu ban đầu', nameKey: prefix } });
    const room = await db.monitoringRoom.create({ data: { name: 'Phòng ban đầu', nameKey: prefix, areaId: area.id } });
    await db.deviceRoomAssignment.create({ data: { roomId: room.id, deviceId: f.deviceId } });
    const endpoint = `https://fcm.googleapis.com/fcm/send/${prefix}`;
    expect((await request(app).post('/api/v1/push/subscription').set(viewer).send({
      subscription: { endpoint, keys: { p256dh: config.publicKey, auth: 'AAAAAAAAAAAAAAAAAAAAAA' } },
      application_server_key: config.publicKey, include_simulators: true,
    })).status).toBe(200);
    expect((await request(app).get('/api/v1/push/preferences').set(viewer)).body.data).toEqual({ show_details: false });

    const payload = f.payload(1);
    Object.assign(payload.readings[0]!.alert_snapshot, { gas: 'active', co: 'not_configured', flame: 'normal' });
    const send = () => request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(payload);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const incident = await db.alertIncident.findFirstOrThrow({ where: { deviceId: f.deviceId, condition: 'gas' } });
    const receipt = `/api/v1/alerts/incidents/${incident.id}/receipts`;
    const history = `/api/v1/alerts/delivery-history?device_id=${f.deviceId}`;
    expect(await db.webPushDelivery.count({ where: { incidentId: incident.id } })).toBe(1);
    expect((await request(app).get(history).set(operator)).body.data).toEqual([]);
    expect((await request(app).post(receipt).set('X-Requested-With', 'AirGuard')).status).toBe(401);
    expect((await request(app).post(receipt).set(operator).send({})).status).toBe(403);

    const [one, two] = await Promise.all([
      request(app).post(receipt).set(viewer).send({}),
      request(app).post(receipt).set(viewer).send({}),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.body.data).toEqual(two.body.data);
    expect(one.body.data).toMatchObject({ source: 'web', late: false });
    expect(await db.alertReceipt.count({ where: { incidentId: incident.id } })).toBe(1);
    expect(await db.alertAcknowledgement.count({ where: { incidentId: incident.id } })).toBe(0);
    expect((await db.alertIncident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(incident.status);
    expect((await request(app).get(receipt).set(viewer)).body.data.team).toBeUndefined();
    expect((await request(app).get(receipt).set(operator)).body.data.team).toHaveLength(1);

    const generic: PushPayload[] = [];
    const now = new Date();
    await deliverWebPush(db, config, async (_target, body) => {
      generic.push(body);
      return { ok: false, code: 'WEB_PUSH_NETWORK_ERROR', retryable: true };
    }, now);
    expect(generic).toEqual([{
      severity: incident.severity, condition: incident.condition, incident_id: incident.id, simulator: true,
      ended: false, url: `/app/alerts/${incident.id}`,
    }]);
    await db.monitoringRoom.update({ where: { id: room.id }, data: { name: 'Tên phòng mới' } });
    expect((await request(app).put('/api/v1/push/preferences').set(viewer).send({ show_details: true })).status).toBe(200);
    const detailed: PushPayload[] = [];
    await deliverWebPush(db, config, async (_target, body) => {
      detailed.push(body);
      expect((await request(app).post('/api/v1/auth/logout').set(viewer)).status).toBe(204);
      return { ok: true };
    }, new Date(now.getTime() + 60_000));
    expect(detailed[0]).toMatchObject({ version: 2, details: { location: 'Khu ban đầu / Phòng ban đầu' } });
    expect(await db.webPushDelivery.count({ where: { incidentId: incident.id } })).toBe(0);
    expect((await request(app).get(history).set(viewer)).status).toBe(401);
    const token = newSecret();
    await db.session.create({ data: { userId: viewerUser.id, tokenHash: hashSecret(token), expiresAt: new Date(Date.now() + 3600000) } });
    const relogin = { ...viewer, Cookie: `${SESSION_COOKIE}=${token}` };
    const response = await request(app).get(`${history}&channel=webpush&status=sent&limit=1`).set(relogin);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject([{
      attempt_count: 2, status: 'sent', location: 'Khu ban đầu / Phòng ban đầu',
      location_source: 'assignment', my_receipt: one.body.data,
      attempts: [{ number: 1, outcome: 'retry' }, { number: 2, outcome: 'sent' }],
    }]);
    expect(JSON.stringify(response.body)).not.toContain(endpoint);
    expect((await request(app).get('/api/v1/push/preferences').set(relogin)).body.data.show_details).toBe(true);
    expect((await request(app).post(receipt).set(relogin).send({})).body.data).toEqual(one.body.data);
  });

  it('links Telegram to the HTTPS incident and keeps workspace history admin-only', async () => {
    telegramEnabled = true;
    await db.deviceRoomAssignment.deleteMany({ where: { deviceId: f.deviceId } });
    await db.device.update({ where: { id: f.deviceId }, data: { location: 'Kệ mô phỏng' } });
    const payload = f.payload(2);
    Object.assign(payload.readings[0]!.alert_snapshot, { gas: 'active', co: 'active', flame: 'active' });
    expect((await request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(payload)).status).toBe(200);
    const incident = await db.alertIncident.findFirstOrThrow({ where: { deviceId: f.deviceId, condition: 'flame' } });
    const messages: string[] = [];
    const deliver = () => deliverTelegramNotification(db, async (message) => {
      messages.push(message);
      return { ok: true };
    }, new Date(), true, 'https://airguard.example.test');
    await Promise.all([deliver(), deliver()]);
    expect(messages).toHaveLength(2);
    expect(messages.find((text) => text.includes(`https://airguard.example.test/app/alerts/${incident.id}`)))
      .toContain(' · Kệ mô phỏng');
    const history = `/api/v1/alerts/delivery-history?device_id=${f.deviceId}&channel=telegram`;
    expect((await request(app).get(history).set(f.headers.operator!)).body.data).toEqual([]);
    const first = await request(app).get(`${history}&limit=1`).set(f.headers.admin!);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.meta.next_cursor).toMatch(/^\d+$/);
    const second = await request(app).get(`${history}&limit=1&cursor=${first.body.meta.next_cursor}`).set(f.headers.admin!);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta.next_cursor).toBeNull();
    const pages = [...first.body.data, ...second.body.data];
    expect(new Set(pages.map((row) => row.id)).size).toBe(2);
    expect(pages).toContainEqual(expect.objectContaining({
      incident_id: incident.id, location_source: 'device_location', status: 'sent',
    }));
    const ended = f.payload(3);
    Object.assign(ended.readings[0]!.alert_snapshot, { gas: 'active', co: 'not_configured', flame: 'normal' });
    expect((await request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(ended)).status).toBe(200);
    const receipt = await request(app).post(`/api/v1/alerts/incidents/${incident.id}/receipts`)
      .set(f.headers.operator!).send({});
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.late).toBe(true);
    expect((await db.alertIncident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe('ended');
  });
});
