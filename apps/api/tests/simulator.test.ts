import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';
import { buildPayload } from '../../../tools/device-simulator/src/payload.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('simulated danger lifecycle', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
  const app = createApp({ db, origin: 'http://localhost:5173' });
  afterAll(() => db.$disconnect());
  it('opens three simulator incidents, deduplicates active retries and closes on recovery', async () => {
    const f = await featureFixture(db, app, 'simulated-danger');
    for (const seq of [1, 2, 3, 3, 4, 5, 6, 7]) {
      const options = {
        deviceId: f.deviceId,
        bootId: f.bootId,
        bootCounter: '1',
        seq: String(seq),
        uptime: seq * 5000,
        now: new Date(f.base + seq * 5000),
        scenario: 'danger' as const,
      };
      const res = await request(app)
        .post('/api/v1/device/telemetry')
        .set(f.deviceHeaders)
        .send(buildPayload(options));
      expect(res.status).toBe(200);
      if (seq === 3) {
        const active = await request(app)
          .get(`/api/v1/alerts/incidents?device_id=${f.deviceId}&status=active`)
          .set(f.headers.viewer!);
        expect(active.body.data).toHaveLength(3);
        expect(
          active.body.data.every((i: { source_kind: string }) => i.source_kind === 'simulator'),
        ).toBe(true);
      }
    }
    const incidents = await request(app)
      .get(`/api/v1/alerts/incidents?device_id=${f.deviceId}`)
      .set(f.headers.viewer!);
    expect(incidents.body.data).toHaveLength(3);
    expect(incidents.body.data.every((i: { status: string }) => i.status === 'ended')).toBe(true);
    expect(await db.alertEvent.count({ where: { deviceId: f.deviceId } })).toBe(6);
  });
});
