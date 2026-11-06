import type { Router } from 'express';
import { ECDH } from 'node:crypto';
import { registerPushSchema } from '@iot/contracts';
import type { FeatureContext } from '../lib/context.js';
import type { WebPushConfig } from './web-push.js';
import { hashSecret } from './auth.js';
import { ApiError } from '../lib/errors.js';

export function registerPushSubscriptions(
  router: Router,
  { db, reply }: FeatureContext,
  config?: WebPushConfig,
) {
  router.get('/push/config', (_req, res) =>
    reply(res, { enabled: !!config, public_key: config?.publicKey ?? null, session_bound: true }),
  );
  router.get('/push/subscription', async (_req, res) => {
    const row = await db.webPushSubscription.findUnique({
      where: { sessionId: res.locals.session.sessionId as string },
    });
    reply(
      res,
      row
        ? {
            id: row.id,
            endpoint_hash: row.endpointHash,
            include_simulators: row.includeSimulators,
            vapid_public_key: row.vapidPublicKey,
            expires_at: res.locals.session.expiresAt.toISOString(),
          }
        : null,
    );
  });
  router.post('/push/subscription', async (req, res) => {
    if (!config) throw new ApiError(409, 'WEB_PUSH_DISABLED', 'Backend chưa bật Web Push.');
    const input = registerPushSchema.parse(req.body);
    if (input.application_server_key !== config.publicKey)
      throw new ApiError(
        409,
        'VAPID_KEY_CHANGED',
        'Khóa Web Push đã thay đổi. Tải lại trang và đăng ký lại.',
      );
    try {
      ECDH.convertKey(Buffer.from(input.subscription.keys.p256dh, 'base64url'), 'prime256v1');
    } catch {
      throw new ApiError(422, 'INVALID_PUSH_KEY', 'Khóa mã hóa Web Push không hợp lệ.');
    }
    if (input.subscription.expirationTime && input.subscription.expirationTime <= Date.now())
      throw new ApiError(422, 'PUSH_EXPIRED', 'Đăng ký trình duyệt đã hết hạn.');
    const sessionId = res.locals.session.sessionId as string;
    const row = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(73144)`;
      await tx.$queryRaw`SELECT id FROM sessions WHERE id=${sessionId}::uuid FOR UPDATE`;
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (!session || session.expiresAt <= new Date() || !session.user.active)
        throw new ApiError(401, 'UNAUTHORIZED', 'Phiên đã hết hạn.');
      const endpointHash = hashSecret(input.subscription.endpoint);
      const previous = await tx.webPushSubscription.findUnique({
        where: { endpointHash },
        include: { session: { include: { user: true } } },
      });
      if (previous && previous.sessionId !== sessionId) {
        if (
          previous.session.userId !== session.userId &&
          previous.session.expiresAt > new Date() &&
          previous.session.user.active
        )
          throw new ApiError(
            409,
            'PUSH_ENDPOINT_OWNED',
            'Đăng ký này đang thuộc phiên khác. Tắt đăng ký cũ hoặc đăng ký lại trên trình duyệt.',
          );
        await tx.webPushSubscription.delete({ where: { id: previous.id } });
      }
      const existing = await tx.webPushSubscription.findUnique({ where: { sessionId } });
      if (
        !existing &&
        (await tx.webPushSubscription.count({ where: { session: { userId: session.userId } } })) >=
          20
      )
        throw new ApiError(
          409,
          'PUSH_LIMIT',
          'Tối đa 20 trình duyệt/phiên nhận push cho mỗi tài khoản.',
        );
      const data = {
        endpointHash,
        endpoint: input.subscription.endpoint,
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        vapidPublicKey: config.publicKey,
        includeSimulators: input.include_simulators,
      };
      return tx.webPushSubscription.upsert({
        where: { sessionId },
        create: { ...data, sessionId },
        update: data,
      });
    });
    reply(res, {
      id: row.id,
      endpoint_hash: row.endpointHash,
      include_simulators: row.includeSimulators,
      vapid_public_key: row.vapidPublicKey,
      expires_at: res.locals.session.expiresAt.toISOString(),
    });
  });
  router.delete('/push/subscription', async (_req, res) => {
    await db.webPushSubscription.deleteMany({
      where: { sessionId: res.locals.session.sessionId as string },
    });
    res.status(204).end();
  });
}
