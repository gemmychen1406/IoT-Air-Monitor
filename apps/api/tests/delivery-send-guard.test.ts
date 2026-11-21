import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import type { Database } from '@iot/database';
import { deliverTelegramNotification } from '../src/modules/notifications.js';
import { deliverWebPush, type PushPayload } from '../src/modules/web-push.js';

afterEach(() => vi.restoreAllMocks());

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config = { publicKey: 'demo', privateKey: 'demo', subject: 'mailto:demo@example.test' };

type Ownership = {
  id: string;
  status: string;
  leaseToken: string;
  leaseUntil?: { gt: Date };
  expiresAt?: { lte: Date };
};

function fixture(channel: 'telegram' | 'webpush', expiresAfter = 1000) {
  const start = new Date('2026-11-18T00:00:00Z');
  let elapsed = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => start.getTime() + elapsed);
  const job = {
    id, incidentId: id, severity: 'warning', attempts: 0,
    status: 'pending', leaseToken: '', leaseUntil: null as Date | null,
    expiresAt: new Date(start.getTime() + expiresAfter),
    incident: {
      id, condition: 'gas', startedAt: start, firstObservedAt: start, severity: 'warning',
      status: 'active', device: { id, name: 'Demo', location: 'Kệ thử', sourceKind: 'simulator' },
    },
  };
  const hooks = {
    snapshot: () => {},
    preflight: () => {},
  };
  const push = {
    expiresAt: new Date(start.getTime() + 60_000),
    includeSimulators: true,
    showDetails: false,
  };
  function owns(where: Ownership) {
    return job.id === where.id && job.status === where.status && job.leaseToken === where.leaseToken &&
      (!where.leaseUntil || (job.leaseUntil !== null && job.leaseUntil > where.leaseUntil.gt)) &&
      (!where.expiresAt || job.expiresAt <= where.expiresAt.lte);
  }
  const writes: { where: Ownership; data: { status: string } }[] = [];
  const queue = {
    updateMany: async ({ where, data }: (typeof writes)[number]) => {
      writes.push({ where, data });
      if (!owns(where)) return { count: 0 };
      Object.assign(job, data);
      return { count: 1 };
    },
    findFirst: async ({ where }: { where: Ownership }) => {
      const current = owns(where) ? { expiresAt: job.expiresAt, leaseUntil: job.leaseUntil } : null;
      hooks.preflight();
      return current;
    },
  };
  const table = channel === 'telegram' ? 'telegramNotification' : 'webPushDelivery';
  let claimedToken = '';
  const db = {
    [table]: queue,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      $queryRaw: async () => [{ id }],
      [table]: {
        updateMany: async () => ({ count: 0 }),
        update: async ({ data }: { data: { status: string; leaseToken: string; leaseUntil: Date } }) => {
          claimedToken = data.leaseToken;
          Object.assign(job, data, { attempts: job.attempts + 1 });
          return { ...job };
        },
      },
    }),
    $queryRaw: async (sql: TemplateStringsArray, jobId: string, leaseToken: string) => {
      assert.match(sql.join('?'), /d\.status='sending'\s+AND d\.lease_token=/);
      const current = owns({ id: jobId, status: 'sending', leaseToken }) ? {
        ...push, id, endpoint: 'demo', endpointHash: 'demo', p256dh: 'demo', auth: 'demo',
        vapidPublicKey: config.publicKey, active: true,
        leaseUntil: job.leaseUntil, jobExpiresAt: job.expiresAt,
      } : null;
      hooks.preflight();
      return current ? [current] : [];
    },
    alertDelivery: {
      findUnique: async () => {
        hooks.snapshot();
        return { deviceName: 'Demo', location: 'Kệ thử', locationSource: 'device_location' };
      },
    },
  } as unknown as Database;
  return {
    hooks, job, writes, push,
    advance: (ms: number) => { elapsed = ms; },
    token: () => claimedToken,
    run: (send: (payload: string | PushPayload) => Promise<{ ok: true }>) =>
      channel === 'telegram'
        ? deliverTelegramNotification(db, send, start)
        : deliverWebPush(db, config, (_target, payload) => send(payload), start),
  };
}

for (const channel of ['telegram', 'webpush'] as const) {
  it(`${channel} does not call the service if the job expires during the final read`, async () => {
    const f = fixture(channel);
    f.hooks.preflight = () => f.advance(1000);
    let sends = 0;
    const result = await f.run(async () => { sends++; return { ok: true }; });
    assert.equal(sends, 0);
    assert.equal(f.job.status, 'expired');
    assert.equal(result.processed && result.status, 'expired');
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.writes[0]!.where, {
      id, status: 'sending', leaseToken: f.token(),
      leaseUntil: { gt: f.job.expiresAt }, expiresAt: { lte: f.job.expiresAt },
    });
  });

  it(`${channel} does not finalize a send when its lease has elapsed`, async () => {
    const f = fixture(channel, 60_000);
    let sends = 0;
    const result = await f.run(async () => {
      sends++;
      f.advance(30_000);
      return { ok: true };
    });
    assert.equal(sends, 1);
    assert.equal(f.job.status, 'sending');
    assert.equal(result.processed && result.status, 'lease_lost');
    assert.equal(f.writes[0]?.where.leaseToken, f.token());
    assert.deepEqual(f.writes[0]?.where.leaseUntil, { gt: f.job.leaseUntil });
  });
}

it('Telegram does not send or update a job whose token changed while reading the snapshot', async () => {
  const f = fixture('telegram');
  f.hooks.snapshot = () => { f.job.leaseToken = 'new-owner'; };
  const result = await f.run(async () => assert.fail('Transport called with stale lease'));
  assert.equal(result.processed && result.status, 'lease_lost');
  assert.equal(f.job.leaseToken, 'new-owner');
  assert.deepEqual(f.writes, []);
});

it('Web Push rechecks session expiry after the final read', async () => {
  const f = fixture('webpush', 60_000);
  f.push.expiresAt = new Date(f.job.expiresAt.getTime() - 59_000);
  f.hooks.preflight = () => f.advance(1000);
  const result = await f.run(async () => assert.fail('Transport called for an expired session'));
  assert.equal(result.processed && result.status, 'skipped');
  assert.equal(f.writes[0]?.where.status, 'sending');
});

it('Web Push does not send or update a job revoked before the final read', async () => {
  const f = fixture('webpush');
  f.hooks.snapshot = () => { f.job.status = 'skipped'; };
  const result = await f.run(async () => assert.fail('Transport called for a revoked job'));
  assert.equal(result.processed && result.status, 'revoked');
  assert.deepEqual(f.writes, []);
});
