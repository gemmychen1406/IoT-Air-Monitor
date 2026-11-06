import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';
import { telegramNotifier, deliverTelegramNotification } from '../src/modules/notifications.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('durable Telegram notifications', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
  const options = { db, origin: 'http://localhost:5173', notify: telegramNotifier(true) };
  const app = createApp(options);
  let f: Awaited<ReturnType<typeof featureFixture>>;
  beforeAll(async () => {
    f = await featureFixture(db, app, 'telegram');
  });
  afterAll(() => db.$disconnect());
  const send = (p: ReturnType<typeof f.payload>) =>
    request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(p);
  it('queues warning/critical once per incident and severity, never once per telemetry retry', async () => {
    const p = f.payload(1);
    Object.assign(p.readings[0]!.alert_snapshot, {
      gas: 'active',
      co: 'active',
      flame: 'active',
      buzzer_commanded_on: true,
    });
    p.readings[0]!.sensors.flame.detected = true;
    expect((await send(p)).status).toBe(200);
    expect((await send(p)).status).toBe(200);
    const next = structuredClone(p);
    next.readings[0]!.seq = '2';
    expect((await send(next)).status).toBe(200);
    const rows = await db.telegramNotification.findMany({
      where: { incident: { deviceId: f.deviceId } },
    });
    expect(rows.map((r) => r.severity).sort()).toEqual(['critical', 'warning', 'warning']);
  });
  it('rolls back queued notifications with a conflicting telemetry batch', async () => {
    const other = await featureFixture(db, app, 'telegram-rollback');
    const p = other.payload(1);
    p.readings[0]!.alert_snapshot.flame = 'active';
    const conflict = structuredClone(p.readings[0]!);
    conflict.sensors.dht11.temperature_c = 99;
    expect(
      (
        await request(app)
          .post('/api/v1/device/telemetry')
          .set(other.deviceHeaders)
          .send({ ...p, readings: [p.readings[0], conflict] })
      ).status,
    ).toBe(409);
    expect(
      await db.telegramNotification.count({ where: { incident: { deviceId: other.deviceId } } }),
    ).toBe(0);
  });
  it('filters simulator notifications unless explicitly included and does nothing when disabled', async () => {
    for (const [name, notify] of [
      ['telegram-disabled', undefined],
      ['telegram-no-simulator', telegramNotifier(false)],
    ] as const) {
      const configured = createApp({ db, origin: 'http://localhost:5173', ...{ notify } });
      const other = await featureFixture(db, configured, name);
      const p = other.payload(1);
      p.readings[0]!.alert_snapshot.flame = 'active';
      expect(
        (
          await request(configured)
            .post('/api/v1/device/telemetry')
            .set(other.deviceHeaders)
            .send(p)
        ).status,
      ).toBe(200);
      expect(
        await db.telegramNotification.count({ where: { incident: { deviceId: other.deviceId } } }),
      ).toBe(0);
    }
  });
  it('queues an escalation from warning to critical through a linked durable event', async () => {
    const p = f.payload(3);
    const externalId = randomUUID();
    const snapshot = {
      ...p.readings[0]!.alert_snapshot,
      gas: 'active',
      incident_ids: { gas: externalId },
    };
    p.readings[0]!.alert_snapshot = snapshot;
    expect((await send(p)).status).toBe(200);
    const event = {
      event_id: randomUUID(),
      incident_id: externalId,
      condition: 'gas',
      severity: 'critical',
      transition: 'started',
      boot_id: f.bootId,
      boot_counter: '1',
      seq: '1',
      occurred_at: new Date(f.base + 5000).toISOString(),
    };
    const post = () =>
      request(app)
        .post('/api/v1/device/events')
        .set(f.deviceHeaders)
        .send({ schema_version: 1, device_id: f.deviceId, events: [event] });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(
      await db.telegramNotification.count({
        where: { incident: { deviceId: f.deviceId, condition: 'gas' } },
      }),
    ).toBe(2);
  });
  it('leases work across concurrent workers and retries with backoff after restart', async () => {
    const messages: string[] = [];
    const now = new Date();
    const worker = () =>
      deliverTelegramNotification(
        db,
        async (text) => {
          messages.push(text);
          return { ok: true };
        },
        now,
      );
    const results = await Promise.all([worker(), worker()]);
    expect(results.every((r) => r.processed)).toBe(true);
    expect(new Set(results.flatMap((r) => (r.processed ? [r.notificationId] : []))).size).toBe(2);
    expect(messages).toHaveLength(2);
    expect(messages.every((text) => text.includes('MÔ PHỎNG') && text.includes('Sự cố'))).toBe(
      true,
    );
    const third = await db.telegramNotification.findFirstOrThrow({ where: { status: 'pending' } });
    await deliverTelegramNotification(
      db,
      async () => ({
        ok: false,
        retryable: true,
        code: 'TELEGRAM_RATE_LIMITED',
        retryAfterSeconds: 30,
      }),
      now,
    );
    const retry = await db.telegramNotification.findUniqueOrThrow({ where: { id: third.id } });
    expect(retry.status).toBe('pending');
    expect(retry.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + 30000);
    expect(retry.lastErrorCode).toBe('TELEGRAM_RATE_LIMITED');
    await deliverTelegramNotification(
      db,
      async () => ({ ok: true }),
      new Date(now.getTime() + 31000),
    );
    // An unsent row can be recovered by a fresh worker after lease expiry.
    await db.telegramNotification.updateMany({
      where: { status: 'pending' },
      data: {
        status: 'sending',
        leaseUntil: new Date(now.getTime() - 1000),
        leaseToken: randomUUID(),
      },
    });
    await deliverTelegramNotification(
      db,
      async () => ({ ok: true }),
      new Date(now.getTime() + 32000),
    );
    expect(await db.telegramNotification.count({ where: { status: 'sent' } })).toBe(4);
  });
  it('keeps the outbox atomic when a later condition conflicts after another notification was queued', async () => {
    const other = await featureFixture(db, app, 'telegram-condition-conflict');
    const initial = other.payload(1);
    const snapshot = {
      ...initial.readings[0]!.alert_snapshot,
      flame: 'active',
      incident_ids: { flame: randomUUID() },
    };
    initial.readings[0]!.alert_snapshot = snapshot;
    expect(
      (await request(app).post('/api/v1/device/telemetry').set(other.deviceHeaders).send(initial))
        .status,
    ).toBe(200);
    const next = other.payload(2);
    const conflict = {
      ...next.readings[0]!.alert_snapshot,
      gas: 'active',
      flame: 'active',
      incident_ids: { flame: randomUUID() },
    };
    next.readings[0]!.alert_snapshot = conflict;
    expect(
      (await request(app).post('/api/v1/device/telemetry').set(other.deviceHeaders).send(next))
        .status,
    ).toBe(409);
    expect(
      await db.telegramNotification.count({ where: { incident: { deviceId: other.deviceId } } }),
    ).toBe(1);
    expect(
      await db.alertIncident.count({ where: { deviceId: other.deviceId, condition: 'gas' } }),
    ).toBe(0);
    // Isolate the remaining delivery tests from this intentionally pending row.
    await db.telegramNotification.updateMany({
      where: { incident: { deviceId: other.deviceId } },
      data: { status: 'sent' },
    });
  });
  it('expires old jobs and stops retrying permanent errors or exhausted attempts', async () => {
    const incident = await db.alertIncident.create({
      data: {
        deviceId: f.deviceId,
        condition: 'co',
        severity: 'warning',
        origin: 'event',
        status: 'ended',
      },
    });
    const now = new Date();
    const expired = await db.telegramNotification.create({
      data: {
        incidentId: incident.id,
        severity: 'warning',
        expiresAt: new Date(now.getTime() - 1),
      },
    });
    const empty = await deliverTelegramNotification(
      db,
      async () => {
        throw new Error('Expired job must not send');
      },
      now,
    );
    expect(empty.processed).toBe(false);
    expect(
      (await db.telegramNotification.findUniqueOrThrow({ where: { id: expired.id } })).status,
    ).toBe('expired');
    const critical = await db.telegramNotification.create({
      data: {
        incidentId: incident.id,
        severity: 'critical',
        attempts: 7,
        expiresAt: new Date(now.getTime() + 3600000),
      },
    });
    await deliverTelegramNotification(
      db,
      async () => ({ ok: false, retryable: true, code: 'TELEGRAM_NETWORK_ERROR' }),
      new Date(now.getTime() + 100),
    );
    expect(
      (await db.telegramNotification.findUniqueOrThrow({ where: { id: critical.id } })).status,
    ).toBe('failed');
    await db.telegramNotification.update({
      where: { id: critical.id },
      data: { status: 'pending', attempts: 0, nextAttemptAt: now },
    });
    await deliverTelegramNotification(
      db,
      async () => ({ ok: false, retryable: false, code: 'TELEGRAM_HTTP_403' }),
      new Date(now.getTime() + 200),
    );
    expect(
      (await db.telegramNotification.findUniqueOrThrow({ where: { id: critical.id } })).status,
    ).toBe('failed');
  });
  it('does not deliver previously queued simulator jobs after simulator notifications are disabled', async () => {
    const row = await db.telegramNotification.findFirstOrThrow({ where: { status: 'failed' } });
    const now = new Date();
    await db.telegramNotification.update({
      where: { id: row.id },
      data: {
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        expiresAt: new Date(now.getTime() + 3600000),
      },
    });
    let sent = 0;
    await deliverTelegramNotification(
      db,
      async () => {
        sent++;
        return { ok: true };
      },
      now,
      false,
    );
    expect(sent).toBe(0);
    expect(
      (await db.telegramNotification.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('skipped');
  });
  it('still sends physical-device warning notifications while simulator delivery is excluded', async () => {
    const physicalApp = createApp({
      db,
      origin: 'http://localhost:5173',
      notify: telegramNotifier(false),
    });
    const device = await request(physicalApp)
      .post('/api/v1/devices')
      .set(f.headers.admin!)
      .send({ name: 'Telegram physical fixture', source_kind: 'physical' });
    expect(device.status).toBe(201);
    const credential = await request(physicalApp)
      .post(`/api/v1/devices/${device.body.data.id}/credentials`)
      .set(f.headers.admin!);
    const p = f.payload(1);
    p.device_id = device.body.data.id;
    p.readings[0]!.alert_snapshot.gas = 'active';
    expect(
      (
        await request(physicalApp)
          .post('/api/v1/device/telemetry')
          .set('Authorization', `DeviceKey ${credential.body.data.key}`)
          .send(p)
      ).status,
    ).toBe(200);
    let text = '';
    const result = await deliverTelegramNotification(
      db,
      async (message) => {
        text = message;
        return { ok: true };
      },
      new Date(),
      false,
    );
    expect(result.processed).toBe(true);
    expect(text).toContain('WARNING');
    expect(text).toContain('Telegram physical fixture');
    expect(text).not.toContain('MÔ PHỎNG');
  });
});
