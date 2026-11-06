import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('historical analytics and CSV', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
  const app = createApp({ db, origin: 'http://localhost:5173' });
  let f: Awaited<ReturnType<typeof featureFixture>>;
  let from: string;
  let to: string;
  beforeAll(async () => {
    f = await featureFixture(db, app, 'analytics');
    const start = Math.floor((Date.now() - 7200000) / 3600000) * 3600000;
    from = new Date(start).toISOString();
    to = new Date(start + 3600000).toISOString();
    for (const [seq, offset, temp] of [
      [1, -60000, 10],
      [2, 60000, 20],
      [3, 120000, 30],
      [4, 180000, null],
      [5, 3600000, 99],
    ] as const) {
      const p = f.payload(seq, start + offset);
      p.readings[0]!.sensors.dht11 = {
        temperature_c: temp,
        humidity_pct: temp === null ? null : 60,
        quality: temp === null ? 'invalid' : 'valid',
        age_ms: 0,
      };
      const response = await request(app)
        .post('/api/v1/device/telemetry')
        .set(f.deviceHeaders)
        .send(p);
      if (response.status !== 200) throw new Error('Fixture telemetry failed');
    }
  });
  afterAll(() => db.$disconnect());
  const query = () =>
    `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&time_basis=sampled`;
  it('filters history using an inclusive start and exclusive end with cursor pagination', async () => {
    const res = await request(app)
      .get(`/api/v1/devices/${f.deviceId}/readings?${query()}&limit=2`)
      .set(f.headers.viewer!);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { payload: { seq: string } }) => r.payload.seq)).toEqual([
      '4',
      '3',
    ]);
    const next = await request(app)
      .get(
        `/api/v1/devices/${f.deviceId}/readings?${query()}&limit=2&cursor=${res.body.meta.next_cursor}`,
      )
      .set(f.headers.viewer!);
    expect(next.body.data.map((r: { payload: { seq: string } }) => r.payload.seq)).toEqual(['2']);
  });
  it('excludes invalid readings from statistics and compares an equal preceding period', async () => {
    const res = await request(app)
      .get(
        `/api/v1/devices/${f.deviceId}/analytics?${query()}&metric=temperature_c&bucket=minute&compare=previous`,
      )
      .set(f.headers.viewer!);
    expect(res.status).toBe(200);
    expect(res.body.data.unit).toBe('°C');
    expect(res.body.data.summary).toMatchObject({
      total_count: 3,
      valid_count: 2,
      invalid_count: 1,
      min: 20,
      max: 30,
      average: 25,
    });
    expect(res.body.data.previous.summary).toMatchObject({ valid_count: 1, average: 10 });
    expect(res.body.data.series).toHaveLength(3);
    expect(res.body.data.series[2].average).toBeNull();
  });
  it('returns empty statistics as null rather than zero and rejects invalid ranges/metrics', async () => {
    const emptyFrom = new Date(Date.parse(to) + 3600000).toISOString();
    const emptyTo = new Date(Date.parse(to) + 7200000).toISOString();
    const res = await request(app)
      .get(`/api/v1/devices/${f.deviceId}/analytics?from=${emptyFrom}&to=${emptyTo}&bucket=hour`)
      .set(f.headers.viewer!);
    expect(res.body.data.summary).toMatchObject({
      valid_count: 0,
      average: null,
      min: null,
      max: null,
    });
    expect(
      (
        await request(app)
          .get(`/api/v1/devices/${f.deviceId}/analytics?from=${to}&to=${from}`)
          .set(f.headers.viewer!)
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .get(`/api/v1/devices/${f.deviceId}/analytics?${query()}&metric=aqi`)
          .set(f.headers.viewer!)
      ).status,
    ).toBe(422);
  });
  it('exports actual values, units, quality and simulator source with formula injection protection', async () => {
    await request(app)
      .patch(`/api/v1/devices/${f.deviceId}`)
      .set(f.headers.admin!)
      .send({ name: '=HYPERLINK("evil")' });
    const res = await request(app)
      .get(`/api/v1/devices/${f.deviceId}/readings/export?${query()}`)
      .set(f.headers.viewer!);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('temperature_c');
    expect(res.text).toContain('mq7_quality');
    expect(res.text).toContain('simulator');
    expect(res.text).toContain("'=HYPERLINK");
    expect(res.text).toContain('invalid');
    expect(res.text.trim().split('\r\n')).toHaveLength(4);
    expect(res.text).not.toContain('concentration_ppm');
  });
  it('does not combine raw ADC values from incompatible resolutions', async () => {
    const p = f.payload(8, Date.parse(from) + 240000);
    p.readings[0]!.sensors.mq2.adc_bits = 10;
    p.readings[0]!.sensors.mq2.adc_raw = 500;
    expect(
      (await request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(p)).status,
    ).toBe(200);
    const mixed = await request(app)
      .get(`/api/v1/devices/${f.deviceId}/analytics?${query()}&metric=mq2_adc`)
      .set(f.headers.viewer!);
    expect(mixed.status).toBe(409);
    const selected = await request(app)
      .get(`/api/v1/devices/${f.deviceId}/analytics?${query()}&metric=mq2_adc&adc_bits=10`)
      .set(f.headers.viewer!);
    expect(selected.status).toBe(200);
    expect(selected.body.data.summary.average).toBe(500);
    expect(selected.body.data.unit).toBe('ADC');
  });
  it('rejects an export exceeding 100000 rows before streaming a partial CSV', async () => {
    const record = f.payload(100000, Date.parse(from) + 300000).readings[0]!;
    try {
      await db.$executeRaw`INSERT INTO sensor_readings
        (device_id,boot_id,boot_counter,seq,sampled_at,received_at,payload,payload_hash)
        SELECT ${f.deviceId}::uuid,${f.bootId}::uuid,1,g,${new Date(record.sampled_at!)}::timestamptz,${new Date(record.sampled_at!)}::timestamptz,
          jsonb_set(${JSON.stringify(record)}::jsonb,'{seq}',to_jsonb(g::text)),encode(sha256(convert_to(g::text,'UTF8')),'hex')
        FROM generate_series(100000,200000) g`;
      const res = await request(app)
        .get(`/api/v1/devices/${f.deviceId}/readings/export?${query()}`)
        .set(f.headers.viewer!);
      expect(res.status).toBe(413);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body.error.code).toBe('EXPORT_TOO_LARGE');
    } finally {
      await db.sensorReading.deleteMany({ where: { deviceId: f.deviceId, seq: { gte: 100000n } } });
    }
  }, 60000);
});
