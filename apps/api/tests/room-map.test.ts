import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { RoomMapView } from '@iot/contracts';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'room map with PostgreSQL',
  () => {
    const db = createDatabase(
      process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/airguard_test',
    );
    const app = createApp({ db, origin: 'http://localhost:5173' });
    const spaces = '/api/v1/spaces';
    const prefix = `room-map-${randomUUID()}`;
    let fixture: Awaited<ReturnType<typeof featureFixture>>;
    beforeAll(async () => {
      fixture = await featureFixture(db, app, prefix);
    });
    afterAll(() => db.$disconnect());

    it('isolates positions by room, retains archived assignments and reports active incidents per device', async () => {
      const { admin, operator, viewer } = fixture.headers;
      const addDevice = async (name: string) => {
        const result = await request(app)
          .post('/api/v1/devices')
          .set(admin!)
          .send({ name: `${prefix} ${name}`, source_kind: 'simulator' });
        expect(result.status).toBe(201);
        return result.body.data.id as string;
      };
      const second = await addDevice('Second');
      const unassigned = await addDevice('Unassigned');
      const area = await request(app)
        .post(`${spaces}/areas`)
        .set(admin!)
        .send({ name: prefix });
      expect(area.status).toBe(201);
      const areaId = area.body.data.id as string;
      const addRoom = async (name: string) => {
        const room = await request(app)
          .post(`${spaces}/rooms`)
          .set(admin!)
          .send({ name, area_id: areaId });
        expect(room.status).toBe(201);
        return room.body.data.id as string;
      };
      const roomA = await addRoom('A');
      const roomB = await addRoom('B');
      const map = async () => {
        const res = await request(app)
          .get(`${spaces}/areas/${areaId}/map`)
          .set(viewer!);
        expect(res.status).toBe(200);
        return res.body.data as RoomMapView;
      };
      const assign = (id: string, room_id: string | null) =>
        request(app)
          .put(`${spaces}/devices/${id}/room`)
          .set(admin!)
          .send({ room_id });
      const place = (
        id: string,
        room_id: string,
        headers = admin!,
        x = 0.24,
        y = 0.8,
      ) =>
        request(app)
          .put(`${spaces}/devices/${id}/position`)
          .set(headers)
          .send({ room_id, x, y });
      const device = fixture.deviceId;
      expect(
        (await request(app).get(spaces).set(viewer!)).body.data.devices,
      ).toContainEqual(
        expect.objectContaining({ id: unassigned, room_id: null }),
      );
      expect((await place(device, roomA)).status).toBe(409);
      expect((await assign(device, roomA)).status).toBe(200);
      expect((await assign(second, roomA)).status).toBe(200);
      expect(
        (await map()).rooms[0]?.devices.every((row) => row.position === null),
      ).toBe(true);
      for (const role of [operator!, viewer!])
        expect((await place(device, roomA, role)).status).toBe(403);
      expect((await place(device, roomA, admin!, 1.01)).status).toBe(422);
      expect((await place(device, roomA)).status).toBe(200);
      expect((await assign(device, roomA)).status).toBe(200);
      expect(
        (await map()).rooms[0]?.devices.find((row) => row.id === device)
          ?.position,
      ).toEqual({ x: 0.24, y: 0.8 });
      expect(
        (await map()).rooms
          .flatMap((room) => room.devices)
          .map((row) => row.id),
      ).not.toContain(unassigned);

      const version = (await map()).rooms.find(r => r.id === roomA)!.layout_version;
      const writes = await Promise.all([device,second].map(id => request(app)
        .put(`${spaces}/devices/${id}/position`).set(admin!).send({room_id:roomA,x:0.4,y:0.5,layout_version:version})));
      expect(writes.map(w => w.status).sort()).toEqual([200,409]);
      expect(writes.find(w => w.status === 409)?.body.error.code).toBe('LAYOUT_CHANGED');
      const thresholdUrl = `${spaces}/areas/${areaId}/map-thresholds`;
      expect((await map()).thresholds).toEqual({
        temperature_c: 30,
        humidity_pct: 75,
      });
      const thresholds = { temperature_c: 32, humidity_pct: 83 };
      expect(
        (await request(app).put(thresholdUrl).set(viewer!).send(thresholds))
          .status,
      ).toBe(403);
      expect(
        (await request(app).put(thresholdUrl).set(admin!).send(thresholds))
          .status,
      ).toBe(200);
      expect((await map()).thresholds).toEqual(thresholds);

      const payload = fixture.payload(1, Date.now());
      payload.readings[0]!.alert_snapshot.gas = 'active';
      expect(
        (
          await request(app)
            .post('/api/v1/device/telemetry')
            .set(fixture.deviceHeaders)
            .send(payload)
        ).status,
      ).toBe(200);
      await db.device.update({
        where: { id: device },
        data: { lastSeenAt: new Date(Date.now() - 60_000) },
      });
      const areas = (await request(app).get(`${spaces}/areas`).set(viewer!)).body.data;
      expect(areas.find((a:{id:string}) => a.id === areaId)).toMatchObject({rooms:2,devices:2,incidents:1});
      const sameRoom = (await map()).rooms[0]!.devices;
      expect(sameRoom.find((row) => row.id === device)).toMatchObject({
        status: 'offline',
        open_incidents: [{ condition: 'gas' }],
        latest: { payload: { seq: '1' } },
      });
      expect(sameRoom.find((row) => row.id === second)).toMatchObject({
        status: 'never_seen',
        open_incidents: [],
      });

      expect((await assign(device, roomB)).status).toBe(200);
      expect((await place(device, roomA)).status).toBe(409);
      expect(
        (await map()).rooms.find((room) => room.id === roomB)?.devices[0]
          ?.position,
      ).toBeNull();
      expect((await place(device, roomB, admin!, 0, 1)).status).toBe(200);
      expect(
        (
          await request(app)
            .patch(`${spaces}/rooms/${roomB}/archive`)
            .set(admin!)
            .send({ archived: true })
        ).status,
      ).toBe(200);
      expect((await assign(second, roomB)).status).toBe(409);
      expect((await place(device, roomB)).status).toBe(409);
      expect(
        (await map()).rooms.find((room) => room.id === roomB),
      ).toMatchObject({
        archived_at: expect.any(String),
        devices: [{ id: device, position: { x: 0, y: 1 } }],
      });
      expect((await assign(device, null)).status).toBe(200);
      expect(
        await db.deviceRoomAssignment.findUnique({
          where: { deviceId: device },
        }),
      ).toBeNull();
      expect((await assign(device, roomA)).status).toBe(200);
      expect(
        (await map()).rooms[0]?.devices.find((row) => row.id === device)
          ?.position,
      ).toBeNull();
    });
  },
);
