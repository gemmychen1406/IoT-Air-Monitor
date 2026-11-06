import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { createDatabase } from '@iot/database';
import { samplePayload } from '../../../packages/contracts/tests/fixture.js';
import { createRuntime } from '../src/runtime.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('authenticated realtime', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
  const runtime = createRuntime(db, 'http://localhost:5173');
  const sockets: Socket[] = [];
  let url: string;
  let cookie: string;
  let deviceId: string;
  let key: string;
  beforeAll(async () => {
    await new Promise<void>((resolve) => runtime.http.listen(0, '127.0.0.1', resolve));
    const address = runtime.http.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    url = `http://127.0.0.1:${address.port}/monitoring`;
    const password = randomUUID();
    await db.user.create({
      data: {
        email: 'socket@test.local',
        passwordHash: await argon2.hash(password),
        role: 'admin',
      },
    });
    const login = await request(runtime.app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'AirGuard')
      .send({ email: 'socket@test.local', password });
    cookie = login.headers['set-cookie']![0]!.split(';')[0]!;
    const device = await request(runtime.app)
      .post('/api/v1/devices')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'AirGuard')
      .send({ name: 'Socket simulator', source_kind: 'simulator' });
    deviceId = device.body.data.id;
    const credential = await request(runtime.app)
      .post(`/api/v1/devices/${deviceId}/credentials`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'AirGuard');
    key = credential.body.data.key;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await new Promise<void>((resolve) => runtime.io.close(() => resolve()));
    await db.$disconnect();
  });
  const client = (sessionCookie?: string) => {
    const socket = connect(url, {
      extraHeaders: {
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        Origin: 'http://127.0.0.1:5173',
      },
      reconnection: false,
      timeout: 2000,
    });
    sockets.push(socket);
    return socket;
  };
  it('refuses a socket without a valid user session', async () => {
    const socket = client();
    const outcome = await new Promise<string>((resolve) => {
      socket.once('connect', () => resolve('accepted'));
      socket.once('connect_error', () => resolve('rejected'));
    });
    expect(outcome).toBe('rejected');
  });
  it('emits only after telemetry is committed and disconnects on logout', async () => {
    const socket = client(cookie);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const ack = await socket
      .timeout(2000)
      .emitWithAck('devices.subscribe', { device_ids: [deviceId] });
    expect(ack.accepted_device_ids).toEqual([deviceId]);
    const eventPromise = new Promise<{ device_id: string }>((resolve) =>
      socket.once('telemetry.created', resolve),
    );
    const p = samplePayload();
    p.device_id = deviceId;
    p.readings[0]!.sampled_at = new Date().toISOString();
    const response = await request(runtime.app)
      .post('/api/v1/device/telemetry')
      .set('Authorization', `DeviceKey ${key}`)
      .send(p);
    expect(response.status).toBe(200);
    expect((await eventPromise).device_id).toBe(deviceId);
    expect(await db.sensorReading.count({ where: { deviceId } })).toBe(1);
    const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));
    await request(runtime.app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'AirGuard');
    expect(await disconnected).toBe('io server disconnect');
  });
});
