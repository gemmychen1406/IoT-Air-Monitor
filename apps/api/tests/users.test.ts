import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'account administration and password security',
  () => {
    const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
    const revoked: string[] = [];
    const app = createApp({
      db,
      origin: 'http://localhost:5173',
      onLogout: (id) => revoked.push(id),
    });
    let f: Awaited<ReturnType<typeof featureFixture>>;
    let targetId: string;
    let targetHeaders: Record<string, string>;
    const password = randomUUID();
    const nextPassword = randomUUID();
    beforeAll(async () => {
      f = await featureFixture(db, app, 'users');
    });
    afterAll(() => db.$disconnect());
    it('allows only admin to create and paginate users, never exposing a password hash', async () => {
      expect((await request(app).get('/api/v1/users').set(f.headers.viewer!)).status).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/v1/users')
            .set(f.headers.operator!)
            .send({ email: 'denied@test.local', password, role: 'admin' })
        ).status,
      ).toBe(403);
      const created = await request(app)
        .post('/api/v1/users')
        .set(f.headers.admin!)
        .send({ email: 'New-User@Test.Local', password, role: 'operator' });
      expect(created.status).toBe(201);
      targetId = created.body.data.id;
      expect(created.body.data).toMatchObject({
        email: 'new-user@test.local',
        role: 'operator',
        active: true,
      });
      expect(JSON.stringify(created.body)).not.toContain('password');
      expect(
        (
          await request(app)
            .post('/api/v1/users')
            .set(f.headers.admin!)
            .send({ email: 'NEW-USER@test.local', password, role: 'viewer' })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(app)
            .post('/api/v1/users')
            .set(f.headers.admin!)
            .send({ email: 'weak@test.local', password: '123', role: 'viewer' })
        ).status,
      ).toBe(422);
      const page = await request(app).get('/api/v1/users?limit=1').set(f.headers.admin!);
      const next = await request(app)
        .get(`/api/v1/users?limit=1&cursor=${page.body.meta.next_cursor}`)
        .set(f.headers.admin!);
      expect(next.body.data).toHaveLength(1);
      expect(next.body.data[0].id).not.toBe(page.body.data[0].id);
      const login = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'AirGuard')
        .send({ email: 'new-user@test.local', password });
      targetHeaders = {
        Cookie: login.headers['set-cookie']![0]!.split(';')[0]!,
        'X-Requested-With': 'AirGuard',
      };
    });
    it('requires current password and revokes every session after changing password', async () => {
      const url = '/api/v1/users/me/password';
      expect(
        (
          await request(app)
            .put(url)
            .set(targetHeaders)
            .send({ current_password: 'wrong', new_password: nextPassword })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .put(url)
            .set(targetHeaders)
            .send({ current_password: password, new_password: nextPassword })
        ).status,
      ).toBe(204);
      expect((await request(app).get('/api/v1/auth/session').set(targetHeaders)).status).toBe(401);
      expect(await db.session.count({ where: { userId: targetId } })).toBe(0);
      expect(revoked.length).toBeGreaterThan(0);
      expect(
        (
          await request(app)
            .post('/api/v1/auth/login')
            .set('X-Requested-With', 'AirGuard')
            .send({ email: 'new-user@test.local', password })
        ).status,
      ).toBe(401);
    });
    it('updates email only with reauthentication and does not allow self privilege escalation', async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'AirGuard')
        .send({ email: 'new-user@test.local', password: nextPassword });
      targetHeaders = {
        Cookie: login.headers['set-cookie']![0]!.split(';')[0]!,
        'X-Requested-With': 'AirGuard',
      };
      expect(
        (
          await request(app)
            .patch('/api/v1/users/me')
            .set(targetHeaders)
            .send({ email: 'renamed@test.local', current_password: 'wrong' })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch('/api/v1/users/me')
            .set(targetHeaders)
            .send({ role: 'admin', current_password: nextPassword })
        ).status,
      ).toBe(422);
      expect(
        (
          await request(app)
            .patch('/api/v1/users/me')
            .set(targetHeaders)
            .send({ email: 'renamed@test.local', current_password: nextPassword })
        ).status,
      ).toBe(200);
      expect((await request(app).get('/api/v1/auth/session').set(targetHeaders)).status).toBe(401);
    });
    it('revokes sessions after admin role/reset/lock changes and prevents self lockout', async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'AirGuard')
        .send({ email: 'renamed@test.local', password: nextPassword });
      const cookie = login.headers['set-cookie']![0]!.split(';')[0]!;
      expect(
        (
          await request(app)
            .patch(`/api/v1/users/${targetId}`)
            .set(f.headers.admin!)
            .send({ role: 'viewer' })
        ).status,
      ).toBe(200);
      expect((await request(app).get('/api/v1/auth/session').set('Cookie', cookie)).status).toBe(
        401,
      );
      expect(
        (
          await request(app)
            .patch(`/api/v1/users/${targetId}`)
            .set(f.headers.admin!)
            .send({ active: false })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .post('/api/v1/auth/login')
            .set('X-Requested-With', 'AirGuard')
            .send({ email: 'renamed@test.local', password: nextPassword })
        ).status,
      ).toBe(401);
      const me = await request(app).get('/api/v1/users/me').set(f.headers.admin!);
      expect(
        (
          await request(app)
            .patch(`/api/v1/users/${me.body.data.id}`)
            .set(f.headers.admin!)
            .send({ active: false })
        ).status,
      ).toBe(409);
      const audit = await request(app)
        .get(`/api/v1/audit-logs?resource_type=user&resource_id=${targetId}`)
        .set(f.headers.admin!);
      expect(audit.status).toBe(200);
      expect(audit.body.data.length).toBeGreaterThan(0);
      expect(JSON.stringify(audit.body)).not.toContain(nextPassword);
    });
  },
);
