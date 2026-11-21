import { scheduleCriticalReminders } from './alert-delivery/reminders.js';
import type { Database } from '@iot/database';
import type { AlertIncident, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { sendTelegram, type TelegramResult, type TelegramConfig } from './telegram-client.js';
import { incidentWebLink, telegramMessage } from './alert-delivery/message.js';
import type { EnvironmentDeliveryHooks } from './environment/delivery.js';
export type AlertNotifier = (
  tx: Prisma.TransactionClient,
  incident: AlertIncident,
) => Promise<void>;
export function telegramNotifier(includeSimulators: boolean): AlertNotifier {
  return async (tx, incident) => {
    if (!['warning', 'critical'].includes(incident.severity)) return;
    const device = await tx.device.findUniqueOrThrow({ where: { id: incident.deviceId } });
    if (device.sourceKind === 'simulator' && !includeSimulators) return;
    const now = new Date();
    await tx.telegramNotification.upsert({
      where: { incidentId_severity_round: { incidentId: incident.id, severity: incident.severity, round: 0 } },
      create: {
        incidentId: incident.id,
        severity: incident.severity,
        createdAt: now,
        nextAttemptAt: now,
        expiresAt: new Date(now.getTime() + 6 * 3600000),
      },
      update: {},
    });
  };
}

export async function deliverTelegramNotification(
  db: Database,
  send: (text: string, link?: string | null) => Promise<TelegramResult>,
  now = new Date(),
  includeSimulators = true,
  webOrigin?: string,
  quietUntil?: EnvironmentDeliveryHooks['quietUntil'],
  readTimezone?: () => Promise<string>,
) {
  const leaseToken = randomUUID();
  const row = await db.$transaction(async (tx) => {
    const idle = { OR: [{ status: 'pending' }, { status: 'sending', leaseUntil: { lte: now } }] };
    if (!includeSimulators)
      await tx.telegramNotification.updateMany({
        where: { ...idle, incident: { device: { sourceKind: 'simulator' } } },
        data: {
          status: 'skipped',
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: 'SIMULATOR_NOT_ALLOWED',
        },
      });
    await tx.telegramNotification.updateMany({
      where: { ...idle, expiresAt: { lte: now } },
      data: {
        status: 'expired',
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: 'DELIVERY_EXPIRED',
      },
    });
    await tx.telegramNotification.updateMany({
      where: { ...idle, attempts: { gte: 8 }, expiresAt: { gt: now } },
      data: { status: 'failed', leaseToken: null, leaseUntil: null, lastErrorCode: 'MAX_ATTEMPTS' },
    });
    const [candidate] = await tx.$queryRaw<{ id: string; severity: string }[]>`SELECT id, severity FROM telegram_notifications
      WHERE attempts < 8 AND expires_at > ${now} AND
      ((status = 'pending' AND next_attempt_at <= ${now}) OR (status = 'sending' AND lease_until <= ${now}))
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!candidate) return null;
    const quiet = await quietUntil?.(tx, null, candidate.severity, now);
    if (quiet) {
      await tx.telegramNotification.update({
        where: { id: candidate.id },
        data: { status: 'pending', nextAttemptAt: quiet, leaseToken: null, leaseUntil: null, lastErrorCode: 'QUIET_HOURS' },
      });
      return { deferred: candidate.id };
    }
    return tx.telegramNotification.update({
      where: { id: candidate.id },
      data: {
        status: 'sending',
        attempts: { increment: 1 },
        leaseToken,
        leaseUntil: new Date(now.getTime() + 30000),
      },
      include: { incident: { include: { device: true } } },
    });
  });
  if (!row) return { processed: false as const };
  if ('deferred' in row)
    return { processed: true as const, status: 'pending', notificationId: row.deferred, cooldownMs: 1000, code: 'QUIET_HOURS' };
  const snapshot = await db.alertDelivery.findUnique({
    where: { channel_jobId: { channel: 'telegram', jobId: row.id } },
    select: { deviceName: true, location: true, locationSource: true },
  });
  const text = telegramMessage(row.severity, row.incident, row.incident.device, snapshot, webOrigin, await readTimezone?.(), row.round);
  const quiet = await quietUntil?.(db, null, row.severity, new Date(Math.max(now.getTime(), Date.now())));
  const owner = { id: row.id, status: 'sending', leaseToken };
  const current = row.round > 0
    ? (await db.$queryRaw<{expiresAt:Date;leaseUntil:Date|null;stoppedReminder:boolean}[]>`
        SELECT d.expires_at AS "expiresAt", d.lease_until AS "leaseUntil",
          (i.status <> 'active' OR i.severity <> 'critical' OR EXISTS
            (SELECT 1 FROM alert_receipts r WHERE r.incident_id = i.id)) AS "stoppedReminder"
        FROM telegram_notifications d JOIN alert_incidents i ON i.id = d.incident_id
        WHERE d.id=${row.id}::uuid AND d.status='sending' AND d.lease_token=${leaseToken}::uuid
      `)[0]
    : await db.telegramNotification.findFirst({where:owner, select:{expiresAt:true,leaseUntil:true}});
  const checkedAt = new Date(Math.max(now.getTime(), Date.now()));
  const outcome = { processed: true as const, notificationId: row.id, cooldownMs: 1000 };
  if (!current?.leaseUntil || current.leaseUntil <= checkedAt)
    return { ...outcome, status: 'lease_lost', code: null };
  if (current.expiresAt <= checkedAt) {
    const expired = await db.telegramNotification.updateMany({
      where: { ...owner, leaseUntil: { gt: checkedAt }, expiresAt: { lte: checkedAt } },
      data: { status: 'expired', leaseToken: null, leaseUntil: null, lastErrorCode: 'DELIVERY_EXPIRED' },
    });
    return expired.count
      ? { ...outcome, status: 'expired', code: 'DELIVERY_EXPIRED' }
      : { ...outcome, status: 'lease_lost', code: null };
  }
  if ('stoppedReminder' in current && current.stoppedReminder) {
    const skipped = await db.telegramNotification.updateMany({where:{...owner,leaseUntil:{gt:checkedAt}},
      data:{status:'skipped',leaseUntil:null,leaseToken:null,lastErrorCode:'REMINDER_STOPPED'}});
    return {...outcome,status:skipped.count ? 'skipped' : 'lease_lost',code:'REMINDER_STOPPED'};
  }
  if (quiet && quiet > checkedAt) {
    const deferred = await db.telegramNotification.updateMany({
      where: { ...owner, leaseUntil: { gt: checkedAt } },
      data: { status: 'pending', nextAttemptAt: quiet, leaseToken: null, leaseUntil: null, lastErrorCode: 'QUIET_HOURS' },
    });
    return { ...outcome, status: deferred.count ? 'pending' : 'lease_lost', code: 'QUIET_HOURS' };
  }
  let result: TelegramResult;
  try {
    result = await send(text, incidentWebLink(webOrigin,row.incidentId));
  } catch {
    result = { ok: false, retryable: true, code: 'TELEGRAM_NETWORK_ERROR' };
  }
  const finishedAt = new Date(Math.max(now.getTime(), Date.now()));
  const expired = current.expiresAt <= finishedAt;
  const status = result.ok
    ? 'sent'
    : expired
      ? 'expired'
      : result.retryable && row.attempts < 8
        ? 'pending'
        : 'failed';
  const retryMs = result.ok
    ? 0
    : Math.max(
        (result.retryAfterSeconds ?? 0) * 1000,
        Math.min(5000 * 2 ** (row.attempts - 1), 900000),
      );
  const code = result.ok ? null : result.code;
  const updated = await db.telegramNotification.updateMany({
    where: { ...owner, leaseUntil: { gt: finishedAt } },
    data: {
      status,
      leaseToken: null,
      leaseUntil: null,
      sentAt: result.ok ? finishedAt : null,
      lastErrorCode: code,
      nextAttemptAt: new Date(finishedAt.getTime() + retryMs),
    },
  });
  return {
    processed: true as const,
    notificationId: row.id,
    status: updated.count ? status : 'lease_lost',
    code,
    cooldownMs: !result.ok && result.code === 'TELEGRAM_RATE_LIMITED' ? retryMs : 1000,
  };
}

export function startTelegramWorker(
  db: Database,
  config: TelegramConfig,
  log: (entry: { notification_id?: string; status?: string; code?: string | null }) => void,
  webOrigin?: string,
  environment?: EnvironmentDeliveryHooks,
  reminderSeconds = 300,
) {
  let nextSchedule = 0;
  let stopped = false;
  let pauseUntil = 0;
  let active: Promise<void> | undefined;
  const controller = new AbortController();
  const tick = () => {
    if (stopped || active || Date.now() < pauseUntil) return;
    active = (async () => {
      try {
        if (Date.now() >= nextSchedule) {
          await scheduleCriticalReminders(db, 'telegram', reminderSeconds);
          nextSchedule = Date.now() + 5000;
        }
        const alert = await deliverTelegramNotification(
          db,
          (text,link) => sendTelegram(config, text, fetch, controller.signal,link),
          new Date(),
          config.includeSimulators,
          webOrigin,
          environment?.quietUntil,
          async () => {
            const policy = await db.environmentPolicy.findUnique({where:{id:'telegram'},select:{config:true}});
            return (policy?.config as {timezone?:string} | null)?.timezone ?? 'Asia/Ho_Chi_Minh';
          },
        );
        const result = !alert.processed && environment ? await environment.idle() : alert;
        if (result.processed) {
          pauseUntil = Date.now() + result.cooldownMs;
          log({ notification_id: result.notificationId, status: result.status, code: result.code });
        }
      } catch {
        log({ code: 'TELEGRAM_WORKER_FAILED' });
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
    controller.abort();
    await active;
  };
}
