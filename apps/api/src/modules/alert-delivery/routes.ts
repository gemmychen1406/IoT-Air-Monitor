import type { Router } from 'express';
import type { Prisma } from '@prisma/client';
import {
  conditionSchema, counterSchema, deliveryChannels, deliveryStatuses, pushPreferenceInput,
  type DeliveryHistoryView, type IncidentReceiptsView, type UserView,
} from '@iot/contracts';
import { z } from 'zod';
import type { FeatureContext } from '../../lib/context.js';
import { ApiError } from '../../lib/errors.js';
import { eligibleForReceipt, receiptView, recordReceipt } from './receipt.js';

const historyQuery = z.strictObject({
  condition: conditionSchema.optional(),
  channel: z.enum(deliveryChannels).optional(),
  status: z.enum(deliveryStatuses).optional(),
  device_id: z.uuid().optional(),
  incident_id: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: counterSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).refine((q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to), 'Khoảng thời gian không hợp lệ.');
const receiptQuery = z.strictObject({ after: z.uuid().optional() });
const noReceiptInput = z.strictObject({}).optional();

export function registerAlertDelivery(router: Router, { db, reply }: FeatureContext) {
  router.get('/push/preferences', async (_req, res) => {
    const user = res.locals.session.user as UserView;
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { pushShowDetails: true } });
    reply(res, { show_details: row.pushShowDetails });
  });

  router.put('/push/preferences', async (req, res) => {
    const user = res.locals.session.user as UserView;
    const input = pushPreferenceInput.parse(req.body);
    const row = await db.user.update({
      where: { id: user.id },
      data: { pushShowDetails: input.show_details },
      select: { pushShowDetails: true },
    });
    reply(res, { show_details: row.pushShowDetails });
  });

  router.get('/alerts/incidents/:id/receipts', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { after } = receiptQuery.parse(req.query);
    const user = res.locals.session.user as UserView;
    if (!(await db.alertIncident.findUnique({ where: { id }, select: { id: true } })))
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sự cố.');
    const [target, mine] = await Promise.all([
      eligibleForReceipt(db, id, user.id),
      db.alertReceipt.findUnique({ where: { incidentId_userId: { incidentId: id, userId: user.id } } }),
    ]);
    const data: IncidentReceiptsView = { eligible: !!target, mine: mine && receiptView(mine) };
    if (user.role === 'viewer') return reply(res, data);
    const rows = await db.alertReceipt.findMany({
      where: { incidentId: id, userId: after ? { gt: after } : undefined },
      orderBy: { userId: 'asc' },
      take: 26,
      include: { user: { select: { email: true } } },
    });
    const page = rows.slice(0, 25);
    data.team = page.map((row) => ({ user_id: row.userId, email: row.user.email, receipt: receiptView(row) }));
    reply(res, data, { next_cursor: rows.length > page.length ? page.at(-1)?.userId : null });
  });

  router.post('/alerts/incidents/:id/receipts', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    noReceiptInput.parse(req.body);
    const { user, sessionId } = res.locals.session as { user: UserView; sessionId: string };
    const receipt = await db.$transaction((tx) => recordReceipt(tx, id, user.id, sessionId));
    reply(res, receipt);
  });

  router.get('/alerts/delivery-history', async (req, res) => {
    const user = res.locals.session.user as UserView;
    const q = historyQuery.parse(req.query);
    const owner: Prisma.AlertDeliveryWhereInput = { channel: 'webpush', recipientUserId: user.id };
    const visibility = user.role === 'admin' ? [owner, { channel: 'telegram' }] : [owner];
    const rows = await db.alertDelivery.findMany({
      where: {
        OR: visibility,
        channel: q.channel,
        status: q.status,
        incidentId: q.incident_id,
        ordinal: q.cursor ? { lt: BigInt(q.cursor) } : undefined,
        incident: { condition: q.condition, deviceId: q.device_id },
        createdAt: {
          gte: q.from ? new Date(q.from) : undefined,
          lt: q.to ? new Date(q.to) : undefined,
        },
      },
      orderBy: { ordinal: 'desc' },
      take: q.limit + 1,
      include: {
        attemptHistory: { orderBy: { number: 'asc' } },
        incident: {
          include: {
            device: { select: { name: true, sourceKind: true } },
            receipts: { where: { userId: user.id } },
          },
        },
      },
    });
    const page = rows.slice(0, q.limit);
    const data: DeliveryHistoryView[] = page.map((row) => ({
      id: String(row.ordinal),
      target_id: row.targetId, round: row.round,
      incident_id: row.incidentId,
      condition: conditionSchema.parse(row.incident.condition),
      channel: z.enum(deliveryChannels).parse(row.channel),
      severity: row.severity,
      status: z.enum(deliveryStatuses).parse(row.status),
      simulator: row.incident.device.sourceKind === 'simulator',
      ended: row.incident.status === 'ended',
      device_name: row.deviceName ?? row.incident.device.name,
      location: row.location,
      location_source: z.enum(['assignment', 'device_location', 'none', 'legacy']).parse(row.locationSource ?? 'legacy'),
      created_at: row.createdAt.toISOString(),
      next_attempt_at: row.nextAttemptAt.toISOString(),
      accepted_at: row.acceptedAt?.toISOString() ?? null,
      last_error_code: row.lastErrorCode,
      attempt_count: row.attempts,
      attempts: row.attemptHistory.map((attempt) => ({
        number: attempt.number,
        outcome: attempt.outcome,
        started_at: attempt.startedAt.toISOString(),
        finished_at: attempt.finishedAt?.toISOString() ?? null,
        error_code: attempt.errorCode,
      })),
      my_receipt: row.incident.receipts[0] ? receiptView(row.incident.receipts[0]) : null,
    }));
    reply(res, data, { next_cursor: rows.length > page.length ? data.at(-1)?.id : null });
  });
}
