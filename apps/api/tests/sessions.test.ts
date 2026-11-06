import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('persistent HttpOnly sessions', () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
  const app = createApp({ db, origin: 'http://localhost:5173' });
  const password = randomUUID();
  const email = 'cookie@test.local';
  const webHeaders = { Origin: 'http://127.0.0.1:5173', 'X-Requested-With': 'AirGuard' };
  beforeAll(async () => {
    await db.user.create({
      data: { email, passwordHash: await argon2.hash(password), role: 'admin' },
    });
  });
  afterAll(() => db.$disconnect());
  async function login() {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(webHeaders)
      .send({ email, password });
    expect(res.status).toBe(200);
    return res;
  }

  it('sets a persistent host-only HttpOnly cookie without returning the token in JSON', async () => {
    const res = await login();
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('iot_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=28800');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(res.body.data.token).toBeUndefined();
    expect(res.body.data.user.email).toBe(email);
    const session = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', cookie.split(';')[0]!);
    expect(session.status).toBe(200);
    expect(session.body.data.user.email).toBe(email);
  });
  it('blocks cookie-authenticated mutations without the anti-CSRF header, including missing Origin', async () => {
    const res = await login();
    const cookie = res.headers['set-cookie']![0]!.split(';')[0]!;
    expect(
      (
        await request(app)
          .post('/api/v1/devices')
          .set('Cookie', cookie)
          .send({ name: 'CSRF', source_kind: 'simulator' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/devices')
          .set('Cookie', cookie)
          .set(webHeaders)
          .send({ name: 'Cookie device', source_kind: 'simulator' })
      ).status,
    ).toBe(201);
  });
  it('clears the browser cookie and invalidates the database session on logout', async () => {
    const res = await login();
    const cookie = res.headers['set-cookie']![0]!.split(';')[0]!;
    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set(webHeaders);
    expect(logout.status).toBe(204);
    expect(logout.headers['set-cookie']?.[0]).toContain('iot_session=;');
    expect((await request(app).get('/api/v1/auth/session').set('Cookie', cookie)).status).toBe(401);
  });
  it('refuses expired sessions even if a browser keeps sending its cookie', async () => {
    const res = await login();
    const cookie = res.headers['set-cookie']![0]!.split(';')[0]!;
    await db.session.updateMany({
      where: { user: { email } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await request(app).get('/api/v1/auth/session').set('Cookie', cookie)).status).toBe(401);
  });
  it('sets Secure on HTTPS sessions', async () => {
    const secureApp = createApp({ db, origin: 'https://app.example.com' });
    const res = await request(secureApp)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .set('X-Requested-With', 'AirGuard')
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toContain('Secure');
  });
});
