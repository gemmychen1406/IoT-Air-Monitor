import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';
import { runMaintenance } from '../src/modules/maintenance.js';
import { hashSecret } from '../src/modules/auth.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('bounded retention and analytical rollups', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
  const app = createApp({ db, origin: 'http://localhost:5173' });
  let f: Awaited<ReturnType<typeof featureFixture>>;
  const now = new Date('2026-10-18T12:00:00Z');
  const from = '2026-10-01T00:00:00Z';
  const to = '2026-10-01T01:00:00Z';
  beforeAll(async () => {
    f = await featureFixture(db, app, 'maintenance');
    for (const [seq, temperature] of [
      [1, 20],
      [2, 30],
      [3, null],
      [4, 40],
    ] as const) {
      const time = new Date(Date.parse(from) + seq * 5000);
      const payload = f.payload(seq, time.getTime()).readings[0]!;
      payload.sensors.dht11 = {
        temperature_c: temperature,
        humidity_pct: temperature === null ? null : 60,
        quality: temperature === null ? 'invalid' : 'valid',
        age_ms: 0,
      };
      const row = await db.sensorReading.create({
        data: {
          deviceId: f.deviceId,
          bootId: f.bootId,
          bootCounter: 1n,
          seq: BigInt(seq),
          sampledAt: time,
          receivedAt: time,
          temperatureC: temperature,
          humidityPct: temperature === null ? null : 60,
          mq2Adc: 1200,
          mq7Adc: 900,
          payload,
          payloadHash: hashSecret(JSON.stringify(payload)),
        },
      });
      if (seq === 4)
        await db.device.update({ where: { id: f.deviceId }, data: { latestId: row.id } });
    }
  });
  afterAll(() => db.$disconnect());
  it('defaults to dry-run and leaves raw data untouched', async () => {
    const result = await runMaintenance(db, { now });
    expect(result).toMatchObject({ eligible: 3, removed: 0, dry_run: true });
    expect(await db.sensorReading.count({ where: { deviceId: f.deviceId } })).toBe(4);
  });
  it('rolls up deleted samples atomically, preserves latest and never double-counts on rerun', async () => {
    const result = await runMaintenance(db, { now, apply: true, batchSize: 2 });
    expect(result.removed).toBe(2);
    await runMaintenance(db, { now, apply: true, batchSize: 2 });
    expect((await runMaintenance(db, { now, apply: true })).removed).toBe(0);
    expect(await db.sensorReading.count({ where: { deviceId: f.deviceId } })).toBe(1);
    const analytics = await request(app)
      .get(
        `/api/v1/devices/${f.deviceId}/analytics?from=${from}&to=${to}&metric=temperature_c&bucket=hour`,
      )
      .set(f.headers.viewer!);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.summary).toMatchObject({
      total_count: 4,
      valid_count: 3,
      invalid_count: 1,
      min: 20,
      max: 40,
      average: 30,
    });
    expect(analytics.body.data.uses_rollups).toBe(true);
    const received = await request(app)
      .get(
        `/api/v1/devices/${f.deviceId}/analytics?from=${from}&to=${to}&metric=temperature_c&bucket=minute&time_basis=received`,
      )
      .set(f.headers.viewer!);
    expect(received.body.data.summary.average).toBe(30);
  });
  it('refuses a misleading partial-bucket summary or incomplete raw CSV after retention', async () => {
    const partial = await request(app)
      .get(
        `/api/v1/devices/${f.deviceId}/analytics?from=2026-10-01T00:00:02Z&to=${to}&metric=temperature_c&bucket=hour`,
      )
      .set(f.headers.viewer!);
    expect(partial.status).toBe(422);
    const csv = await request(app)
      .get(`/api/v1/devices/${f.deviceId}/readings/export?from=${from}&to=${to}`)
      .set(f.headers.viewer!);
    expect(csv.status).toBe(409);
  });
  it('prunes expired audit/status in bounded batches but preserves incident evidence', async () => {
    const old = new Date('2024-01-01T00:00:00Z');
    const log = await db.auditLog.create({
      data: { action: 'old.audit', deviceId: f.deviceId, metadata: {}, createdAt: old },
    });
    const status = await db.deviceStatusHistory.create({
      data: {
        deviceId: f.deviceId,
        previousStatus: 'online',
        newStatus: 'offline',
        reason: 'heartbeat_timeout',
        effectiveAt: old,
        detectedAt: old,
      },
    });
    const incident = await db.alertIncident.create({
      data: {
        deviceId: f.deviceId,
        condition: 'gas',
        severity: 'warning',
        origin: 'event',
        firstObservedAt: old,
      },
    });
    const preview = await runMaintenance(db, { now });
    expect(preview).toMatchObject({
      eligible_audit: 1,
      eligible_status: 1,
      pruned_audit: 0,
      pruned_status: 0,
    });
    expect(await db.auditLog.findUnique({ where: { id: log.id } })).not.toBeNull();
    await runMaintenance(db, { now, apply: true });
    expect(await db.auditLog.findUnique({ where: { id: log.id } })).toBeNull();
    expect(await db.deviceStatusHistory.findUnique({ where: { id: status.id } })).toBeNull();
    expect(await db.alertIncident.findUnique({ where: { id: incident.id } })).not.toBeNull();
  });
});
