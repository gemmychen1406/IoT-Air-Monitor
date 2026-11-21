import type { Router } from 'express';
import { z } from 'zod';
import {
  mapThresholdInput,
  roomPositionInput,
  type RoomMapDevice,
  type RoomMapView,
} from '@iot/contracts';
import { lockDevice, type FeatureContext } from '../../lib/context.js';
import { ApiError } from '../../lib/errors.js';
import { listDevices } from '../telemetry.js';
import {
  assertActiveSpace,
  lockSpaceCatalog,
  requireArea,
  requireRoom,
} from './store.js';

export function registerRoomMap(
  router: Router,
  { db, reply, admin }: Pick<FeatureContext, 'db' | 'reply' | 'admin'>,
) {
  router.get('/spaces/areas/:id/map', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const data = await db.$transaction(
      async (tx): Promise<RoomMapView> => {
        const area = await requireArea(tx, id);
        const rooms = await tx.monitoringRoom.findMany({
          where: { areaId: id },
          orderBy: [
            { archivedAt: { sort: 'asc', nulls: 'first' } },
            { nameKey: 'asc' },
          ],
        });
        const devices = new Map(
          (await listDevices(tx, 'all', undefined, id)).map((device) => [
            device.id,
            device,
          ]),
        );
        const assignments = await tx.deviceRoomAssignment.findMany({
          where: { room: { areaId: id } },
        });
        const incidents = await tx.alertIncident.findMany({
          where: { deviceId: { in: [...devices.keys()] }, status: 'active' },
          orderBy: { ordinal: 'desc' },
          select: { id: true, deviceId: true, condition: true, severity: true },
        });
        const byDevice = new Map<string, RoomMapDevice['open_incidents']>();
        for (const { deviceId, ...incident } of incidents) {
          const list = byDevice.get(deviceId) ?? [];
          list.push(incident);
          byDevice.set(deviceId, list);
        }
        const byRoom = new Map<string, RoomMapDevice[]>();
        for (const row of assignments) {
          const device = devices.get(row.deviceId);
          if (!device) continue;
          const list = byRoom.get(row.roomId) ?? [];
          list.push({
            ...device,
            position:
              row.x !== null && row.y !== null ? { x: row.x, y: row.y } : null,
            open_incidents: byDevice.get(device.id) ?? [],
          });
          byRoom.set(row.roomId, list);
        }
        return {
          thresholds: {
            temperature_c: area.mapTemperatureC,
            humidity_pct: area.mapHumidityPct,
          },
          rooms: rooms.map((room) => ({
            id: room.id,
            layout_version: room.layoutVersion,
            name: room.name,
            archived_at: room.archivedAt?.toISOString() ?? null,
            devices: (byRoom.get(room.id) ?? []).sort((a, b) =>
              a.name.localeCompare(b.name, 'vi'),
            ),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    reply(res, data);
  });

  router.put('/spaces/areas/:id/map-thresholds', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { temperature_c, humidity_pct } = mapThresholdInput.parse(req.body);
    await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      assertActiveSpace((await requireArea(tx, id)).archivedAt);
      await tx.monitoringArea.update({
        where: { id },
        data: { mapTemperatureC: temperature_c, mapHumidityPct: humidity_pct },
      });
    });
    reply(res, { temperature_c, humidity_pct });
  });

  router.put('/spaces/devices/:id/position', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { room_id, x, y, layout_version } = roomPositionInput.parse(req.body);
    await db.$transaction(async (tx) => {
      await lockSpaceCatalog(tx);
      if ((await lockDevice(tx, id)).archivedAt)
        throw new ApiError(409, 'DEVICE_ARCHIVED', 'Thiết bị đã lưu trữ.');
      const assignment = await tx.deviceRoomAssignment.findUnique({
        where: { deviceId: id },
      });
      if (assignment?.roomId !== room_id)
        throw new ApiError(
          409,
          'ROOM_ASSIGNMENT_CHANGED',
          'Thiết bị không còn ở phòng này. Vui lòng tải lại sơ đồ.',
        );
      const room = await requireRoom(tx, room_id);
      const movingExistingPoint = assignment.x !== null && (assignment.x !== x || assignment.y !== y);
      if ((layout_version === undefined && movingExistingPoint) ||
          (layout_version !== undefined && room.layoutVersion !== layout_version))
        throw new ApiError(409, 'LAYOUT_CHANGED', 'Bố trí phòng đã thay đổi. Hãy tải bố trí mới rồi chọn lại vị trí.');
      assertActiveSpace(room.archivedAt ?? room.area.archivedAt);
      await tx.deviceRoomAssignment.update({
        where: { deviceId: id },
        data: { x, y },
      });
    });
    reply(res, { device_id: id, room_id, x, y });
  });
}
