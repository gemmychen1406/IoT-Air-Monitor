import { it, expect } from 'vitest';
import webpush from 'web-push';
import { createECDH, randomBytes } from 'node:crypto';
import { sendWebPush } from '../src/modules/web-push-client.js';

const config = { ...webpush.generateVAPIDKeys(), subject: 'mailto:admin@example.com' };
const curve = createECDH('prime256v1');
curve.generateKeys();
const target = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-fixture',
  keys: {
    p256dh: curve.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  },
};
const payload = {
  severity: 'warning',
  incident_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  simulator: true,
  ended: false,
  url: '/app/alerts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
it('passes encrypted Web Push transport a short TTL, bounded timeout and explicit VAPID credentials', async () => {
  let body = '';
  let ttl = 0;
  const result = await sendWebPush(config, target, payload, async (subscription, data, options) => {
    expect(subscription).toEqual(target);
    body = String(data);
    ttl = Number(options?.TTL);
    expect(options?.timeout).toBe(10000);
    expect(options?.urgency).toBe('high');
    expect(options?.vapidDetails).toEqual({
      subject: config.subject,
      publicKey: config.publicKey,
      privateKey: config.privateKey,
    });
    return { statusCode: 201, body: '', headers: {} };
  });
  expect(result).toEqual({ ok: true });
  expect(ttl).toBe(60);
  expect(JSON.parse(body)).toEqual(payload);
});
it('classifies 410 as gone and 429 with retry-after without exposing response body or endpoint', async () => {
  const gone = await sendWebPush(config, target, payload, async () => {
    throw Object.assign(new Error(target.endpoint), { statusCode: 410, body: target.keys.auth });
  });
  expect(gone).toMatchObject({ ok: false, retryable: false, gone: true });
  expect(JSON.stringify(gone)).not.toContain(target.endpoint);
  const limited = await sendWebPush(config, target, payload, async () => {
    throw Object.assign(new Error('rate'), { statusCode: 429, headers: { 'retry-after': '30' } });
  });
  expect(limited).toMatchObject({ ok: false, retryable: true, retryAfterSeconds: 30 });
});
it('rejects untrusted endpoints before invoking a network transport', async () => {
  let attempted = false;
  const result = await sendWebPush(
    config,
    { ...target, endpoint: 'https://127.0.0.1/private' },
    payload,
    async () => {
      attempted = true;
      return { statusCode: 201, body: '', headers: {} };
    },
  );
  expect(attempted).toBe(false);
  expect(result).toMatchObject({ ok: false, retryable: false });
});
