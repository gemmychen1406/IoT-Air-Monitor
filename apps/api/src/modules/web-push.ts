import type { Database } from '@iot/database';
import type { AlertNotifier } from './notifications.js';
import { randomUUID } from 'node:crypto';
import { sendWebPush } from './web-push-client.js';
export type WebPushConfig = { publicKey: string; privateKey: string; subject: string };
export type PushResult =
  | { ok: true }
  | { ok: false; code: string; retryable: boolean; gone?: boolean; retryAfterSeconds?: number };
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushPayload = {
  severity: string;
  incident_id: string;
  simulator: boolean;
  ended: boolean;
  url: string;
};
export function webPushNotifier(): AlertNotifier {
  return async (tx, incident) => {
    if (!['warning', 'critical'].includes(incident.severity)) return;
    const now = new Date();
    // Lock candidate subscriptions until enqueue commits so concurrent logout
    // cannot delete a parent between the SELECT and delivery FK insertion.
    const subscriptions = await tx.$queryRaw<
      { id: string }[]
    >`SELECT s.id FROM web_push_subscriptions s
      JOIN sessions se ON se.id=s.session_id JOIN users u ON u.id=se.user_id
      JOIN devices d ON d.id=${incident.deviceId}::uuid
      WHERE se.expires_at>${now} AND u.active=true AND (d.source_kind='physical' OR s.include_simulators=true)
      FOR KEY SHARE OF s`;
    if (subscriptions.length)
      await tx.webPushDelivery.createMany({
        data: subscriptions.map((s) => ({
          incidentId: incident.id,
          severity: incident.severity,
          subscriptionId: s.id,
          expiresAt: new Date(now.getTime() + 6 * 3600000),
        })),
        skipDuplicates: true,
      });
  };
}
export async function deliverWebPush(
  db: Database,
  config: WebPushConfig,
  send: (target: PushTarget, payload: PushPayload) => Promise<PushResult>,
  now = new Date(),
) {
  const leaseToken = randomUUID();
  const row = await db.$transaction(async (tx) => {
    const idle = { OR: [{ status: 'pending' }, { status: 'sending', leaseUntil: { lte: now } }] };
    await tx.webPushDelivery.updateMany({
      where: {
        ...idle,
        subscription: {
          OR: [
            { vapidPublicKey: { not: config.publicKey } },
            { session: { expiresAt: { lte: now } } },
            { session: { user: { active: false } } },
          ],
        },
      },
      data: {
        status: 'skipped',
        lastErrorCode: 'PUSH_AUTH_REVOKED',
        leaseToken: null,
        leaseUntil: null,
      },
    });
    await tx.webPushDelivery.updateMany({
      where: { ...idle, expiresAt: { lte: now } },
      data: {
        status: 'expired',
        lastErrorCode: 'DELIVERY_EXPIRED',
        leaseToken: null,
        leaseUntil: null,
      },
    });
    await tx.webPushDelivery.updateMany({
      where: { ...idle, attempts: { gte: 8 } },
      data: { status: 'failed', lastErrorCode: 'MAX_ATTEMPTS', leaseToken: null, leaseUntil: null },
    });
    const [candidate] = await tx.$queryRaw<{ id: string }[]>`SELECT d.id FROM web_push_deliveries d
      JOIN web_push_subscriptions s ON s.id=d.subscription_id JOIN sessions se ON se.id=s.session_id JOIN users u ON u.id=se.user_id
      WHERE d.attempts<8 AND d.expires_at>${now} AND se.expires_at>${now} AND u.active=true AND s.vapid_public_key=${config.publicKey}
      AND ((d.status='pending' AND d.next_attempt_at<=${now}) OR (d.status='sending' AND d.lease_until<=${now}))
      ORDER BY d.created_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`;
    if (!candidate) return null;
    return tx.webPushDelivery.update({
      where: { id: candidate.id },
      data: {
        status: 'sending',
        attempts: { increment: 1 },
        leaseToken,
        leaseUntil: new Date(now.getTime() + 30000),
      },
      include: {
        subscription: { include: { session: { include: { user: true } } } },
        incident: { include: { device: true } },
      },
    });
  });
  if (!row) return { processed: false as const };
  // Payload deliberately contains no name, location, readings, email or endpoint:
  // a provider can deliver a previously accepted notification after logout.
  const payload: PushPayload = {
    severity: row.severity,
    incident_id: row.incidentId,
    simulator: row.incident.device.sourceKind === 'simulator',
    ended: row.incident.status === 'ended',
    url: `/app/alerts/${row.incidentId}`,
  };
  const current = await db.webPushSubscription.findUnique({
    where: { id: row.subscriptionId },
    include: { session: { include: { user: true } } },
  });
  if (!current)
    return {
      processed: true as const,
      status: 'revoked',
      notificationId: row.id,
      code: 'PUSH_AUTH_REVOKED',
    };
  if (
    current.session.expiresAt <= new Date() ||
    !current.session.user.active ||
    (payload.simulator && !current.includeSimulators)
  ) {
    await db.webPushDelivery.updateMany({
      where: { id: row.id, leaseToken },
      data: {
        status: 'skipped',
        lastErrorCode: 'PUSH_AUTH_REVOKED',
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return {
      processed: true as const,
      status: 'skipped',
      notificationId: row.id,
      code: 'PUSH_AUTH_REVOKED',
    };
  }
  let result: PushResult;
  try {
    result = await send(
      { endpoint: current.endpoint, keys: { p256dh: current.p256dh, auth: current.auth } },
      payload,
    );
  } catch {
    result = { ok: false, retryable: true, code: 'WEB_PUSH_NETWORK_ERROR' };
  }
  if (!result.ok && result.gone) {
    await db.webPushSubscription.deleteMany({ where: { id: current.id } });
    return { processed: true as const, status: 'gone', notificationId: row.id, code: result.code };
  }
  const completed = new Date(Math.max(Date.now(), now.getTime()));
  const status = result.ok
    ? 'sent'
    : row.expiresAt <= completed
      ? 'expired'
      : result.retryable && row.attempts < 8
        ? 'pending'
        : 'failed';
  const delay = result.ok
    ? 0
    : Math.max(
        (result.retryAfterSeconds ?? 0) * 1000,
        Math.min(5000 * 2 ** (row.attempts - 1), 900000),
      );
  await db.webPushDelivery.updateMany({
    where: { id: row.id, leaseToken, status: 'sending' },
    data: {
      status,
      sentAt: result.ok ? completed : null,
      lastErrorCode: result.ok ? null : result.code,
      nextAttemptAt: new Date(completed.getTime() + delay),
      leaseToken: null,
      leaseUntil: null,
    },
  });
  return {
    processed: true as const,
    status,
    notificationId: row.id,
    code: result.ok ? null : result.code,
  };
}

export function startWebPushWorker(
  db: Database,
  config: WebPushConfig,
  log: (entry: { notification_id?: string; status?: string; code?: string | null }) => void,
) {
  let stopped = false;
  let pauseUntil = 0;
  let active: Promise<void> | undefined;
  const tick = () => {
    if (stopped || active || Date.now() < pauseUntil) return;
    active = (async () => {
      try {
        const result = await deliverWebPush(db, config, (target, payload) =>
          sendWebPush(config, target, payload),
        );
        if (result.processed) {
          pauseUntil = Date.now() + 1000;
          log({ notification_id: result.notificationId, status: result.status, code: result.code });
        }
      } catch {
        log({ code: 'WEB_PUSH_WORKER_FAILED' });
      }
    })().finally(() => {
      active = undefined;
    });
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await active;
  };
}
