import request from 'supertest';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { Database } from '@iot/database';
import type { Express } from 'express';
import { samplePayload } from '../../../packages/contracts/tests/fixture.js';

export async function featureFixture(db: Database, app: Express, prefix: string) {
  const password = randomUUID();
  const passwordHash = await argon2.hash(password);
  const headers: Record<string, Record<string, string>> = {};
  for (const role of ['admin', 'operator', 'viewer'] as const) {
    const email = `${prefix}-${role}@test.local`;
    await db.user.create({ data: { email, passwordHash, role } });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'AirGuard')
      .send({ email, password });
    if (login.status !== 200) throw new Error(`Fixture login failed: ${login.status}`);
    headers[role] = {
      Cookie: login.headers['set-cookie']![0]!.split(';')[0]!,
      'X-Requested-With': 'AirGuard',
    };
  }
  const created = await request(app)
    .post('/api/v1/devices')
    .set(headers.admin!)
    .send({ name: `${prefix} simulator`, source_kind: 'simulator' });
  if (created.status !== 201) throw new Error('Fixture device registration failed');
  const deviceId = created.body.data.id as string;
  const key = await request(app)
    .post(`/api/v1/devices/${deviceId}/credentials`)
    .set(headers.admin!);
  const deviceHeaders = { Authorization: `DeviceKey ${key.body.data.key}` };
  const bootId = randomUUID();
  const base = Date.now() - 3600000;
  function payload(seq: number, time = base + seq * 5000) {
    const p = samplePayload();
    p.device_id = deviceId;
    p.transmission.current_boot_id = bootId;
    p.transmission.sent_uptime_ms = String(1000 + seq * 5000);
    Object.assign(p.readings[0]!, {
      boot_id: bootId,
      seq: String(seq),
      uptime_ms: String(1000 + seq * 5000),
      sampled_at: new Date(time).toISOString(),
    });
    return p;
  }
  return {
    headers,
    deviceHeaders,
    deviceId,
    bootId,
    base,
    payload,
    keyId: key.body.data.key_id as string,
  };
}
