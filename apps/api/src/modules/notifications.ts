import type { Database } from '@iot/database';
import type { AlertIncident, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { sendTelegram, type TelegramResult, type TelegramConfig } from './telegram-client.js';
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
      where: { incidentId_severity: { incidentId: incident.id, severity: incident.severity } },
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
  send: (text: string) => Promise<TelegramResult>,
  now = new Date(),
  includeSimulators = true,
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
    const [candidate] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM telegram_notifications
      WHERE attempts < 8 AND expires_at > ${now} AND
      ((status = 'pending' AND next_attempt_at <= ${now}) OR (status = 'sending' AND lease_until <= ${now}))
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!candidate) return null;
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
  const incident = row.incident;
  const device = incident.device;
  const condition =
    { gas: 'Gas (MQ-2)', co: 'CO (MQ-7)', flame: 'Flame' }[incident.condition] ??
    incident.condition;
  const text = [
    `${row.severity === 'critical' ? '🔴 CRITICAL' : '🟠 WARNING'} · AirGuard`,
    device.sourceKind === 'simulator'
      ? '⚠️ MÔ PHỎNG — KHÔNG PHẢI SỐ ĐO PHẦN CỨNG'
      : 'Nguồn: thiết bị phần cứng (trạng thái do thiết bị báo)',
    `Thiết bị: ${device.name}`,
    `Device ID: ${device.id}`,
    ...(device.location ? [`Vị trí: ${device.location}`] : []),
    `Điều kiện: ${condition}`,
    `Sự cố: ${incident.id}`,
    `Bắt đầu (UTC): ${incident.startedAt?.toISOString() ?? 'Chưa xác định'}`,
    `Server quan sát (UTC): ${incident.firstObservedAt.toISOString()}`,
    `Trạng thái khi chuẩn bị gửi: ${incident.status === 'ended' ? 'ĐÃ KẾT THÚC — thông báo sự kiện lịch sử' : 'CHƯA KẾT THÚC (không khẳng định trạng thái hiện tại nếu mất kết nối)'}`,
    ...(incident.severity !== row.severity
      ? [`Mức mới nhất trên server: ${incident.severity.toUpperCase()}`]
      : []),
    'Gas/CO chưa quy đổi PPM/AQI. Xác nhận trên web không tắt còi.',
    'Telegram phụ thuộc mạng, không thay thế cảnh báo cục bộ/hệ thống an toàn đạt chứng nhận.',
  ].join('\n');
  let result: TelegramResult;
  try {
    result = await send(text);
  } catch {
    result = { ok: false, retryable: true, code: 'TELEGRAM_NETWORK_ERROR' };
  }
  const finishedAt = new Date(Math.max(now.getTime(), Date.now()));
  const expired = row.expiresAt <= finishedAt;
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
    where: { id: row.id, status: 'sending', leaseToken },
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
) {
  let stopped = false;
  let pauseUntil = 0;
  let active: Promise<void> | undefined;
  const controller = new AbortController();
  const tick = () => {
    if (stopped || active || Date.now() < pauseUntil) return;
    active = (async () => {
      try {
        const result = await deliverTelegramNotification(
          db,
          (text) => sendTelegram(config, text, fetch, controller.signal),
          new Date(),
          config.includeSimulators,
        );
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
