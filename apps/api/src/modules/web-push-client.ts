import webpush from 'web-push';
import { createHash } from 'node:crypto';
import { pushSubscriptionSchema } from '@iot/contracts';
import type { WebPushConfig, PushPayload, PushTarget, PushResult } from './web-push.js';
export async function sendWebPush(
  config: WebPushConfig,
  target: PushTarget,
  payload: PushPayload,
  request: typeof webpush.sendNotification = webpush.sendNotification,
): Promise<PushResult> {
  const parsed = pushSubscriptionSchema.safeParse(target);
  if (!parsed.success)
    return { ok: false, retryable: false, gone: true, code: 'WEB_PUSH_INVALID_SUBSCRIPTION' };
  try {
    const result = await request(parsed.data, JSON.stringify(payload), {
      vapidDetails: {
        subject: config.subject,
        publicKey: config.publicKey,
        privateKey: config.privateKey,
      },
      TTL: 60,
      urgency: 'high',
      timeout: 10000,
      topic: createHash('sha256')
        .update(`${payload.incident_id}:${payload.severity}`)
        .digest('base64url')
        .slice(0, 32),
    });
    if (result.statusCode >= 200 && result.statusCode < 300) return { ok: true };
    return { ok: false, retryable: true, code: 'WEB_PUSH_RESPONSE_INVALID' };
  } catch (error) {
    const value =
      typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
    const status = Number(value.statusCode);
    if (status === 404 || status === 410)
      return { ok: false, retryable: false, gone: true, code: 'WEB_PUSH_GONE' };
    if (status === 429) {
      const headers =
        typeof value.headers === 'object' && value.headers !== null
          ? (value.headers as Record<string, unknown>)
          : {};
      const raw = headers['retry-after'];
      const retry =
        typeof raw === 'string' && /^\d+$/.test(raw) ? Math.min(Number(raw), 86400) : 30;
      return {
        ok: false,
        retryable: true,
        code: 'WEB_PUSH_RATE_LIMITED',
        retryAfterSeconds: Math.max(1, retry),
      };
    }
    if (Number.isInteger(status) && status >= 400 && status < 500)
      return { ok: false, retryable: status === 408, code: `WEB_PUSH_HTTP_${status}` };
    // The original Error includes a capability endpoint, encrypted body or VAPID
    // material. Never return/log it or a push service's response body.
    return { ok: false, retryable: true, code: 'WEB_PUSH_NETWORK_ERROR' };
  }
}
