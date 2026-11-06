import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('incident lifecycle and durable events', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
  const app = createApp({ db, origin: 'http://localhost:5173' });
  let f: Awaited<ReturnType<typeof featureFixture>>;
  let incidentId: string;
  beforeAll(async () => {
    f = await featureFixture(db, app, 'alerts');
  });
  afterAll(() => db.$disconnect());
  const incidents = () =>
    request(app).get(`/api/v1/alerts/incidents?device_id=${f.deviceId}`).set(f.headers.admin!);
  const send = (p: ReturnType<typeof f.payload>) =>
    request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(p);

  it('creates a single incident from a reported active snapshot despite concurrent retries', async () => {
    const p = f.payload(1);
    p.readings[0]!.alert_snapshot.flame = 'active';
    p.readings[0]!.alert_snapshot.buzzer_commanded_on = true;
    p.readings[0]!.sensors.flame.detected = true;
    const responses = await Promise.all([send(p), send(p), send(p)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const list = await incidents();
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      condition: 'flame',
      status: 'active',
      origin: 'snapshot',
      source_kind: 'simulator',
      acknowledgement: null,
    });
    incidentId = list.body.data[0].id;
    const detail = await request(app)
      .get(`/api/v1/alerts/incidents/${incidentId}`)
      .set(f.headers.viewer!);
    expect(detail.body.data.events).toHaveLength(1);
    expect(detail.body.data.events[0].transition).toBe('started');
  });
  it('acknowledges once with operator identity, without clearing the alert or buzzer', async () => {
    const url = `/api/v1/alerts/incidents/${incidentId}/acknowledgements`;
    expect(
      (await request(app).post(url).set(f.headers.viewer!).send({ note: 'not allowed' })).status,
    ).toBe(403);
    const results = await Promise.all([
      request(app).post(url).set(f.headers.operator!).send({ note: 'Đã xem' }),
      request(app).post(url).set(f.headers.admin!).send({ note: 'Đã xem lại' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const detail = await request(app)
      .get(`/api/v1/alerts/incidents/${incidentId}`)
      .set(f.headers.viewer!);
    expect(detail.body.data.status).toBe('active');
    expect(detail.body.data.acknowledgement.user.email).toMatch(
      /^alerts-(operator|admin)@test.local$/,
    );
    expect(await db.alertAcknowledgement.count({ where: { incidentId } })).toBe(1);
    const unacknowledged = await request(app)
      .get(`/api/v1/alerts/events?device_id=${f.deviceId}&acknowledged=false`)
      .set(f.headers.viewer!);
    expect(unacknowledged.body.data).toHaveLength(0);
    const latest = await request(app)
      .get(`/api/v1/devices/${f.deviceId}/readings/latest`)
      .set(f.headers.viewer!);
    expect(latest.body.data.payload.alert_snapshot.buzzer_commanded_on).toBe(true);
  });
  it('keeps an incident unresolved during sensor fault and ends only on a later normal report', async () => {
    const fault = f.payload(2);
    fault.readings[0]!.sensors.flame = { detected: null, quality: 'invalid', age_ms: 0 };
    fault.readings[0]!.alert_snapshot.flame = 'unknown';
    expect((await send(fault)).status).toBe(200);
    expect((await incidents()).body.data[0].status).toBe('active');
    expect((await send(f.payload(3))).status).toBe(200);
    const detail = await request(app)
      .get(`/api/v1/alerts/incidents/${incidentId}`)
      .set(f.headers.viewer!);
    expect(detail.body.data.status).toBe('ended');
    expect(detail.body.data.events.map((e: { transition: string }) => e.transition)).toEqual([
      'started',
      'ended',
    ]);
    expect(detail.body.data.ended_at).toBe(new Date(f.base + 15000).toISOString());
    const old = f.payload(0);
    old.readings[0]!.alert_snapshot.flame = 'active';
    expect((await send(old)).status).toBe(200);
    expect((await incidents()).body.data).toHaveLength(1);
    expect((await incidents()).body.data[0].status).toBe('ended');
  });
  it('preserves an offline incident whose end event arrives before its start, and deduplicates events', async () => {
    const externalId = randomUUID();
    const common = {
      incident_id: externalId,
      condition: 'gas',
      severity: 'warning',
      boot_id: f.bootId,
      boot_counter: '1',
    };
    const end = {
      ...common,
      event_id: randomUUID(),
      transition: 'ended',
      seq: '12',
      occurred_at: new Date(f.base + 60000).toISOString(),
    };
    const start = {
      ...common,
      event_id: randomUUID(),
      transition: 'started',
      seq: '10',
      occurred_at: new Date(f.base + 50000).toISOString(),
    };
    const post = (events: object[]) =>
      request(app)
        .post('/api/v1/device/events')
        .set(f.deviceHeaders)
        .send({ schema_version: 1, device_id: f.deviceId, events });
    expect((await post([end])).status).toBe(200);
    expect((await post([start])).status).toBe(200);
    expect((await post([start, end])).status).toBe(200);
    const list = await request(app)
      .get(`/api/v1/alerts/incidents?device_id=${f.deviceId}&condition=gas&status=ended`)
      .set(f.headers.viewer!);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      external_id: externalId,
      started_at: start.occurred_at,
      ended_at: end.occurred_at,
      status: 'ended',
    });
    const detail = await request(app)
      .get(`/api/v1/alerts/incidents/${list.body.data[0].id}`)
      .set(f.headers.viewer!);
    expect(detail.body.data.events).toHaveLength(2);
    expect((await post([{ ...start, severity: 'critical' }])).status).toBe(409);
  });
  it('links snapshot and explicit events using a firmware incident ID instead of creating two incidents', async () => {
    const externalId = randomUUID();
    const p = f.payload(20);
    const snapshot = {
      ...p.readings[0]!.alert_snapshot,
      flame: 'active',
      incident_ids: { flame: externalId },
    };
    expect(
      (
        await request(app)
          .post('/api/v1/device/telemetry')
          .set(f.deviceHeaders)
          .send({ ...p, readings: [{ ...p.readings[0], alert_snapshot: snapshot }] })
      ).status,
    ).toBe(200);
    const event = {
      event_id: randomUUID(),
      incident_id: externalId,
      condition: 'flame',
      severity: 'critical',
      boot_id: f.bootId,
      boot_counter: '1',
      seq: '20',
      transition: 'started',
      occurred_at: p.readings[0]!.sampled_at,
    };
    expect(
      (
        await request(app)
          .post('/api/v1/device/events')
          .set(f.deviceHeaders)
          .send({ schema_version: 1, device_id: f.deviceId, events: [event] })
      ).status,
    ).toBe(200);
    const rows = (await incidents()).body.data;
    expect(rows.filter((i: { external_id: string }) => i.external_id === externalId)).toHaveLength(
      1,
    );
    const states = await request(app)
      .get(`/api/v1/alerts/states?device_id=${f.deviceId}`)
      .set(f.headers.viewer!);
    expect(states.body.data.find((s: { condition: string }) => s.condition === 'flame').state).toBe(
      'active',
    );
  });
  it('rejects contradictory boot identity for an explicit event without creating an incident', async () => {
    const event = {
      event_id: randomUUID(),
      incident_id: randomUUID(),
      condition: 'co',
      severity: 'warning',
      boot_id: randomUUID(),
      boot_counter: '1',
      seq: '50',
      transition: 'started',
      occurred_at: new Date(f.base + 250000).toISOString(),
    };
    const res = await request(app)
      .post('/api/v1/device/events')
      .set(f.deviceHeaders)
      .send({ schema_version: 1, device_id: f.deviceId, events: [event] });
    expect(res.status).toBe(409);
    expect(
      await db.alertIncident.count({
        where: { deviceId: f.deviceId, externalId: event.incident_id },
      }),
    ).toBe(0);
  });
});
