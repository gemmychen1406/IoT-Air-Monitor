import type { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { archiveInput, contactInput, type IncidentSupportView } from '@iot/contracts';
import type { FeatureContext } from '../../lib/context.js';
import { ApiError } from '../../lib/errors.js';
import { lockSpaceCatalog } from '../monitoring-spaces/store.js';
import { contactView, prioritizeContacts, scopeIds, validateScope } from './contacts.js';

async function requireContact(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.supportContact.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy liên hệ.');
  return row;
}

export function registerIncidentSupport(router: Router, { db, reply, admin }: FeatureContext) {
  router.get('/support/contacts', admin, async (_req, res) => {
    const rows = await db.supportContact.findMany({
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { priority: 'asc' }, { name: 'asc' }],
    });
    reply(res, rows.map(contactView));
  });

  router.post('/support/contacts', admin, async (req, res) => {
    const { scope, ...input } = contactInput.parse(req.body);
    const row = await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      await validateScope(tx, scope, true);
      return tx.supportContact.create({ data: { ...input, ...scopeIds(scope) } });
    });
    reply(res.status(201), contactView(row));
  });

  router.put('/support/contacts/:id', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { scope, ...input } = contactInput.parse(req.body);
    const row = await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      const current = await requireContact(tx, id);
      const ids = scopeIds(scope);
      const changedScope = current.roomId !== ids.roomId || current.areaId !== ids.areaId;
      await validateScope(tx, scope, changedScope);
      return tx.supportContact.update({ where: { id }, data: { ...input, ...ids } });
    });
    reply(res, contactView(row));
  });

  router.patch('/support/contacts/:id/archive', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { archived } = archiveInput.parse(req.body);
    const row = await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      const current = await requireContact(tx, id);
      if (!!current.archivedAt === archived) return current;
      if (!archived) await validateScope(tx, contactView(current).scope, true);
      return tx.supportContact.update({
        where: { id }, data: { archivedAt: archived ? new Date() : null },
      });
    });
    reply(res, contactView(row));
  });

  router.get('/alerts/incidents/:id/support', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    // Match existing incident visibility: all authenticated roles can read incidents.
    const data = await db.$transaction(async (tx): Promise<IncidentSupportView> => {
      const incident = await tx.alertIncident.findUnique({
        where: { id },
        select: {
          device: {
            select: {
              location: true,
              roomAssignment: { include: { room: { include: { area: true } } } },
            },
          },
        },
      });
      if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sự cố.');
      const room = incident.device.roomAssignment?.room;
      const area = room?.area;
      const location = incident.device.location.trim();
      const scopes: Prisma.SupportContactWhereInput[] = [{ areaId: null, roomId: null }];
      if (area && !area.archivedAt) scopes.push({ areaId: area.id });
      if (room && !room.archivedAt && !area?.archivedAt) scopes.push({ roomId: room.id });
      const contacts = await tx.supportContact.findMany({ where: { archivedAt: null, OR: scopes } });
      return {
        location: {
          source: room ? 'assignment' : location ? 'device_location' : 'none',
          area_name: area?.name ?? null,
          room_name: room?.name ?? null,
          description: room?.description || area?.description || (!room ? location : null) || null,
          archived: Boolean(room?.archivedAt || area?.archivedAt),
        },
        contacts: prioritizeContacts(contacts.map(contactView)),
      };
    }, { isolationLevel: 'RepeatableRead' });
    reply(res, data);
  });
}
