import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@iot/database';
import { samplePayload } from '../../../packages/contracts/tests/fixture.js';
import { createApp } from '../src/app.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('API with real PostgreSQL', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
  const app = createApp({ db, origin: 'http://localhost:5173' });
  const password = `Test!${randomUUID()}`;
  let token: string;
  let viewerToken: string;
  let deviceId: string;
  let deviceKey: string;
  let keyId: string;
  const bearer = () => `Bearer ${token}`;
  const payload = (seq = '1') => {
    const p = samplePayload();
    p.device_id = deviceId;
    p.readings[0]!.seq = seq;
    p.readings[0]!.sampled_at = new Date().toISOString();
    return p;
  };

  beforeAll(async () => {
    const passwordHash = await argon2.hash(password);
    await db.user.createMany({
      data: [
        { email: 'admin@test.local', passwordHash, role: 'admin' },
        { email: 'viewer@test.local', passwordHash, role: 'viewer' },
      ],
    });
  });
  afterAll(() => db.$disconnect());

  it('requires user authentication for dashboard data', async () => {
    expect((await request(app).get('/api/v1/devices')).status).toBe(401);
  });
  it('logs in without exposing password hashes and stores only a hashed session', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'AirGuard')
      .send({ email: 'admin@test.local', password });
    expect(res.status).toBe(200);
    token = res.headers['set-cookie']![0]!.split(';')[0]!.split('=')[1]!;
    expect(res.body.data.token).toBeUndefined();
    expect(res.body.data.user).toEqual(
      expect.objectContaining({ email: 'admin@test.local', role: 'admin' }),
    );
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const sessions = await db.session.findMany({ where: { user: { email: 'admin@test.local' } } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(token);
    const viewer = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'AirGuard')
      .send({ email: 'viewer@test.local', password });
    viewerToken = viewer.headers['set-cookie']![0]!.split(';')[0]!.split('=')[1]!;
  });
  it('rejects a wrong password', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .set('X-Requested-With', 'AirGuard')
          .send({ email: 'admin@test.local', password: 'wrong' })
      ).status,
    ).toBe(401);
  });
  it('prevents viewers from registering devices', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/devices')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ name: 'x', source_kind: 'simulator' })
      ).status,
    ).toBe(403);
  });
  it('registers a simulator and issues a device credential only to admin', async () => {
    const res = await request(app)
      .post('/api/v1/devices')
      .set('Authorization', bearer())
      .send({ name: 'Lab simulator', source_kind: 'simulator' });
    expect(res.status).toBe(201);
    deviceId = res.body.data.id;
    const key = await request(app)
      .post(`/api/v1/devices/${deviceId}/credentials`)
      .set('Authorization', bearer());
    expect(key.status).toBe(201);
    deviceKey = key.body.data.key;
    keyId = key.body.data.key_id;
    const stored = await db.deviceCredential.findFirstOrThrow({ where: { deviceId } });
    expect(stored.secretHash).not.toBe(deviceKey.split('.')[1]);
  });
  it('rejects unauthenticated ingestion and invalid sensor values', async () => {
    expect((await request(app).post('/api/v1/device/telemetry').send(payload())).status).toBe(401);
    const invalid = payload();
    invalid.readings[0]!.sensors.mq2.adc_raw = 9000;
    expect(
      (
        await request(app)
          .post('/api/v1/device/telemetry')
          .set('Authorization', `DeviceKey ${deviceKey}`)
          .send(invalid)
      ).status,
    ).toBe(422);
  });
  it('persists valid raw telemetry and labels its simulator source from database', async () => {
    const res = await request(app)
      .post('/api/v1/device/telemetry')
      .set('Authorization', `DeviceKey ${deviceKey}`)
      .send(payload());
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toEqual([
      { boot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', seq: '1', duplicate: false },
    ]);
    const list = await request(app).get('/api/v1/devices').set('Authorization', bearer());
    expect(list.body.data.find((d: { id: string }) => d.id === deviceId)).toMatchObject({
      id: deviceId,
      source_kind: 'simulator',
      status: 'online',
      latest: { payload: { sensors: { mq2: { adc_raw: 1250, concentration_ppm: null } } } },
    });
  });
  it('deduplicates concurrent retries and rejects changed content without partial batch commits', async () => {
    const input = payload('2');
    const send = (p: typeof input) =>
      request(app)
        .post('/api/v1/device/telemetry')
        .set('Authorization', `DeviceKey ${deviceKey}`)
        .send(p);
    const replies = await Promise.all([send(input), send(input), send(input)]);
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await db.sensorReading.count({ where: { deviceId } })).toBe(2);
    const conflict = structuredClone(input.readings[0]!);
    conflict.sensors.dht11.temperature_c = 99;
    const batch = payload('3');
    batch.readings.push(conflict);
    expect((await send(batch)).status).toBe(409);
    expect(await db.sensorReading.count({ where: { deviceId } })).toBe(2);
  });
  it('stores delayed history without rolling current snapshot back', async () => {
    const newer = payload('10');
    newer.readings[0]!.sensors.dht11.temperature_c = 31;
    const older = payload('5');
    older.readings[0]!.sensors.dht11.temperature_c = 20;
    for (const p of [newer, older]) {
      expect(
        (
          await request(app)
            .post('/api/v1/device/telemetry')
            .set('Authorization', `DeviceKey ${deviceKey}`)
            .send(p)
        ).status,
      ).toBe(200);
    }
    const latest = await request(app)
      .get(`/api/v1/devices/${deviceId}/readings/latest`)
      .set('Authorization', bearer());
    expect(latest.body.data.payload.seq).toBe('10');
    expect(latest.body.data.payload.sensors.dht11.temperature_c).toBe(31);
  });
  it('provides bounded cursor history without leaking bigint serialization errors', async () => {
    const first = await request(app)
      .get(`/api/v1/devices/${deviceId}/readings?limit=2`)
      .set('Authorization', bearer());
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.next_cursor).toEqual(expect.any(String));
    const second = await request(app)
      .get(`/api/v1/devices/${deviceId}/readings?limit=2&cursor=${first.body.meta.next_cursor}`)
      .set('Authorization', bearer());
    expect(second.status).toBe(200);
    expect(
      second.body.data
        .map((r: { id: string }) => r.id)
        .some((id: string) => first.body.data.some((r: { id: string }) => r.id === id)),
    ).toBe(false);
    expect(
      (
        await request(app)
          .get(`/api/v1/devices/${deviceId}/readings?limit=1001`)
          .set('Authorization', bearer())
      ).status,
    ).toBe(422);
  });
  it('rejects spoofed device IDs and malformed UUIDs', async () => {
    const p = payload('20');
    p.device_id = randomUUID();
    expect(
      (
        await request(app)
          .post('/api/v1/device/telemetry')
          .set('Authorization', `DeviceKey ${deviceKey}`)
          .send(p)
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/devices/not-a-uuid/readings').set('Authorization', bearer()))
        .status,
    ).toBe(422);
  });
  it('revokes a key and blocks further upload', async () => {
    expect(
      (
        await request(app)
          .delete(`/api/v1/devices/${deviceId}/credentials/${keyId}`)
          .set('Authorization', bearer())
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .post('/api/v1/device/telemetry')
          .set('Authorization', `DeviceKey ${deviceKey}`)
          .send(payload('30'))
      ).status,
    ).toBe(401);
  });
  it('documents the actual telemetry security and schema through OpenAPI', async () => {
    const response = await request(app).get('/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.paths['/api/v1/device/telemetry'].post.security).toEqual([
      { DeviceKey: [] },
    ]);
    expect(response.body.components.schemas.Telemetry.required).toContain('readings');
  });
  it('rejects foreign browser origins and malformed JSON with normalized errors', async () => {
    const origin = await request(app)
      .get('/api/v1/devices')
      .set('Authorization', bearer())
      .set('Origin', 'https://untrusted.example');
    expect(origin.status).toBe(403);
    expect(origin.body.error.code).toBe('ORIGIN_DENIED');
    const json = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(json.status).toBe(400);
    expect(json.body.error.code).toBe('INVALID_JSON');
    expect(json.body.meta.request_id).toEqual(expect.any(String));
  });
  it('distinguishes stale device liveness from latest recorded sensor values', async () => {
    await db.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(Date.now() - 60000) },
    });
    const response = await request(app).get('/api/v1/devices').set('Authorization', bearer());
    const device = response.body.data.find((d: { id: string }) => d.id === deviceId);
    expect(device.status).toBe('offline');
    expect(device.latest.payload.seq).toBe('10');
  });
  it('invalidates a session immediately on logout', async () => {
    expect(
      (await request(app).post('/api/v1/auth/logout').set('Authorization', bearer())).status,
    ).toBe(204);
    expect((await request(app).get('/api/v1/devices').set('Authorization', bearer())).status).toBe(
      401,
    );
  });
});
