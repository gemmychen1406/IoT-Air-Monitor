import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';
import { syncSimulatorConfig } from '../../../tools/device-simulator/src/config.js';
import type { AddressInfo } from 'node:net';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'device administration, credentials and versioned config',
  () => {
    const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
    const app = createApp({ db, origin: 'http://localhost:5173' });
    let f: Awaited<ReturnType<typeof featureFixture>>;
    beforeAll(async () => {
      f = await featureFixture(db, app, 'devices');
    });
    afterAll(() => db.$disconnect());
    it('edits metadata without allowing source changes and exposes full device detail', async () => {
      const url = `/api/v1/devices/${f.deviceId}`;
      expect(
        (await request(app).patch(url).set(f.headers.viewer!).send({ name: 'Forbidden' })).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch(url)
            .set(f.headers.admin!)
            .send({ name: 'Lab A', location: 'Phòng 301', description: 'Thiết bị thử nghiệm' })
        ).status,
      ).toBe(200);
      const res = await request(app).get(url).set(f.headers.viewer!);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Lab A',
        location: 'Phòng 301',
        source_kind: 'simulator',
        archived_at: null,
      });
      expect(
        (await request(app).patch(url).set(f.headers.admin!).send({ source_kind: 'physical' }))
          .status,
      ).toBe(422);
    });
    it('lists credential metadata but never returns stored hashes or secrets', async () => {
      const url = `/api/v1/devices/${f.deviceId}/credentials`;
      expect((await request(app).get(url).set(f.headers.viewer!)).status).toBe(403);
      const res = await request(app).get(url).set(f.headers.admin!);
      expect(res.status).toBe(200);
      expect(res.body.data[0]).toMatchObject({ key_id: f.keyId, status: 'active' });
      expect(JSON.stringify(res.body)).not.toMatch(/secret_hash|secretHash|DeviceKey /);
      expect(
        (
          await request(app)
            .post(url)
            .set(f.headers.admin!)
            .send({ expires_at: new Date(Date.now() - 1000).toISOString() })
        ).status,
      ).toBe(422);
    });
    it('rotates a key with an explicit overlap window and revokes it without deleting history', async () => {
      const res = await request(app)
        .post(`/api/v1/devices/${f.deviceId}/credentials/${f.keyId}/rotate`)
        .set(f.headers.admin!)
        .send({ overlap_minutes: 10, label: 'Key mới' });
      expect(res.status).toBe(201);
      expect(res.body.data.key).toEqual(expect.any(String));
      const old = await db.deviceCredential.findUniqueOrThrow({ where: { keyId: f.keyId } });
      expect(old.expiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(old.expiresAt!.getTime()).toBeLessThan(Date.now() + 601000);
      const rotated = await db.deviceCredential.findUniqueOrThrow({
        where: { keyId: res.body.data.key_id },
      });
      expect(rotated.replacesKeyId).toBe(f.keyId);
      expect(
        (
          await request(app)
            .delete(`/api/v1/devices/${f.deviceId}/credentials/${rotated.keyId}`)
            .set(f.headers.admin!)
        ).status,
      ).toBe(204);
      expect(
        (
          await request(app)
            .get('/api/v1/device/config')
            .set('Authorization', `DeviceKey ${res.body.data.key}`)
        ).status,
      ).toBe(401);
    });
    it('creates immutable config versions with optimistic locking and excludes safety controls', async () => {
      const url = `/api/v1/devices/${f.deviceId}/config`;
      const first = await request(app).get(url).set(f.headers.viewer!);
      expect(first.status).toBe(200);
      expect(first.body.data.desired).toMatchObject({
        version: 1,
        config: { reporting_interval_ms: 5000 },
      });
      const write = { expected_version: 1, config: { reporting_interval_ms: 10000 } };
      const results = await Promise.all([
        request(app).put(url).set(f.headers.admin!).send(write),
        request(app).put(url).set(f.headers.admin!).send(write),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        (
          await request(app)
            .put(url)
            .set(f.headers.admin!)
            .send({
              expected_version: 2,
              config: { reporting_interval_ms: 5000, buzzer_enabled: false },
            })
        ).status,
      ).toBe(422);
      const history = await request(app).get(url).set(f.headers.viewer!);
      expect(history.body.data.history.map((c: { version: number }) => c.version)).toEqual([2, 1]);
    });
    it('serves ETag configuration and validates applied/rejected ACKs without regressing desired version', async () => {
      const config = await request(app).get('/api/v1/device/config').set(f.deviceHeaders);
      expect(config.status).toBe(200);
      expect(config.body.data.version).toBe(2);
      expect(
        (
          await request(app)
            .get('/api/v1/device/config')
            .set(f.deviceHeaders)
            .set('If-None-Match', config.headers.etag!)
        ).status,
      ).toBe(304);
      const ack = (body: object) =>
        request(app).post('/api/v1/device/config/ack').set(f.deviceHeaders).send(body);
      expect((await ack({ version: 2, content_hash: 'wrong', status: 'applied' })).status).toBe(
        422,
      );
      const body = { version: 2, content_hash: config.body.data.content_hash, status: 'applied' };
      expect((await ack(body)).status).toBe(200);
      expect((await ack(body)).status).toBe(200);
      const res = await request(app)
        .get(`/api/v1/devices/${f.deviceId}/config`)
        .set(f.headers.viewer!);
      expect(res.body.data.applied_version).toBe(2);
      expect(res.body.data.desired.config.reporting_interval_ms).toBe(10000);
    });
    it('uses heartbeat to track connectivity and records transitions without inventing sensor readings', async () => {
      const res = await request(app).post('/api/v1/device/heartbeat').set(f.deviceHeaders).send({
        schema_version: 1,
        device_id: f.deviceId,
        boot_id: f.bootId,
        boot_counter: '1',
        uptime_ms: '1000',
        firmware_version: 'test-1',
      });
      expect(res.status).toBe(200);
      const detail = await request(app).get(`/api/v1/devices/${f.deviceId}`).set(f.headers.viewer!);
      expect(detail.body.data.status).toBe('online');
      expect(detail.body.data.latest).toBeNull();
      const history = await request(app)
        .get(`/api/v1/devices/${f.deviceId}/status-history`)
        .set(f.headers.viewer!);
      expect(history.body.data[0]).toMatchObject({
        previous_status: 'never_seen',
        new_status: 'online',
      });
      const keys = await request(app)
        .get(`/api/v1/devices/${f.deviceId}/credentials`)
        .set(f.headers.admin!);
      expect(
        keys.body.data.find((k: { key_id: string }) => k.key_id === f.keyId).last_used_at,
      ).not.toBeNull();
    });
    it('archives without deleting readings and blocks all device credentials until explicitly restored', async () => {
      const url = `/api/v1/devices/${f.deviceId}`;
      expect(
        (await request(app).patch(url).set(f.headers.admin!).send({ archived: true })).status,
      ).toBe(200);
      expect(
        await db.deviceStatusHistory.count({
          where: {
            deviceId: f.deviceId,
            previousStatus: 'online',
            newStatus: 'offline',
            reason: 'device_archived',
          },
        }),
      ).toBe(1);
      expect((await request(app).get('/api/v1/device/config').set(f.deviceHeaders)).status).toBe(
        403,
      );
      expect(
        (await request(app).get('/api/v1/devices').set(f.headers.viewer!)).body.data.some(
          (d: { id: string }) => d.id === f.deviceId,
        ),
      ).toBe(false);
      const archived = await request(app)
        .get('/api/v1/devices?archived=all')
        .set(f.headers.viewer!);
      expect(
        archived.body.data.find((d: { id: string }) => d.id === f.deviceId).archived_at,
      ).not.toBeNull();
      expect(
        (await request(app).patch(url).set(f.headers.admin!).send({ archived: false })).status,
      ).toBe(200);
      expect((await request(app).get('/api/v1/device/config').set(f.deviceHeaders)).status).toBe(
        200,
      );
      expect(await db.auditLog.count({ where: { deviceId: f.deviceId } })).toBeGreaterThan(0);
    });
    it('paginates all credential metadata so older active keys are still manageable', async () => {
      const url = `/api/v1/devices/${f.deviceId}/credentials`;
      const first = await request(app).get(`${url}?limit=1`).set(f.headers.admin!);
      expect(first.body.data).toHaveLength(1);
      expect(first.body.meta.next_cursor).toEqual(expect.any(String));
      const next = await request(app)
        .get(`${url}?limit=1&cursor=${first.body.meta.next_cursor}`)
        .set(f.headers.admin!);
      expect(next.body.data).toHaveLength(1);
      expect(next.body.data[0].key_id).not.toBe(first.body.data[0].key_id);
    });
    it('rejects an expired key even when its secret is correct', async () => {
      const created = await request(app)
        .post(`/api/v1/devices/${f.deviceId}/credentials`)
        .set(f.headers.admin!)
        .send({ label: 'Expiry test' });
      await db.deviceCredential.update({
        where: { keyId: created.body.data.key_id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        (
          await request(app)
            .get('/api/v1/device/config')
            .set('Authorization', `DeviceKey ${created.body.data.key}`)
        ).status,
      ).toBe(401);
    });
    it('uses the applied reporting interval for offline detection and records one timeout transition', async () => {
      await db.device.update({
        where: { id: f.deviceId },
        data: {
          reportingIntervalMs: 60000,
          connectivity: 'online',
          lastSeenAt: new Date(Date.now() - 60000),
        },
      });
      const online = await request(app).get('/api/v1/devices').set(f.headers.viewer!);
      expect(online.body.data.find((d: { id: string }) => d.id === f.deviceId).status).toBe(
        'online',
      );
      await db.device.update({
        where: { id: f.deviceId },
        data: { lastSeenAt: new Date(Date.now() - 181000) },
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const offline = await request(app).get('/api/v1/devices').set(f.headers.viewer!);
        expect(offline.body.data.find((d: { id: string }) => d.id === f.deviceId).status).toBe(
          'offline',
        );
      }
      expect(
        await db.deviceStatusHistory.count({
          where: { deviceId: f.deviceId, reason: 'heartbeat_timeout' },
        }),
      ).toBe(1);
    });
    it('lets the simulator fetch, verify and acknowledge a new reporting interval, then reuse its ETag', async () => {
      const config = await request(app)
        .put(`/api/v1/devices/${f.deviceId}/config`)
        .set(f.headers.admin!)
        .send({ expected_version: 2, config: { reporting_interval_ms: 15000 } });
      expect(config.status).toBe(200);
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      try {
        const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
        const key = f.deviceHeaders.Authorization.slice('DeviceKey '.length);
        const state = await syncSimulatorConfig(url, key, { version: 1, intervalMs: 5000 });
        expect(state).toMatchObject({ version: 3, intervalMs: 15000, etag: expect.any(String) });
        expect(await syncSimulatorConfig(url, key, state)).toEqual(state);
        const detail = await request(app)
          .get(`/api/v1/devices/${f.deviceId}/config`)
          .set(f.headers.viewer!);
        expect(detail.body.data.applied_version).toBe(3);
        expect(
          await db.deviceConfigAck.count({
            where: { deviceId: f.deviceId, version: 3, status: 'applied' },
          }),
        ).toBe(1);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  },
);
