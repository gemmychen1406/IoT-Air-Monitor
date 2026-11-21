import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('monitoring spaces and incident support', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
  const app = createApp({ db, origin: 'http://localhost:5173' });
  const prefix = `mvp-${randomUUID()}`;
  let fixture: Awaited<ReturnType<typeof featureFixture>>;
  let incidentId: string;
  const spaces = '/api/v1/spaces';
  const contacts = '/api/v1/support/contacts';

  beforeAll(async () => {
    fixture = await featureFixture(db, app, prefix);
    await db.device.update({ where: { id: fixture.deviceId }, data: { location: 'Vị trí cũ' } });
    const incident = await db.alertIncident.create({
      data: { deviceId: fixture.deviceId, condition: 'gas', severity: 'warning', origin: 'snapshot' },
    });
    incidentId = incident.id;
  });
  afterAll(() => db.$disconnect());

  it('enforces permissions, prevents duplicate names and preserves archived assignments', async () => {
    const admin = fixture.headers.admin!;
    const viewer = fixture.headers.viewer!;
    const operator = fixture.headers.operator!;
    const support = `/api/v1/alerts/incidents/${incidentId}/support`;
    expect((await request(app).get(support)).status).toBe(401);
    expect((await request(app).get(spaces).set(viewer)).status).toBe(200);
    expect((await request(app).post(`${spaces}/areas`).set(operator).send({ name: prefix })).status).toBe(403);
    expect((await request(app).post(`${spaces}/areas`).set(admin).send({ name: '  ' })).status).toBe(422);

    const concurrent = await Promise.all([
      request(app).post(`${spaces}/areas`).set(admin).send({ name: ` ${prefix} Khu A ` }),
      request(app).post(`${spaces}/areas`).set(admin).send({ name: `${prefix} KHU A` }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
    const area = concurrent.find((response) => response.status === 201)!.body.data;
    const addedRoom = await request(app).post(`${spaces}/rooms`).set(admin)
      .send({ area_id: area.id, name: 'Phòng A', description: 'Tầng demo' });
    expect(addedRoom.status).toBe(201);
    const room = addedRoom.body.data;
    expect((await request(app).post(`${spaces}/rooms`).set(admin)
      .send({ area_id: area.id, name: ' PHO\u0300NG A ' })).status).toBe(409);

    const assignment = `${spaces}/devices/${fixture.deviceId}/room`;
    const areaArchive = `${spaces}/areas/${area.id}/archive`;
    const roomArchive = `${spaces}/rooms/${room.id}/archive`;
    expect((await request(app).put(assignment).set(viewer).send({ room_id: room.id })).status).toBe(403);
    expect((await request(app).put(assignment).set(admin).send({ room_id: room.id })).status).toBe(200);
    expect((await request(app).patch(areaArchive).set(admin).send({ archived: true })).status).toBe(409);
    expect((await request(app).patch(roomArchive).set(admin).send({ archived: true })).status).toBe(200);
    expect((await request(app).patch(areaArchive).set(admin).send({ archived: true })).status).toBe(200);
    expect((await request(app).patch(roomArchive).set(admin).send({ archived: false })).status).toBe(409);
    expect((await request(app).put(assignment).set(admin).send({ room_id: room.id })).status).toBe(409);

    const catalog = await request(app).get(spaces).set(viewer);
    expect(catalog.body.data.devices).toContainEqual(expect.objectContaining({
      id: fixture.deviceId, room_id: room.id, location: 'Vị trí cũ',
    }));
    expect((await request(app).get(support).set(viewer)).body.data.location).toMatchObject({
      source: 'assignment', room_name: 'Phòng A', description: 'Tầng demo', archived: true,
    });
    expect((await request(app).put(assignment).set(admin).send({ room_id: null })).status).toBe(200);
    expect((await request(app).get(support).set(viewer)).body.data.location).toMatchObject({
      source: 'device_location', description: 'Vị trí cũ',
    });
  });

  it('shows only matching active contacts, preferring room over area and global for duplicate numbers', async () => {
    const admin = fixture.headers.admin!;
    const viewer = fixture.headers.viewer!;
    const createArea = await request(app).post(`${spaces}/areas`).set(admin).send({ name: `${prefix} Khu B` });
    expect(createArea.status).toBe(201);
    const areaId = createArea.body.data.id;
    const createRoom = await request(app).post(`${spaces}/rooms`).set(admin)
      .send({ area_id: areaId, name: 'Phòng B' });
    expect(createRoom.status).toBe(201);
    const roomId = createRoom.body.data.id;
    const assignment = `${spaces}/devices/${fixture.deviceId}/room`;
    expect((await request(app).put(assignment).set(admin).send({ room_id: roomId })).status).toBe(200);

    const fakeDigits = BigInt(`0x${randomUUID().slice(0, 8)}`).toString().padStart(10, '0');
    const fakePhone = `+999${fakeDigits}1`;
    const common = {
      name: `${prefix} Chung`, role: 'Demo', phone: `+999 (${fakeDigits}) 1`,
      priority: 1, scope: { kind: 'global' },
    };
    expect((await request(app).get(contacts).set(viewer)).status).toBe(403);
    expect((await request(app).post(contacts).set(viewer).send(common)).status).toBe(403);
    expect((await request(app).post(contacts).set(admin).send({ ...common, phone: 'tel:+12025550101' })).status).toBe(422);
    const global = await request(app).post(contacts).set(admin).send(common);
    const area = await request(app).post(contacts).set(admin).send({
      ...common, name: `${prefix} Khu vực`, phone: `+999${fakeDigits}2`, scope: { kind: 'area', id: areaId },
    });
    const room = await request(app).post(contacts).set(admin).send({
      ...common, name: `${prefix} Phòng`, phone: fakePhone, priority: 100, scope: { kind: 'room', id: roomId },
    });
    expect([global.status, area.status, room.status]).toEqual([201, 201, 201]);
    expect(global.body.data.phone).toBe(fakePhone);

    const support = () => request(app).get(`/api/v1/alerts/incidents/${incidentId}/support`).set(viewer);
    const demoContacts = (rows: { name: string; id: string }[]) =>
      rows.filter((row) => row.name.startsWith(prefix)).map((row) => row.id);
    expect(demoContacts((await support()).body.data.contacts)).toEqual([room.body.data.id, area.body.data.id]);
    const archive = `${contacts}/${room.body.data.id}/archive`;
    expect((await request(app).patch(archive).set(admin).send({ archived: true })).status).toBe(200);
    expect(demoContacts((await support()).body.data.contacts)).toEqual([area.body.data.id, global.body.data.id]);
    expect((await request(app).put(assignment).set(admin).send({ room_id: null })).status).toBe(200);
    expect(demoContacts((await support()).body.data.contacts)).toEqual([global.body.data.id]);
  });
});
