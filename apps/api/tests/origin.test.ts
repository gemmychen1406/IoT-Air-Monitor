import { afterAll, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';

const db = createDatabase('postgresql://localhost/not_used');
const app = createApp({ db, origin: 'http://localhost:5173' });
afterAll(() => db.$disconnect());

it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
  'accepts the configured local web origin alias %s with credentials',
  async (origin) => {
    const res = await request(app).get('/health/live').set('Origin', origin);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  },
);
it.each([
  'http://localhost:5174',
  'https://localhost:5173',
  'http://evil.localhost:5173',
  'https://untrusted.example',
  'null',
])('does not widen the allowlist to %s', async (origin) => {
  expect((await request(app).get('/health/live').set('Origin', origin)).status).toBe(403);
});
