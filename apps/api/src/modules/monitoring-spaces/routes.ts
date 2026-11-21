import type { Router } from 'express';
import type { MonitoringArea, MonitoringRoom } from '@prisma/client';
import { z } from 'zod';
import {
  areaInput, roomInput, archiveInput, assignmentInput,
  type AreaView, type RoomView, type SpacesView,
} from '@iot/contracts';
import { lockDevice, type FeatureContext } from '../../lib/context.js';
import { ApiError } from '../../lib/errors.js';
import { registerRoomMap } from './room-map.js';
import {
  assertActiveSpace, assertUniqueName, lockSpaceCatalog, nameKey, requireArea, requireRoom,
} from './store.js';

function areaView(row: MonitoringArea | MonitoringRoom): AreaView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    archived_at: row.archivedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

const roomView = (row: MonitoringRoom): RoomView => ({ ...areaView(row), area_id: row.areaId });
const uuid = z.uuid();

export function registerMonitoringSpaces(router: Router, { db, reply, admin }: FeatureContext) {
  registerRoomMap(router, { db, reply, admin });
  router.get('/spaces/areas', async (_req, res) => {
    const rows = await db.$queryRaw`SELECT a.id, a.name, a.description, a.archived_at, a.created_at, a.updated_at,
      count(DISTINCT r.id)::int AS rooms, count(DISTINCT d.device_id)::int AS devices,
      count(i.id)::int AS incidents FROM monitoring_areas a
      LEFT JOIN monitoring_rooms r ON r.area_id = a.id
      LEFT JOIN device_room_assignments d ON d.room_id = r.id
      LEFT JOIN alert_incidents i ON i.device_id = d.device_id AND i.status = 'active'
      GROUP BY a.id ORDER BY a.name_key`;
    reply(res, rows);
  });
  router.get('/spaces', async (_req, res) => {
    const [areas, rooms, devices] = await db.$transaction([
      db.monitoringArea.findMany({ orderBy: { nameKey: 'asc' } }),
      db.monitoringRoom.findMany({ orderBy: { nameKey: 'asc' } }),
      db.device.findMany({
        where: { OR: [{ archivedAt: null }, { roomAssignment: { isNot: null } }] },
        select: { id: true, name: true, location: true, archivedAt: true, roomAssignment: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ], { isolationLevel: 'RepeatableRead' });
    const data: SpacesView = {
      areas: areas.map(areaView),
      rooms: rooms.map(roomView),
      devices: devices.map((row) => ({
        id: row.id,
        name: row.name,
        location: row.location,
        archived_at: row.archivedAt?.toISOString() ?? null,
        room_id: row.roomAssignment?.roomId ?? null,
      })),
    };
    reply(res, data);
  });

  router.post('/spaces/areas', admin, async (req, res) => {
    const input = areaInput.parse(req.body);
    const key = nameKey(input.name);
    const row = await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      assertUniqueName(await tx.monitoringArea.findUnique({ where: { nameKey: key } }));
      return tx.monitoringArea.create({ data: { ...input, nameKey: key } });
    });
    reply(res.status(201), areaView(row));
  });

  router.put('/spaces/areas/:id', admin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = areaInput.parse(req.body);
    const key = nameKey(input.name);
    const row = await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      await requireArea(tx, id);
      assertUniqueName(await tx.monitoringArea.findUnique({ where: { nameKey: key } }), id);
      return tx.monitoringArea.update({ where: { id }, data: { ...input, nameKey: key } });
    });
    reply(res, areaView(row));
  });

  router.patch('/spaces/areas/:id/archive', admin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { archived } = archiveInput.parse(req.body);
    const row = await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      const area = await requireArea(tx, id);
      if (!!area.archivedAt === archived) return area;
      if (archived && await tx.monitoringRoom.count({ where: { areaId: id, archivedAt: null } }))
        throw new ApiError(409, 'AREA_HAS_ACTIVE_ROOMS', 'Hãy lưu trữ các phòng còn hoạt động trước.');
      return tx.monitoringArea.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    });
    reply(res, areaView(row));
  });

  router.post('/spaces/rooms', admin, async (req, res) => {
    const { area_id: areaId, ...input } = roomInput.parse(req.body);
    const key = nameKey(input.name);
    const row = await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      assertActiveSpace((await requireArea(tx, areaId)).archivedAt);
      assertUniqueName(await tx.monitoringRoom.findUnique({
        where: { areaId_nameKey: { areaId, nameKey: key } },
      }));
      return tx.monitoringRoom.create({ data: { ...input, areaId, nameKey: key } });
    });
    reply(res.status(201), roomView(row));
  });

  router.put('/spaces/rooms/:id', admin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { area_id: areaId, ...input } = roomInput.parse(req.body);
    const key = nameKey(input.name);
    const row = await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      const room = await requireRoom(tx, id);
      if (room.areaId !== areaId) assertActiveSpace((await requireArea(tx, areaId)).archivedAt);
      assertUniqueName(await tx.monitoringRoom.findUnique({
        where: { areaId_nameKey: { areaId, nameKey: key } },
      }), id);
      return tx.monitoringRoom.update({ where: { id }, data: { ...input, areaId, nameKey: key } });
    });
    reply(res, roomView(row));
  });

  router.patch('/spaces/rooms/:id/archive', admin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { archived } = archiveInput.parse(req.body);
    const row = await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      const room = await requireRoom(tx, id);
      if (!!room.archivedAt === archived) return room;
      if (!archived) assertActiveSpace(room.area.archivedAt);
      return tx.monitoringRoom.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    });
    reply(res, roomView(row));
  });

  router.put('/spaces/devices/:id/room', admin, async (req, res) => {
    const deviceId = uuid.parse(req.params.id);
    const { room_id: roomId, only_unassigned, expected_room_id } = assignmentInput.parse(req.body);
    await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      const device = await lockDevice(tx, deviceId);
      if (!roomId) {
        const removed = await tx.deviceRoomAssignment.deleteMany({where:{deviceId, roomId:expected_room_id}});
        if (expected_room_id && !removed.count) throw new ApiError(409,'ROOM_ASSIGNMENT_CHANGED','Thiết bị đã đổi phòng. Hãy tải lại sơ đồ.');
        return;
      }
      if (device.archivedAt) throw new ApiError(409, 'DEVICE_ARCHIVED', 'Thiết bị đã lưu trữ.');
      const room = await requireRoom(tx, roomId);
      assertActiveSpace(room.archivedAt ?? room.area.archivedAt);
      const current = await tx.deviceRoomAssignment.findUnique({ where: { deviceId } });
      if (only_unassigned && current) throw new ApiError(409, 'ALREADY_ASSIGNED', 'Thiết bị vừa được gán phòng. Hãy tải lại.');
      if (!current) await tx.deviceRoomAssignment.create({ data: { deviceId, roomId } });
      else if (current.roomId !== roomId) await tx.deviceRoomAssignment.update({
        where: { deviceId }, data: { roomId, x: null, y: null },
      });
    });
    reply(res, { device_id: deviceId, room_id: roomId });
  });
}
