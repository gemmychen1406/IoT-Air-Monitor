import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { defaultEnvironmentPolicy, type EnvironmentAttempt, type EnvironmentPolicy } from '@iot/contracts';
import { createDatabase, type Database } from '@iot/database';
import { createApp } from '../src/app.js';
import { deliverEnvironment } from '../src/modules/environment/delivery.js';
import { alertQuietUntil, digestSlot, nextDigest, quietEnd, minute } from '../src/modules/environment/policy.js';
import { scheduleEnvironment, variationSummary } from '../src/modules/environment/scheduler.js';
import { featureFixture } from './helpers.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const availability = { telegram: true, telegramSimulators: true };
const baseline = new Date('2026-11-18T15:50:00.000Z');
const plus = (date: Date, minutes: number) => new Date(date.getTime() + minutes * minute);
const config: EnvironmentPolicy = {
  ...defaultEnvironmentPolicy, enabled: true, device_ids: [id], include_simulators: true,
  quiet: { start: '23:00', end: '06:00' },
  digest: { enabled: true, interval_minutes: 5, window_minutes: 5 },
};

it('calculates an activation-based interval and does not replay missed slots', () => {
  assert.equal(digestSlot(baseline, plus(baseline, 4), 5), null);
  assert.equal(digestSlot(baseline, plus(baseline, 37), 5)?.toISOString(), plus(baseline, 35).toISOString());
  assert.equal(nextDigest(baseline, plus(baseline, 37), 5).toISOString(), plus(baseline, 40).toISOString());
});

it('uses the local clock across midnight and leaves existing alert behavior opt-in', async () => {
  const start = new Date('2026-11-18T16:00:00Z');
  const midnight = new Date('2026-11-18T17:00:00Z');
  const end = '2026-11-18T23:00:00.000Z';
  assert.equal(quietEnd(config, plus(start, -1)), null);
  assert.equal(quietEnd(config, start)?.toISOString(), end);
  assert.equal(quietEnd(config, midnight)?.toISOString(), end);
  assert.equal(quietEnd(config, new Date(end)), null);

  const policy = { ...config };
  const tx = { environmentPolicy: { findUnique: async () => ({ config: policy }) } } as unknown as Database;
  assert.equal(await alertQuietUntil(tx, null, 'warning', start), null);
  policy.quiet_incidents = true;
  assert.equal((await alertQuietUntil(tx, null, 'warning', start))?.toISOString(), end);
  assert.equal(await alertQuietUntil(tx, null, 'critical', start), null);
  policy.critical_bypass = false;
  assert.equal((await alertQuietUntil(tx, null, 'critical', start))?.toISOString(), end);
});

it('requires a complete sustained window and compares relative humidity in percentage points', () => {
  const series = Array.from({ length: 6 }, (_, i) => ({
    at: plus(baseline, i), count: 1, temperature: i < 3 ? 20 : 24, humidity: i < 3 ? 40 : 32,
  }));
  const variation = { enabled: true, sustain_minutes: 3, cooldown_minutes: 5, temperature_delta: 3, humidity_delta: 7 };
  const actual = variationSummary(series, plus(baseline, 6), variation);
  assert.match(actual ?? '', /Nhiệt độ \+4.0 °C/);
  assert.match(actual ?? '', /Độ ẩm -8.0 điểm %RH/);
  assert.equal(variationSummary(series.filter((_, i) => i !== 4), plus(baseline, 6), variation), null);
  const spike = series.map((b, i) => i === 4 ? { ...b, temperature: 20, humidity: 40 } : b);
  assert.equal(variationSummary(spike, plus(baseline, 6), variation), null);
});

function schedulerFixture(
  rules: EnvironmentPolicy,
  readSamples: (from: Date, to: Date) => ReturnType<typeof sampleSeries> = () => [],
) {
  const stored = { id: 'telegram', channel: 'telegram', userId: null, config: rules };
  let state = {
    policyId: stored.id, deviceId: id, startedAt: baseline, lastDigestAt: null as Date | null,
    variationChecked: null as Date | null, lastVariationAt: null as Date | null, statusCursor: 0n,
    offlineId: null, offlineAt: null, offlineQueued: false, lastOfflineAt: null,
  };
  const jobs: { kind: string; sourceKey: string; summary: string }[] = [];
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      if (sql.join('').includes('pg_try_advisory')) return [{ locked: true }];
      const [, , , from, to] = values;
      assert(from instanceof Date && to instanceof Date);
      return readSamples(from, to);
    },
    environmentPolicy: { findUniqueOrThrow: async () => ({ ...stored, devices: [{ ...state }] }) },
    device: { findMany: async () => [{ id, name: 'Sensor', sourceKind: 'physical', location: '', reportingIntervalMs: 5000 }] },
    environmentDelivery: {
      updateMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: typeof jobs }) => { jobs.push(...data); },
    },
    environmentDeviceState: {
      update: async ({ data }: { data: Partial<typeof state> }) => { state = { ...state, ...data }; },
    },
  };
  const db = {
    environmentPolicy: { findMany: async () => [stored] },
    environmentDelivery: tx.environmentDelivery,
    $transaction: (callback: (value: typeof tx) => Promise<void>) => callback(tx),
  } as unknown as Database;
  return { jobs, state: () => state, run: (at: Date) => scheduleEnvironment(db, availability, at) };
}

function sampleSeries() {
  return Array.from({ length: 6 }, (_, i) => ({
    at: plus(baseline, i), count: 1, temperature: i < 3 ? 20 : 24, humidity: 40,
  }));
}

it('persists the digest checkpoint so a restarted scheduler does not enqueue the same slot', async () => {
  const f = schedulerFixture(config);
  await f.run(plus(baseline, 5));
  await f.run(plus(baseline, 6));
  assert.equal(f.jobs.length, 1);
  assert.equal(f.jobs[0]?.sourceKey, plus(baseline, 5).toISOString());
  assert.match(f.jobs[0]?.summary ?? '', /Chưa đủ dữ liệu hợp lệ/);
  assert.equal(f.state().lastDigestAt?.toISOString(), plus(baseline, 5).toISOString());
});

it('includes a final sample arriving 20 seconds late and enqueues its window once across restarts', async () => {
  const ending = plus(baseline, 6);
  const sampledAt = ending.getTime() - 5000;
  const receivedAt = sampledAt + 20_000;
  let now = ending;
  const f = schedulerFixture({
    ...config,
    digest: { ...config.digest, enabled: false },
    variation: { ...config.variation, enabled: true, sustain_minutes: 3 },
  }, (from, to) => sampleSeries().filter((row, i) =>
    row.at >= from && row.at < to && (i !== 5 || now.getTime() >= receivedAt),
  ));
  await f.run(now);
  assert.equal(f.jobs.length, 0);
  assert((f.state().variationChecked?.getTime() ?? 0) < ending.getTime());
  now = new Date(receivedAt);
  await f.run(now);
  assert.equal(f.jobs.length, 0);
  now = plus(ending, 2);
  await f.run(now);
  await f.run(now);
  await f.run(new Date(now.getTime() + 15_000));
  assert.deepEqual(f.jobs.map(({ kind, sourceKey }) => ({ kind, sourceKey })), [
    { kind: 'variation', sourceKey: ending.toISOString() },
  ]);
  assert.equal(f.state().variationChecked?.toISOString(), ending.toISOString());
});

function senderFixture(kind: 'digest' | 'online' = 'digest', attempts = 0) {
  const policy: EnvironmentPolicy = { ...config, quiet: null, connectivity: { ...config.connectivity, enabled: true } };
  const attemptLog: EnvironmentAttempt[] = Array.from({ length: attempts }, (_, index) => ({
    number: index + 1, started_at: baseline.toISOString(), finished_at: baseline.toISOString(),
    outcome: 'retry', error_code: 'MOCK_RETRY',
  }));
  const job = {
    ordinal: 1n, id, policyId: 'telegram', deviceId: id, deviceName: 'Sensor', kind, sourceKey: '2',
    dependsOn: kind === 'online' ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : null,
    summary: 'Demo', simulator: false, createdAt: baseline, occurredAt: baseline,
    nextAttemptAt: baseline, expiresAt: plus(baseline, 600),
    status: 'pending', leaseToken: null as string | null, leaseUntil: null as Date | null, attempts, attemptLog,
    lastErrorCode: null as string | null,
  };
  const live = { now: baseline, connectivity: 'online', eventId: 2n, finalRead: () => {}, attemptWrite: () => {} };
  let calls = 0;
  const row = {
    findUniqueOrThrow: async () => ({ ...job }),
    findUnique: async ({ where }: { where: { id: string } }) => {
      assert.equal(where.id, job.dependsOn);
      return { status: 'sent' };
    },
    findFirst: async ({ where }: { where: { leaseToken?: string } }) => {
      if (where.leaseToken !== job.leaseToken || job.status !== 'sending') return null;
      live.finalRead();
      return { ...job, policy: { config: policy } };
    },
    update: async ({ data }: { data: object }) => ({ ...Object.assign(job, data) }),
    updateMany: async ({ where, data }: {
      where: { leaseToken: string; status: string; attempts?: number; leaseUntil?: { gt: Date; equals?: Date } };
      data: { attempts?: { increment?: number; decrement?: number } };
    }) => {
      if (where.leaseToken !== job.leaseToken || where.status !== job.status ||
        (where.attempts !== undefined && where.attempts !== job.attempts) ||
        (where.leaseUntil && (!job.leaseUntil || job.leaseUntil <= where.leaseUntil.gt ||
          (where.leaseUntil.equals && job.leaseUntil.getTime() !== where.leaseUntil.equals.getTime()))))
        return { count: 0 };
      if (data.attempts?.decrement) {
        assert.equal(where.attempts, job.attempts);
        assert.equal(where.leaseUntil?.equals?.getTime(), job.leaseUntil?.getTime());
      }
      const prior = job.attempts;
      Object.assign(job, data);
      if (data.attempts) job.attempts = prior + (data.attempts.increment ?? 0) - (data.attempts.decrement ?? 0);
      if (data.attempts?.increment) live.attemptWrite();
      return { count: 1 };
    },
  };
  const db = {
    environmentPolicy: { findUniqueOrThrow: async () => ({ config: policy }) },
    device: { findUnique: async () => ({
      archivedAt: null, connectivity: live.connectivity, statuses: [{ id: live.eventId }],
    }) },
    environmentDeviceState: { findUnique: async () => ({ startedAt: baseline }) },
    environmentDelivery: row,
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({
      $queryRaw: async () => job.status === 'pending' && job.nextAttemptAt <= live.now ? [{ ordinal: 1n }] : [],
      environmentDelivery: row,
    }),
  } as unknown as Database;
  const run = (retryFirst = false) => deliverEnvironment(db, {
    channel: 'telegram', includeSimulators: true,
    send: async () => ++calls === 1 && retryFirst ? { ok: false, retryable: true, code: 'MOCK_RETRY' } : { ok: true },
  }, () => live.now);
  return { policy, live, job, calls: () => calls, run };
}

it('rechecks quiet hours on retry and a new sender skips an already accepted job', async () => {
  const { policy, live, job, calls, run } = senderFixture();
  const first = await run(true);
  assert.equal(first.processed && first.status, 'pending');
  assert.equal(job.attempts, 1);
  policy.quiet = { start: '23:00', end: '06:00' };
  live.now = plus(baseline, 11);
  const deferred = await run();
  assert.equal(deferred.processed && deferred.status, 'pending');
  assert.equal(calls(), 1);
  assert.equal(job.attempts, 1);
  live.now = new Date('2026-11-18T23:00:00Z');
  const delivered = await run();
  assert.equal(delivered.processed && delivered.status, 'sent');
  assert.equal((await run()).processed, false);
  assert.equal(calls(), 2);
  assert.equal(job.attempts, 2);
});

it('preserves seven attempts if quiet hours begin during the final reads and can still send attempt eight', async () => {
  const { policy, live, job, calls, run } = senderFixture('digest', 7);
  policy.quiet = config.quiet;
  live.now = new Date('2026-11-18T15:59:59Z');
  live.finalRead = () => { live.now = new Date('2026-11-18T16:00:00Z'); };
  const attempts = [...job.attemptLog];
  const deferred = await run();
  assert.equal(deferred.processed && deferred.status, 'pending');
  assert.equal(job.lastErrorCode, 'QUIET_HOURS');
  assert.equal(job.nextAttemptAt.toISOString(), '2026-11-18T23:00:00.000Z');
  assert.equal(calls(), 0);
  assert.equal(job.attempts, 7);
  assert.deepEqual(job.attemptLog, attempts);

  live.finalRead = () => {};
  live.now = job.nextAttemptAt;
  const sent = await run();
  assert.equal(sent.processed && sent.status, 'sent');
  assert.equal(job.attempts, 8);
  assert.equal(job.attemptLog.at(-1)?.number, 8);
  assert.equal(job.attemptLog.at(-1)?.outcome, 'sent');
  assert.equal(calls(), 1);
});

it('discards attempt eight if its write crosses into quiet hours and can send it after quiet hours', async () => {
  const { policy, live, job, calls, run } = senderFixture('digest', 7);
  policy.quiet = config.quiet;
  live.now = new Date('2026-11-18T15:59:59Z');
  live.attemptWrite = () => {
    assert.equal(job.attempts, 8);
    live.now = new Date('2026-11-18T16:00:00Z');
  };
  const previous = [...job.attemptLog];
  const deferred = await run();
  assert.equal(deferred.processed && deferred.status, 'pending');
  assert.equal(job.lastErrorCode, 'QUIET_HOURS');
  assert.equal(job.nextAttemptAt.toISOString(), '2026-11-18T23:00:00.000Z');
  assert.equal(job.attempts, 7);
  assert.deepEqual(job.attemptLog, previous);
  assert.equal(calls(), 0);

  live.attemptWrite = () => {};
  live.now = job.nextAttemptAt;
  const sent = await run();
  assert.equal(sent.processed && sent.status, 'sent');
  assert.equal(job.attempts, 8);
  assert.equal(job.attemptLog.at(-1)?.number, 8);
  assert.equal(job.attemptLog.at(-1)?.outcome, 'sent');
  assert.equal(calls(), 1);
});

it('discards the attempt and expires the job if its write crosses the send deadline', async () => {
  const { live, job, calls, run } = senderFixture('digest', 2);
  job.expiresAt = new Date(baseline.getTime() + 1000);
  live.attemptWrite = () => {
    assert.equal(job.attempts, 3);
    live.now = job.expiresAt;
  };
  const previous = [...job.attemptLog];
  const expired = await run();
  assert.equal(expired.processed && expired.status, 'expired');
  assert.equal(job.lastErrorCode, 'DELIVERY_EXPIRED');
  assert.equal(job.attempts, 2);
  assert.deepEqual(job.attemptLog, previous);
  assert.equal(calls(), 0);
  assert.equal((await run()).processed, false);
});

for (const connectivity of ['offline', 'online'] as const) {
  it(`skips a queued recovery whose latest connection event changed to ${connectivity} during the final reads`, async () => {
    const { live, job, calls, run } = senderFixture('online');
    live.finalRead = () => { live.connectivity = connectivity; live.eventId = 3n; };
    const skipped = await run();
    assert.equal(skipped.processed && skipped.status, 'skipped');
    assert.equal(job.lastErrorCode, 'SUPERSEDED');
    assert.equal(job.attempts, 0);
    assert.deepEqual(job.attemptLog, []);
    assert.equal(calls(), 0);
  });
}

it('sends the current recovery paired with an accepted outage once', async () => {
  const { job, calls, run } = senderFixture('online');
  const sent = await run();
  assert.equal(sent.processed && sent.status, 'sent');
  assert.equal((await run()).processed, false);
  assert.equal(job.attempts, 1);
  assert.equal(calls(), 1);
});

const testUrl = process.env.TEST_ENVIRONMENT_DATABASE_URL;
describe.skipIf(!testUrl)('environment notifications with isolated PostgreSQL', () => {
  const db = createDatabase(testUrl ?? 'postgresql://localhost/airguard_environment_test');
  const app = createApp({ db, origin: 'http://localhost:5173', environment: availability });
  let f: Awaited<ReturnType<typeof featureFixture>>;
  const day = new Date(Date.now() + 86400000);
  day.setUTCHours(15, 50, 0, 0);
  beforeAll(async () => { f = await featureFixture(db, app, `environment-${randomUUID()}`); });
  afterAll(() => db.$disconnect());
  const settings = '/api/v1/environment/settings';
  const history = '/api/v1/environment/history';

  it('enforces channel ownership and durably handles digest, variation, quiet hours and paired recovery', async () => {
    const rules = {
      ...config, device_ids: [f.deviceId],
      variation: { ...config.variation, enabled: true, sustain_minutes: 3, temperature_delta: 2 },
      connectivity: { enabled: true, wait_minutes: 1, cooldown_minutes: 1 },
    };
    assert.equal((await request(app).put(`${settings}/telegram`).set(f.headers.viewer!).send(rules)).status, 403);
    assert.equal((await request(app).put(`${settings}/telegram`).set(f.headers.admin!).send(rules)).status, 200);
    assert.equal((await request(app).put(`${settings}/webpush`).set(f.headers.viewer!).send(rules)).body.data.channel_ready, false);
    await db.environmentDeviceState.updateMany({ where: { deviceId: f.deviceId }, data: { startedAt: day } });
    const reading = (i: number, sampledAt = plus(day, i + 0.1), receivedAt = sampledAt) => ({
      deviceId: f.deviceId, seq: BigInt(i + 1), bootId: f.bootId, bootCounter: 1n,
      sampledAt, receivedAt, temperatureC: i < 3 ? 20 : 25, humidityPct: 50,
      payload: { sensors: { dht11: { quality: 'valid', age_ms: 0 } } }, payloadHash: `mock-${i}`,
    });
    await db.sensorReading.createMany({ data: Array.from({ length: 5 }, (_, i) => reading(i)) });
    const run = (minutes: number) => scheduleEnvironment(db, availability, plus(day, minutes));
    const sent: string[] = [];
    const drain = async (min: number) => {
      for (let i = 0; i < 12; i++) {
        const result = await deliverEnvironment(db, {
          channel: 'telegram', includeSimulators: true,
          send: async (body) => { sent.push(body); return { ok: true }; },
        }, () => plus(day, min));
        if (!result.processed) return;
      }
      assert.fail('The queue did not drain');
    };
    const transition = async (newStatus: 'offline' | 'online', minutes: number) => {
      await db.device.update({ where: { id: f.deviceId }, data: { connectivity: newStatus } });
      await db.deviceStatusHistory.create({
        data: {
          deviceId: f.deviceId, previousStatus: newStatus === 'offline' ? 'online' : 'offline',
          newStatus, detectedAt: plus(day, minutes), effectiveAt: plus(day, minutes), reason: 'test',
        },
      });
    };

    await run(6);
    const lateSample = new Date(plus(day, 6).getTime() - 5000);
    await db.sensorReading.create({ data: reading(5, lateSample, new Date(lateSample.getTime() + 20_000)) });
    await Promise.all([run(8), run(8)]);
    await run(8);
    await drain(8);
    assert.equal(sent.length, 2);
    assert(sent.some((text) => text.includes('min/max/TB')));
    assert(sent.some((text) => text.includes('Duy trì 3 phút')));
    assert.equal(await db.alertIncident.count({ where: { deviceId: f.deviceId } }), 0);
    const personal = (await request(app).get(history).set(f.headers.viewer!)).body.data;
    assert(personal.length >= 2 && personal.every((r: { channel: string; status: string }) => r.channel === 'webpush' && r.status === 'skipped'));

    await transition('offline', 11);
    await run(12);
    await drain(12);
    const outages = () => db.environmentDelivery.findMany({ where: { policyId: 'telegram', deviceId: f.deviceId, kind: 'offline' }, orderBy: { ordinal: 'asc' } });
    assert.equal((await outages())[0]?.lastErrorCode, 'QUIET_HOURS');
    await transition('online', 13);
    await run(13);
    assert.equal((await outages())[0]?.lastErrorCode, 'CONNECTION_FLAPPED');
    assert.equal(await db.environmentDelivery.count({ where: { policyId: 'telegram', kind: 'online', deviceId: f.deviceId } }), 0);
    assert.equal(sent.length, 2);

    await transition('offline', 480);
    await run(481);
    await drain(481);
    assert.equal((await outages()).at(-1)?.status, 'sent');
    await transition('online', 482);
    await run(482);
    await transition('offline', 483);
    await drain(483);
    assert.equal(sent.filter((text) => text.startsWith('Kết nối lại')).length, 0);
    const stale = await db.environmentDelivery.findFirstOrThrow({
      where: { policyId: 'telegram', deviceId: f.deviceId, kind: 'online' },
    });
    assert.equal(stale.lastErrorCode, 'SUPERSEDED');
    assert.equal(stale.attempts, 0);

    await run(484);
    await drain(484);
    await transition('online', 485);
    await run(485);
    await run(485);
    await drain(485);
    assert.equal(sent.filter((text) => text.startsWith('Kết nối lại')).length, 1);
    const page = await request(app).get(`${history}?kind=online&channel=telegram&status=sent`).set(f.headers.admin!);
    assert.equal(page.status, 200);
    assert.equal(page.body.data[0]?.status, 'sent');
    assert.deepEqual((await request(app).get(`${history}?channel=telegram`).set(f.headers.viewer!)).body.data, []);
  });
});
