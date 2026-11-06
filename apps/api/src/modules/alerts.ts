import type { Router } from 'express';
import type { Prisma, AlertIncident, AlertState } from '@prisma/client';
import { z } from 'zod';
import {
  deviceEventsSchema,
  incidentQuerySchema,
  type Reading,
  type DeviceEvent,
} from '@iot/contracts';
import { ApiError } from '../lib/errors.js';
import { audit, lockDevice, type FeatureContext } from '../lib/context.js';
import { authenticateDevice, hashSecret } from './auth.js';
import { markSeen } from './presence.js';
import type { AlertNotifier } from './notifications.js';

type Tx = Prisma.TransactionClient;
type Order = { boot_id: string; boot_counter: string; seq: string };
const conditions = ['gas', 'co', 'flame'] as const;
const newer = (input: Order, previous: AlertState | null) =>
  !previous ||
  BigInt(input.boot_counter) > previous.bootCounter ||
  (BigInt(input.boot_counter) === previous.bootCounter &&
    input.boot_id === previous.bootId &&
    BigInt(input.seq) > previous.seq);

async function updateState(
  tx: Tx,
  deviceId: string,
  condition: string,
  state: string,
  incidentId: string | null,
  order: Order,
  now: Date,
) {
  const where = { deviceId_condition: { deviceId, condition } };
  const previous = await tx.alertState.findUnique({ where });
  if (!newer(order, previous)) return;
  const data = {
    state,
    incidentId,
    bootId: order.boot_id,
    bootCounter: BigInt(order.boot_counter),
    seq: BigInt(order.seq),
    updatedAt: now,
  };
  await tx.alertState.upsert({ where, create: { deviceId, condition, ...data }, update: data });
}

async function snapshotEvent(
  tx: Tx,
  incident: AlertIncident,
  transition: 'started' | 'ended',
  record: Reading,
  now: Date,
) {
  if (await tx.alertEvent.findFirst({ where: { incidentId: incident.id, transition } })) return;
  const payload = {
    transition,
    condition: incident.condition,
    boot_id: record.boot_id,
    seq: record.seq,
    sampled_at: record.sampled_at,
    origin: 'snapshot',
  };
  await tx.alertEvent.create({
    data: {
      deviceId: incident.deviceId,
      incidentId: incident.id,
      sourceEventId: `snapshot:${record.boot_id}:${record.seq}:${incident.condition}:${transition}`,
      transition,
      occurredAt: record.sampled_at,
      receivedAt: now,
      bootId: record.boot_id,
      bootCounter: BigInt(record.boot_counter),
      seq: BigInt(record.seq),
      payload,
      payloadHash: hashSecret(JSON.stringify(payload)),
    },
  });
}

export async function applySnapshot(
  tx: Tx,
  deviceId: string,
  record: Reading,
  now: Date,
  notify?: AlertNotifier,
) {
  let eventsChanged = false;
  for (const condition of conditions) {
    const current = await tx.alertState.findUnique({
      where: { deviceId_condition: { deviceId, condition } },
    });
    if (!newer(record, current)) continue;
    let state = record.alert_snapshot[condition];
    const sensor =
      condition === 'flame'
        ? record.sensors.flame
        : condition === 'gas'
          ? record.sensors.mq2
          : record.sensors.mq7;
    // Missing/invalid data can never clear an existing incident.
    if (state === 'normal' && ['invalid', 'warming_up', 'heating'].includes(sensor.quality))
      state = 'unknown';
    let incident = await tx.alertIncident.findFirst({
      where: { deviceId, condition, status: 'active' },
    });
    const externalId = record.alert_snapshot.incident_ids?.[condition];
    if (state === 'active') {
      if (incident && externalId && incident.externalId && incident.externalId !== externalId)
        throw new ApiError(
          409,
          'INCIDENT_ID_CONFLICT',
          'Cần kết thúc incident cũ trước khi dùng ID mới cho cùng điều kiện.',
        );
      if (incident && externalId && !incident.externalId)
        incident = await tx.alertIncident.update({
          where: { id: incident.id },
          data: { externalId },
        });
      if (!incident) {
        const previous = externalId
          ? await tx.alertIncident.findUnique({
              where: { deviceId_externalId: { deviceId, externalId } },
            })
          : null;
        if (previous) {
          // A late snapshot must not reopen an incident already ended by a durable event.
          await updateState(tx, deviceId, condition, 'normal', null, record, now);
          continue;
        }
        incident = await tx.alertIncident.create({
          data: {
            deviceId,
            condition,
            externalId,
            severity: condition === 'flame' ? 'critical' : 'warning',
            origin: 'snapshot',
            startedAt: record.sampled_at,
            firstObservedAt: now,
          },
        });
        await snapshotEvent(tx, incident, 'started', record, now);
        await notify?.(tx, incident);
        eventsChanged = true;
      }
    } else if (state === 'normal' && incident) {
      if (
        incident.startedAt &&
        record.sampled_at &&
        Date.parse(record.sampled_at) < incident.startedAt.getTime()
      )
        throw new ApiError(
          422,
          'INCIDENT_TIME_CONFLICT',
          'Thời điểm kết thúc trước thời điểm bắt đầu.',
        );
      incident = await tx.alertIncident.update({
        where: { id: incident.id },
        data: { status: 'ended', endedAt: record.sampled_at },
      });
      await snapshotEvent(tx, incident, 'ended', record, now);
      eventsChanged = true;
      incident = null;
    }
    await updateState(tx, deviceId, condition, state, incident?.id ?? null, record, now);
  }
  return eventsChanged;
}

async function applyEvent(
  tx: Tx,
  deviceId: string,
  event: DeviceEvent,
  now: Date,
  currentBootCounter: bigint | null,
  notify?: AlertNotifier,
) {
  const hash = hashSecret(JSON.stringify(event));
  const existing = await tx.alertEvent.findUnique({
    where: { deviceId_sourceEventId: { deviceId, sourceEventId: event.event_id } },
  });
  if (existing) {
    if (existing.payloadHash !== hash)
      throw new ApiError(409, 'IDENTITY_CONFLICT', 'Event ID đã tồn tại với nội dung khác.');
    return true;
  }
  if (event.occurred_at) {
    const age = now.getTime() - Date.parse(event.occurred_at);
    if (age < -60000 || age > 86400000)
      throw new ApiError(422, 'INVALID_EVENT_TIME', 'Event phải nằm trong cửa sổ 24 giờ.');
  }
  let incident = await tx.alertIncident.findUnique({
    where: { deviceId_externalId: { deviceId, externalId: event.incident_id } },
  });
  const isStart = event.transition === 'started';
  const previousSeverity = incident?.severity;
  if (!incident) {
    if (isStart) {
      const open = await tx.alertIncident.findFirst({
        where: { deviceId, condition: event.condition, status: 'active' },
      });
      const matchingInferredStart = open
        ? await tx.alertEvent.findFirst({
            where: {
              incidentId: open.id,
              transition: 'started',
              bootId: event.boot_id,
              bootCounter: BigInt(event.boot_counter),
              seq: BigInt(event.seq),
            },
          })
        : null;
      if (open && !open.externalId && open.origin === 'snapshot' && matchingInferredStart) {
        // Bind a previously inferred incident to the device's stable identity.
        incident = await tx.alertIncident.update({
          where: { id: open.id },
          data: { externalId: event.incident_id, origin: 'snapshot+event' },
        });
      } else if (open)
        throw new ApiError(
          409,
          'INCIDENT_ALREADY_OPEN',
          'Đã có incident khác đang mở cho điều kiện này.',
        );
    }
    incident ??= await tx.alertIncident.create({
      data: {
        deviceId,
        externalId: event.incident_id,
        condition: event.condition,
        severity: event.severity,
        origin: 'event',
        status: isStart ? 'active' : 'ended',
        firstObservedAt: now,
      },
    });
  }
  if (incident.condition !== event.condition)
    throw new ApiError(409, 'INCIDENT_CONDITION_CONFLICT', 'Incident ID không được đổi điều kiện.');
  const startedAt = isStart
    ? event.occurred_at
      ? new Date(event.occurred_at)
      : null
    : incident.startedAt;
  const endedAt = !isStart
    ? event.occurred_at
      ? new Date(event.occurred_at)
      : null
    : incident.endedAt;
  if (startedAt && endedAt && endedAt < startedAt)
    throw new ApiError(422, 'INCIDENT_TIME_CONFLICT', 'Thời điểm kết thúc trước bắt đầu.');
  const priorTransition = await tx.alertEvent.findFirst({
    where: { incidentId: incident.id, transition: event.transition },
  });
  if (priorTransition && !priorTransition.sourceEventId.startsWith('snapshot:'))
    throw new ApiError(
      409,
      'TRANSITION_ALREADY_RECORDED',
      'Transition đã có event_id khác. Retry phải giữ nguyên event_id.',
    );
  incident = await tx.alertIncident.update({
    where: { id: incident.id },
    data: {
      startedAt,
      endedAt,
      status: !isStart || incident.status === 'ended' ? 'ended' : 'active',
      severity:
        incident.severity === 'critical' || event.severity === 'critical' ? 'critical' : 'warning',
      origin: incident.origin === 'snapshot' ? 'snapshot+event' : incident.origin,
    },
  });
  const data = {
    deviceId,
    incidentId: incident.id,
    sourceEventId: event.event_id,
    transition: event.transition,
    occurredAt: event.occurred_at,
    receivedAt: now,
    bootId: event.boot_id,
    bootCounter: BigInt(event.boot_counter),
    seq: BigInt(event.seq),
    payload: event,
    payloadHash: hash,
  };
  if (priorTransition) await tx.alertEvent.update({ where: { id: priorTransition.id }, data });
  else await tx.alertEvent.create({ data });
  if (isStart || (previousSeverity && previousSeverity !== incident.severity))
    await notify?.(tx, incident);
  if (currentBootCounter === null || BigInt(event.boot_counter) >= currentBootCounter)
    await updateState(
      tx,
      deviceId,
      event.condition,
      incident.status === 'ended' ? 'normal' : 'active',
      incident.status === 'active' ? incident.id : null,
      event,
      now,
    );
  return false;
}

export function registerAlertTransport(
  router: Router,
  { db, reply, publish, notify }: Pick<FeatureContext, 'db' | 'reply' | 'publish' | 'notify'>,
) {
  router.post('/device/events', async (req, res) => {
    const key = await authenticateDevice(db, req.headers.authorization);
    const input = deviceEventsSchema.parse(req.body);
    if (input.device_id !== key.deviceId)
      throw new ApiError(403, 'DEVICE_MISMATCH', 'Key không thuộc thiết bị này.');
    const accepted = await db.$transaction(async (tx) => {
      const device = await lockDevice(tx, key.deviceId);
      const now = new Date();
      const rows = [];
      // Ordering of durable messages is independent of reception; ended-before-started is supported.
      for (const event of input.events) {
        if (device.bootCounter === BigInt(event.boot_counter) && device.bootId !== event.boot_id)
          throw new ApiError(409, 'BOOT_CONFLICT', 'Boot counter và boot_id không khớp.');
        rows.push({
          event_id: event.event_id,
          duplicate: await applyEvent(tx, device.id, event, now, device.bootCounter, notify),
        });
      }
      await markSeen(tx, device, now, key.keyId);
      return rows;
    });
    reply(res, { accepted });
    if (accepted.some((e) => !e.duplicate)) {
      publish('alert.event.created', key.deviceId);
      publish('alert.state.changed', key.deviceId);
    }
  });
}

const includeIncident = {
  device: { select: { name: true, sourceKind: true } },
  acknowledgement: { include: { user: { select: { id: true, email: true } } } },
} satisfies Prisma.AlertIncidentInclude;
type IncidentRow = Prisma.AlertIncidentGetPayload<{ include: typeof includeIncident }>;
function incidentView(i: IncidentRow) {
  return {
    id: i.id,
    external_id: i.externalId,
    device_id: i.deviceId,
    device_name: i.device.name,
    source_kind: i.device.sourceKind,
    condition: i.condition,
    severity: i.severity,
    status: i.status,
    origin: i.origin,
    started_at: i.startedAt?.toISOString() ?? null,
    ended_at: i.endedAt?.toISOString() ?? null,
    first_observed_at: i.firstObservedAt.toISOString(),
    acknowledgement: i.acknowledgement
      ? {
          acknowledged_at: i.acknowledgement.acknowledgedAt.toISOString(),
          note: i.acknowledgement.note,
          user: i.acknowledgement.user,
        }
      : null,
  };
}
export function registerAlerts(router: Router, { db, reply, operator, publish }: FeatureContext) {
  router.get('/alerts/states', async (req, res) => {
    const query = z.object({ device_id: z.uuid().optional() }).parse(req.query);
    const rows = await db.alertState.findMany({
      where: { deviceId: query.device_id },
      take: 3000,
      include: { incident: true },
    });
    reply(
      res,
      rows.map((s) => ({
        device_id: s.deviceId,
        condition: s.condition,
        state: s.state,
        incident_id: s.incidentId,
        updated_at: s.updatedAt.toISOString(),
        unresolved: s.incident?.status === 'active',
      })),
    );
  });
  router.get('/alerts/incidents', async (req, res) => {
    const q = incidentQuerySchema.parse(req.query);
    const where: Prisma.AlertIncidentWhereInput = {
      deviceId: q.device_id,
      condition: q.condition,
      severity: q.severity,
      status: q.status,
      ...(q.acknowledged
        ? { acknowledgement: q.acknowledged === 'true' ? { isNot: null } : { is: null } }
        : {}),
      ...(q.cursor ? { ordinal: { lt: BigInt(q.cursor) } } : {}),
      ...(q.from
        ? {
            OR: [
              { startedAt: { gte: new Date(q.from), lt: new Date(q.to!) } },
              { startedAt: null, firstObservedAt: { gte: new Date(q.from), lt: new Date(q.to!) } },
            ],
          }
        : {}),
    };
    const rows = await db.alertIncident.findMany({
      where,
      include: includeIncident,
      orderBy: { ordinal: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    reply(res, page.map(incidentView), {
      next_cursor: rows.length > q.limit ? String(page.at(-1)!.ordinal) : null,
    });
  });
  router.get('/alerts/incidents/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const incident = await db.alertIncident.findUnique({
      where: { id },
      include: {
        ...includeIncident,
        events: { orderBy: [{ bootCounter: 'asc' }, { seq: 'asc' }, { id: 'asc' }], take: 100 },
      },
    });
    if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sự cố.');
    reply(res, {
      ...incidentView(incident),
      events: incident.events.map((e) => ({
        id: String(e.id),
        transition: e.transition,
        occurred_at: e.occurredAt?.toISOString() ?? null,
        received_at: e.receivedAt.toISOString(),
        source_event_id: e.sourceEventId,
        boot_id: e.bootId,
        seq: String(e.seq),
      })),
    });
  });
  router.post('/alerts/incidents/:id/acknowledgements', operator, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z
      .strictObject({ note: z.string().trim().max(500).default('') })
      .parse(req.body ?? {});
    const incident = await db.alertIncident.findUnique({ where: { id } });
    if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sự cố.');
    const ack = await db.$transaction(async (tx) => {
      await lockDevice(tx, incident.deviceId);
      const existing = await tx.alertAcknowledgement.findUnique({ where: { incidentId: id } });
      if (existing) return existing;
      const created = await tx.alertAcknowledgement.create({
        data: { incidentId: id, userId: res.locals.session.user.id as string, note: input.note },
      });
      await audit(
        tx,
        res.locals.session.user.id as string,
        incident.deviceId,
        'incident.acknowledged',
        { incident_id: id },
      );
      return created;
    });
    reply(res, { acknowledged_at: ack.acknowledgedAt.toISOString(), note: ack.note });
    publish('alert.acknowledged', incident.deviceId);
  });
  router.get('/alerts/events', async (req, res) => {
    const q = incidentQuerySchema.parse(req.query);
    const rows = await db.alertEvent.findMany({
      where: {
        deviceId: q.device_id,
        ...(q.cursor ? { id: { lt: BigInt(q.cursor) } } : {}),
        ...(q.from ? { receivedAt: { gte: new Date(q.from), lt: new Date(q.to!) } } : {}),
        incident: {
          condition: q.condition,
          severity: q.severity,
          status: q.status,
          ...(q.acknowledged
            ? { acknowledgement: q.acknowledged === 'true' ? { isNot: null } : { is: null } }
            : {}),
        },
      },
      include: { incident: { select: { condition: true, severity: true } } },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    reply(
      res,
      page.map((e) => ({
        id: String(e.id),
        incident_id: e.incidentId,
        device_id: e.deviceId,
        condition: e.incident.condition,
        severity: e.incident.severity,
        transition: e.transition,
        occurred_at: e.occurredAt?.toISOString() ?? null,
        received_at: e.receivedAt.toISOString(),
      })),
      { next_cursor: rows.length > q.limit ? String(page.at(-1)!.id) : null },
    );
  });
}
