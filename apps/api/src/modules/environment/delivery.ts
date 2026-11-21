import { randomUUID } from 'node:crypto';
import type { Database } from '@iot/database';
import type { EnvironmentDelivery } from '@prisma/client';
import {
  environmentKindLabels, environmentPolicyInput, type EnvironmentAttempt, type EnvironmentKind,
  type EnvironmentPushPayload,
} from '@iot/contracts';
import type { TelegramResult } from '../telegram-client.js';
import type { PushResult, PushTarget } from '../web-push.js';
import { minute, quietEnd, type alertQuietUntil } from './policy.js';

type Transport =
  | { channel: 'telegram'; includeSimulators: boolean; send: (text: string) => Promise<TelegramResult> }
  | { channel: 'webpush'; publicKey: string; send: (target: PushTarget, payload: EnvironmentPushPayload) => Promise<PushResult> };
export function environmentAttempts(job: EnvironmentDelivery): EnvironmentAttempt[] {
  return job.attemptLog as unknown as EnvironmentAttempt[];
}

function interrupted(job: EnvironmentDelivery, at: Date) {
  return environmentAttempts(job).map((item) => item.outcome === 'sending'
    ? { ...item, outcome: 'unknown', finished_at: at.toISOString(), error_code: 'LEASE_EXPIRED' }
    : item);
}

export async function deliverEnvironment(
  db: Database, transport: Transport, clock = () => new Date(),
) {
  const now = clock();
  const token = randomUUID();
  const job = await db.$transaction(async (tx) => {
    const [candidate] = await tx.$queryRaw<{ ordinal: bigint }[]>`
      SELECT ordinal FROM environment_deliveries WHERE channel=${transport.channel}
      AND ((status='pending' AND next_attempt_at <= ${now}) OR (status='sending' AND lease_until <= ${now}))
      ORDER BY next_attempt_at, ordinal LIMIT 1 FOR UPDATE SKIP LOCKED
    `;
    if (!candidate) return null;
    const claimed = await tx.environmentDelivery.findUniqueOrThrow({ where: { ordinal: candidate.ordinal } });
    return tx.environmentDelivery.update({
      where: { ordinal: candidate.ordinal },
      data: {
        status: 'sending', leaseToken: token, leaseUntil: new Date(now.getTime() + 30_000),
        attemptLog: interrupted(claimed, now),
      },
    });
  });
  if (!job) return { processed: false as const };
  const owner = { ordinal: job.ordinal, status: 'sending', leaseToken: token };
  type State = 'expired' | 'skipped' | 'failed' | 'pending' | 'sent';
  const finish = async (
    status: State, at: Date, code: string | null, next = at,
    log = environmentAttempts(job),
    unstarted?: { number: number; leaseUntil: Date },
  ) => {
    const updated = await db.environmentDelivery.updateMany({
      where: {
        ...owner,
        leaseUntil: { gt: at, ...(unstarted ? { equals: unstarted.leaseUntil } : {}) },
        ...(unstarted ? { attempts: unstarted.number } : {}),
      },
      data: {
        status, lastErrorCode: code, nextAttemptAt: next, attemptLog: log,
        acceptedAt: status === 'sent' ? at : null, leaseUntil: null, leaseToken: null,
        ...(unstarted ? { attempts: { decrement: 1 } } : {}),
      },
    });
    return { processed: true as const, status: updated.count ? status : 'lease_lost', notificationId: job.id, code, cooldownMs: 1000 };
  };

  if (job.expiresAt <= now) return finish('expired', now, 'DELIVERY_EXPIRED');
  if (job.attempts >= 8) return finish('failed', now, 'MAX_ATTEMPTS');
  const readDevice = () => db.device.findUnique({
    where: { id: job.deviceId },
    select: {
      archivedAt: true, connectivity: true,
      statuses: { orderBy: { id: 'desc' }, take: 1, select: { id: true } },
    },
  });
  const readTarget = () => transport.channel === 'webpush' && job.subscriptionId
    ? db.webPushSubscription.findUnique({
        where: { id: job.subscriptionId },
        include: { session: { include: { user: { select: { active: true, pushShowDetails: true } } } } },
      })
    : null;
  const [stored, device, state, target, dependency, newer] = await Promise.all([
    db.environmentPolicy.findUniqueOrThrow({ where: { id: job.policyId } }),
    readDevice(),
    db.environmentDeviceState.findUnique({ where: { policyId_deviceId: { policyId: job.policyId, deviceId: job.deviceId } } }),
    readTarget(),
    job.dependsOn ? db.environmentDelivery.findUnique({ where: { id: job.dependsOn }, select: { status: true } }) : null,
    job.kind === 'digest' || job.kind === 'variation'
      ? db.environmentDelivery.findFirst({
          where: { policyId: job.policyId, deviceId: job.deviceId, kind: job.kind, occurredAt: { gt: job.occurredAt } },
          select: { ordinal: true },
        })
      : null,
  ]);
  const policy = environmentPolicyInput.parse(stored.config);
  const at = clock();
  if (job.expiresAt <= at) return finish('expired', at, 'DELIVERY_EXPIRED');
  const blocked = (
    rule: typeof policy, item: typeof device, push: typeof target, time: Date,
  ) => {
    const enabled = job.kind === 'digest' ? rule.digest.enabled
      : job.kind === 'variation' ? rule.variation.enabled : rule.connectivity.enabled;
    if (!rule.enabled || !enabled || !rule.device_ids.includes(job.deviceId) || !item || item.archivedAt)
      return 'POLICY_OR_DEVICE_DISABLED';
    if (job.simulator && (!rule.include_simulators || (transport.channel === 'telegram' && !transport.includeSimulators)))
      return 'SIMULATOR_NOT_ALLOWED';
    if (transport.channel === 'webpush' && (!push || push.session.userId !== job.userId ||
      !push.session.user.active || (!push.browserHash && push.session.expiresAt <= time) ||
      push.vapidPublicKey !== transport.publicKey || (job.simulator && !push.includeSimulators)))
      return 'PUSH_AUTH_REVOKED';
    if (job.kind === 'offline' && (item.connectivity !== 'offline' || String(item.statuses[0]?.id) !== job.sourceKey))
      return 'CONNECTION_FLAPPED';
    if (job.kind === 'online' && (item.connectivity !== 'online' || item.statuses[0]?.id.toString() !== job.sourceKey))
      return 'SUPERSEDED';
    return null;
  };
  if (!state || state.startedAt > job.createdAt) return finish('skipped', at, 'POLICY_OR_DEVICE_DISABLED');
  const firstBlock = blocked(policy, device, target, at);
  if (firstBlock) return finish('skipped', at, firstBlock);
  if (newer) return finish('skipped', at, 'SUPERSEDED');
  if (job.kind === 'online' && dependency?.status !== 'sent') {
    const waiting = dependency?.status === 'pending' || dependency?.status === 'sending';
    return waiting ? finish('pending', at, 'WAITING_FOR_OUTAGE', new Date(at.getTime() + minute))
      : finish('skipped', at, 'OUTAGE_NOT_SENT');
  }
  const quiet = quietEnd(policy, at);
  if (quiet) return finish('pending', at, 'QUIET_HOURS', quiet < job.expiresAt ? quiet : job.expiresAt);

  const lost = { processed: true as const, status: 'lease_lost', notificationId: job.id, code: null, cooldownMs: 1000 };
  const [live, destination, currentDevice] = await Promise.all([
    db.environmentDelivery.findFirst({
      where: owner, select: { policy: { select: { config: true } }, leaseUntil: true, expiresAt: true },
    }),
    readTarget(),
    readDevice(),
  ]);
  const beforeSend = clock();
  if (!live?.leaseUntil || live.leaseUntil <= beforeSend) return lost;
  if (live.expiresAt <= beforeSend) return finish('expired', beforeSend, 'DELIVERY_EXPIRED');
  const livePolicy = environmentPolicyInput.parse(live.policy.config);
  const finalBlock = blocked(livePolicy, currentDevice, destination, beforeSend);
  if (finalBlock) return finish('skipped', beforeSend, finalBlock);
  const quietNow = quietEnd(livePolicy, beforeSend);
  if (quietNow)
    return finish('pending', beforeSend, 'QUIET_HOURS', quietNow < live.expiresAt ? quietNow : live.expiresAt);
  const kind = job.kind as EnvironmentKind;
  const label = environmentKindLabels[kind];
  const text = [
    `${label} · ${job.deviceName}`, job.location ? `Vị trí: ${job.location}` : '',
    job.simulator ? 'Nguồn: mô phỏng' : '', job.summary,
  ].filter(Boolean).join('\n');
  const attempt = {
    number: job.attempts + 1, started_at: beforeSend.toISOString(),
    finished_at: null, outcome: 'sending', error_code: null,
  };
  const previousAttempts = environmentAttempts(job);
  const attempted = await db.environmentDelivery.updateMany({
    where: { ...owner, leaseUntil: { gt: beforeSend }, expiresAt: { gt: beforeSend } },
    data: { attemptLog: [...previousAttempts, attempt], attempts: { increment: 1 } },
  });
  if (!attempted.count) return lost;

  const sendAt = clock();
  if (live.leaseUntil <= sendAt) return lost;
  const unstarted = { number: attempt.number, leaseUntil: live.leaseUntil };
  if (live.expiresAt <= sendAt)
    return finish('expired', sendAt, 'DELIVERY_EXPIRED', sendAt, previousAttempts, unstarted);
  const quietAfterWrite = quietEnd(livePolicy, sendAt);
  if (quietAfterWrite)
    return finish('pending', sendAt, 'QUIET_HOURS',
      quietAfterWrite < live.expiresAt ? quietAfterWrite : live.expiresAt, previousAttempts, unstarted);

  let result: PushResult;
  try {
    result = transport.channel === 'telegram'
      ? await transport.send(text)
      : await transport.send({ endpoint: destination!.endpoint, keys: { p256dh: destination!.p256dh, auth: destination!.auth } }, {
          version: 3, notification_id: job.id, kind, simulator: job.simulator,
          url: '/app/notifications?view=environment',
          ...(destination!.session.user.pushShowDetails ? { details: { summary: text } } : {}),
        });
  } catch {
    result = { ok: false, retryable: true, code: 'TRANSPORT_ERROR' };
  }
  const done = clock();
  const status = result.ok ? 'sent' : job.expiresAt <= done ? 'expired'
    : result.retryable && !result.gone && job.attempts + 1 < 8 ? 'pending' : 'failed';
  const delay = result.ok ? 0 : Math.max((result.retryAfterSeconds ?? 0) * 1000, Math.min(5000 * 2 ** job.attempts, 900000));
  const code = result.ok ? null : result.code;
  const saved = await finish(status, done, code, new Date(done.getTime() + delay), [
    ...previousAttempts,
    { ...attempt, finished_at: done.toISOString(), outcome: status === 'pending' ? 'retry' : status, error_code: code },
  ]);
  if (!result.ok && result.gone && destination && saved.status === 'failed')
    await db.webPushSubscription.deleteMany({ where: { id: destination.id, endpointHash: destination.endpointHash } });
  return { ...saved, cooldownMs: !result.ok && /RATE_LIMITED$/.test(result.code) ? delay : 1000 };
}

export function environmentSender(db: Database, transport: Transport) {
  return () => deliverEnvironment(db, transport);
}

export type EnvironmentDeliveryHooks = {
  quietUntil: typeof alertQuietUntil;
  idle: ReturnType<typeof environmentSender>;
};
