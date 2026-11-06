import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '@iot/database';

it('logs request metadata but never raw Authorization, query tokens or passwords', async () => {
  const entries: object[] = [];
  const db = createDatabase('postgresql://localhost/not_used');
  const app = createApp({
    db,
    origin: 'http://localhost:5173',
    onRequest: (entry) => entries.push(entry),
  });
  try {
    await request(app)
      .get('/health/live?token=private-query')
      .set('Authorization', 'Bearer private-secret');
    expect(entries).toEqual([{ request_id: expect.any(String), method: 'GET', status: 200 }]);
    expect(JSON.stringify(entries)).not.toContain('private-');
  } finally {
    await db.$disconnect();
  }
});

it('returns 503 and logs a sanitized failure when PostgreSQL cannot be reached', async () => {
  const failures: object[] = [];
  const db = createDatabase('postgresql://unused:private-database-secret@127.0.0.1:1/unreachable');
  const app = createApp({
    db,
    origin: 'http://localhost:5173',
    onFailure: (entry) => failures.push(entry),
  });
  try {
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(503);
    expect(failures).toEqual([{ request_id: expect.any(String), code: 'SERVICE_UNAVAILABLE' }]);
    expect(JSON.stringify({ response: response.body, failures })).not.toContain(
      'private-database-secret',
    );
  } finally {
    await db.$disconnect();
  }
});
