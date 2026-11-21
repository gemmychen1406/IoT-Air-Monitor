import { scheduleCriticalReminders } from './alert-delivery/reminders.js';
import type { Database } from '@iot/database';
import type { AlertNotifier } from './notifications.js';
import { randomUUID } from 'node:crypto';
import { sendWebPush } from './web-push-client.js';
import { pushDetails, type PushAlertDetails } from './alert-delivery/message.js';
import { recordRevokedPushResult } from './alert-delivery/revoked-result.js';
import type { EnvironmentDeliveryHooks } from './environment/delivery.js';
export type WebPushConfig = { publicKey: string; privateKey: string; subject: string };
export type PushResult =
  | { ok: true }
  | { ok: false; code: string; retryable: boolean; gone?: boolean; retryAfterSeconds?: number };
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushPayload = {
  severity: string;
  condition?: string;
  incident_id: string;
  simulator: boolean;
  ended: boolean;
  url: string;
  round?: number;
  version?: 2;
  details?: PushAlertDetails;
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
      WHERE (s.browser_hash IS NOT NULL OR se.expires_at>${now}) AND u.active=true AND (cardinality(s.sensor_ids)=0 OR d.id=ANY(s.sensor_ids)) AND (d.source_kind='physical' OR s.include_simulators=true)
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
  quietUntil?: EnvironmentDeliveryHooks['quietUntil'],
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
            { browserHash: null, session: { expiresAt: { lte: now } } },
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
    const [candidate] = await tx.$queryRaw<{ id: string; userId: string; severity: string }[]>`SELECT d.id, se.user_id AS "userId", d.severity FROM web_push_deliveries d
      JOIN web_push_subscriptions s ON s.id=d.subscription_id JOIN sessions se ON se.id=s.session_id JOIN users u ON u.id=se.user_id
      WHERE d.attempts<8 AND d.expires_at>${now} AND (s.browser_hash IS NOT NULL OR se.expires_at>${now}) AND u.active=true AND s.vapid_public_key=${config.publicKey}
      AND ((d.status='pending' AND d.next_attempt_at<=${now}) OR (d.status='sending' AND d.lease_until<=${now}))
      ORDER BY d.created_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`;
    if (!candidate) return null;
    const quiet = await quietUntil?.(tx, candidate.userId, candidate.severity, now);
    if (quiet) {
      await tx.webPushDelivery.update({
        where: { id: candidate.id },
        data: { status: 'pending', nextAttemptAt: quiet, leaseToken: null, leaseUntil: null, lastErrorCode: 'QUIET_HOURS' },
      });
      return { deferred: candidate.id };
    }
    const claimed = await tx.webPushDelivery.update({
      where: { id: candidate.id },
      data: {
        status: 'sending',
        attempts: { increment: 1 },
        leaseToken,
        leaseUntil: new Date(now.getTime() + 30000),
      },
      include: {
        incident: { include: { device: true } },
      },
    });
    return { ...claimed, userId: candidate.userId };
  });
  if (!row) return { processed: false as const };
  if ('deferred' in row)
    return { processed: true as const, status: 'pending', notificationId: row.deferred, code: 'QUIET_HOURS' };
  // Keep the legacy private payload unless the account opts in.
  const payload: PushPayload = {
    severity: row.severity,
    condition: row.incident.condition,
    ...(row.round ? {round:row.round} : {}),
    incident_id: row.incidentId,
    simulator: row.incident.device.sourceKind === 'simulator',
    ended: row.incident.status === 'ended',
    url: `/app/alerts/${row.incidentId}`,
  };
  const snapshot = await db.alertDelivery.findUnique({
    where: { channel_jobId: { channel: 'webpush', jobId: row.id } },
    select: { deviceName: true, location: true, locationSource: true },
  });
  const quiet = await quietUntil?.(db, row.userId, row.severity, new Date(Math.max(now.getTime(), Date.now())));
  const [current] = await db.$queryRaw<{
    id: string;
    endpoint: string;
    endpointHash: string;
    p256dh: string;
    auth: string;
    vapidPublicKey: string;
    includeSimulators: boolean;
    expiresAt: Date;
    jobExpiresAt: Date;
    leaseUntil: Date | null;
    active: boolean;
    filtered: boolean;
    timezone: string;
    stoppedReminder: boolean;
    persistent: boolean;
    showDetails: boolean;
  }[]>`
    SELECT (d.round > 0 AND (i.status <> 'active' OR i.severity <> 'critical' OR EXISTS
      (SELECT 1 FROM alert_receipts r WHERE r.incident_id=i.id))) AS "stoppedReminder",
      (cardinality(s.sensor_ids)>0 AND NOT i.device_id=ANY(s.sensor_ids)) AS filtered,
      COALESCE((SELECT config->>'timezone' FROM environment_policies WHERE id='webpush:' || u.id::text),'Asia/Ho_Chi_Minh') AS timezone,
      s.id, s.endpoint, s.endpoint_hash AS "endpointHash", s.p256dh, s.auth,
      s.vapid_public_key AS "vapidPublicKey", s.include_simulators AS "includeSimulators",
      s.browser_hash IS NOT NULL AS persistent, se.expires_at AS "expiresAt", d.expires_at AS "jobExpiresAt", d.lease_until AS "leaseUntil",
      u.active, u.push_show_details AS "showDetails"
    FROM web_push_deliveries d JOIN alert_incidents i ON i.id=d.incident_id
    JOIN web_push_subscriptions s ON s.id=d.subscription_id
    JOIN sessions se ON se.id=s.session_id JOIN users u ON u.id=se.user_id
    WHERE d.id=${row.id}::uuid AND d.status='sending'
      AND d.lease_token=${leaseToken}::uuid
  `;
  const checkedAt = new Date(Math.max(now.getTime(), Date.now()));
  const outcome = { processed: true as const, notificationId: row.id };
  const owner = { id: row.id, status: 'sending', leaseToken };
  if (!current)
    return { ...outcome, status: 'revoked', code: 'PUSH_AUTH_REVOKED' };
  if (!current.leaseUntil || current.leaseUntil <= checkedAt)
    return { ...outcome, status: 'lease_lost', code: null };
  if (current.jobExpiresAt <= checkedAt) {
    const expired = await db.webPushDelivery.updateMany({
      where: { ...owner, leaseUntil: { gt: checkedAt }, expiresAt: { lte: checkedAt } },
      data: { status: 'expired', leaseToken: null, leaseUntil: null, lastErrorCode: 'DELIVERY_EXPIRED' },
    });
    return expired.count
      ? { ...outcome, status: 'expired', code: 'DELIVERY_EXPIRED' }
      : { ...outcome, status: 'lease_lost', code: null };
  }
  if (
    current.filtered || current.stoppedReminder ||
    (!current.persistent && current.expiresAt <= checkedAt) ||
    !current.active ||
    current.vapidPublicKey !== config.publicKey ||
    (payload.simulator && !current.includeSimulators)
  ) {
    const skipped = await db.webPushDelivery.updateMany({
      where: { ...owner, leaseUntil: { gt: checkedAt } },
      data: {
        status: 'skipped',
        lastErrorCode: current.stoppedReminder ? 'REMINDER_STOPPED' : 'PUSH_AUTH_REVOKED',
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return skipped.count
      ? { ...outcome, status: 'skipped', code: current.stoppedReminder ? 'REMINDER_STOPPED' : 'PUSH_AUTH_REVOKED' }
      : { ...outcome, status: 'lease_lost', code: null };
  }
  if (quiet && quiet > checkedAt) {
    const deferred = await db.webPushDelivery.updateMany({
      where: { ...owner, leaseUntil: { gt: checkedAt } },
      data: { status: 'pending', nextAttemptAt: quiet, leaseToken: null, leaseUntil: null, lastErrorCode: 'QUIET_HOURS' },
    });
    return { ...outcome, status: deferred.count ? 'pending' : 'lease_lost', code: 'QUIET_HOURS' };
  }
  let result: PushResult;
  try {
    if (current.showDetails) {
      payload.version = 2;
      payload.details = {...pushDetails(row.incident, row.incident.device.name, snapshot), timezone:current.timezone};
    }
    result = await send(
      { endpoint: current.endpoint, keys: { p256dh: current.p256dh, auth: current.auth } },
      payload,
    );
  } catch {
    result = { ok: false, retryable: true, code: 'WEB_PUSH_NETWORK_ERROR' };
  }
  const completed = new Date(Math.max(Date.now(), now.getTime()));
  const status = result.ok
    ? 'sent'
    : current.jobExpiresAt <= completed
      ? 'expired'
      : !result.gone && result.retryable && row.attempts < 8
        ? 'pending'
        : 'failed';
  const delay = result.ok
    ? 0
    : Math.max(
        (result.retryAfterSeconds ?? 0) * 1000,
        Math.min(5000 * 2 ** (row.attempts - 1), 900000),
      );
  const updated = await db.webPushDelivery.updateMany({
    where: { ...owner, leaseUntil: { gt: completed } },
    data: {
      status,
      sentAt: result.ok ? completed : null,
      lastErrorCode: result.ok ? null : result.code,
      nextAttemptAt: new Date(completed.getTime() + delay),
      leaseToken: null,
      leaseUntil: null,
    },
  });
  if (!updated.count && current.leaseUntil > completed)
    await recordRevokedPushResult(db, row.id, row.attempts, result, completed);
  if (!result.ok && result.gone && updated.count) {
    await db.webPushSubscription.deleteMany({ where: { id: current.id, endpointHash: current.endpointHash } });
    return { processed: true as const, status: 'gone', notificationId: row.id, code: result.code };
  }
  return {
    processed: true as const,
    status: updated.count ? status : 'lease_lost',
    notificationId: row.id,
    code: result.ok ? null : result.code,
  };
}

export function startWebPushWorker(
  db: Database,
  config: WebPushConfig,
  log: (entry: { notification_id?: string; status?: string; code?: string | null }) => void,
  environment?: EnvironmentDeliveryHooks,
  reminderSeconds = 300,
) {
  let nextSchedule = 0;
  let stopped = false;
  let pauseUntil = 0;
  let active: Promise<void> | undefined;
  const tick = () => {
    if (stopped || active || Date.now() < pauseUntil) return;
    active = (async () => {
      try {
        if (Date.now() >= nextSchedule) {
          await scheduleCriticalReminders(db, 'webpush', reminderSeconds);
          nextSchedule = Date.now() + 5000;
        }
        const alert = await deliverWebPush(
          db, config, (target, payload) => sendWebPush(config, target, payload),
          new Date(), environment?.quietUntil,
        );
        const result = !alert.processed && environment ? await environment.idle() : alert;
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
