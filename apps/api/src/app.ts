import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { Database } from '@iot/database';
import { loginSchema, telemetrySchema } from '@iot/contracts';
import { ApiError } from './lib/errors.js';
import {
  authenticateDevice,
  authenticateUser,
  hashSecret,
  newSecret,
  SESSION_COOKIE,
} from './modules/auth.js';
import { ingest } from './modules/telemetry.js';
import { openapi } from './openapi.js';
import { allowedWebOrigins } from './lib/origins.js';
import { registerDeviceTransport, registerDevices } from './modules/devices.js';
import { registerAlertTransport, registerAlerts } from './modules/alerts.js';
import { registerAnalytics } from './modules/analytics.js';
import { registerUsers } from './modules/users.js';
import type { AlertNotifier } from './modules/notifications.js';
import { registerPushSubscriptions } from './modules/push-subscriptions.js';
import type { WebPushConfig } from './modules/web-push.js';

export function createApp({
  db,
  origin,
  secureCookies = new URL(origin).protocol === 'https:',
  onTelemetry = () => {},
  onLogout = () => {},
  onRequest = () => {},
  onFailure = () => {},
  onEvent = () => {},
  notify,
  webPush,
}: {
  db: Database;
  origin: string;
  secureCookies?: boolean;
  onTelemetry?: (deviceId: string) => void;
  onLogout?: (sessionId: string) => void;
  onRequest?: (entry: { request_id: string; method: string; status: number }) => void;
  onFailure?: (entry: { request_id: string; code: string }) => void;
  onEvent?: (type: string, deviceId: string) => void;
  notify?: AlertNotifier;
  webPush?: WebPushConfig;
}) {
  const app = express();
  const origins = allowedWebOrigins(origin);
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secureCookies,
    path: '/',
  };
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () =>
      onRequest({
        request_id: res.locals.requestId as string,
        method: req.method,
        status: res.statusCode,
      }),
    );
    if (req.headers.origin && !origins.includes(req.headers.origin))
      return next(new ApiError(403, 'ORIGIN_DENIED', 'Origin không được phép.'));
    next();
  });
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: '64kb' }));
  const reply = (res: express.Response, data: unknown, extra = {}) =>
    res.json({
      data,
      meta: { request_id: res.locals.requestId, server_time: new Date().toISOString(), ...extra },
    });
  const limitMessage = (_req: express.Request, res: express.Response) =>
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' },
      meta: { request_id: res.locals.requestId },
    });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: limitMessage,
    }),
  );
  // A custom header cannot be sent by a cross-site HTML form. Cross-origin fetch
  // preflight is restricted by the exact Origin allowlist above, including login.
  app.use('/api/v1', (req, _res, next) => {
    const deviceRoute = req.path.startsWith('/device/');
    if (
      !deviceRoute &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !req.headers.authorization &&
      req.get('X-Requested-With') !== 'AirGuard'
    )
      return next(new ApiError(403, 'CSRF_REJECTED', 'Thiếu header xác minh yêu cầu ứng dụng.'));
    next();
  });
  app.post(
    '/api/v1/auth/login',
    rateLimit({ windowMs: 60000, limit: 10, handler: limitMessage }),
    async (req, res) => {
      const input = loginSchema.parse(req.body);
      const user = await db.user.findUnique({ where: { email: input.email } });
      if (!user?.active || !(await argon2.verify(user.passwordHash, input.password)))
        throw new ApiError(401, 'INVALID_LOGIN', 'Email hoặc mật khẩu không đúng.');
      const token = newSecret();
      const expiresAt = new Date(Date.now() + 8 * 3600000);
      const current = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
        const row = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        if (!row.active || row.passwordHash !== user.passwordHash || row.email !== user.email)
          throw new ApiError(
            401,
            'INVALID_LOGIN',
            'Thông tin đăng nhập đã thay đổi. Vui lòng thử lại.',
          );
        await tx.session.create({
          data: { userId: row.id, tokenHash: hashSecret(token), expiresAt },
        });
        return row;
      });
      res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: 8 * 3600000 });
      reply(res, {
        expires_at: expiresAt.toISOString(),
        user: { id: current.id, email: current.email, role: current.role },
      });
    },
  );
  app.get('/health/live', (_req, res) => reply(res, { status: 'ok' }));
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  app.get('/health/ready', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    reply(res, { status: 'ready' });
  });

  app.post('/api/v1/device/telemetry', async (req, res) => {
    const key = await authenticateDevice(db, req.headers.authorization);
    const input = telemetrySchema.parse(req.body);
    if (input.device_id !== key.deviceId)
      throw new ApiError(403, 'DEVICE_MISMATCH', 'Key không thuộc thiết bị này.');
    const result = await ingest(db, key.keyId, input, notify);
    reply(res, { accepted: result.accepted });
    if (result.created.length > 0) {
      onTelemetry(input.device_id);
      onEvent('alert.state.changed', input.device_id);
      if (result.eventsChanged) onEvent('alert.event.created', input.device_id);
      onEvent('device.status.changed', input.device_id);
    }
  });

  const transport = express.Router();
  registerDeviceTransport(transport, { db, reply, publish: onEvent });
  registerAlertTransport(transport, { db, reply, publish: onEvent, notify });
  app.use('/api/v1', transport);

  app.use('/api/v1', async (req, res, next) => {
    const session = await authenticateUser(db, req.headers.authorization, req.headers.cookie);
    res.locals.session = session;
    next();
  });
  app.get('/api/v1/auth/session', (_req, res) =>
    reply(res, {
      user: res.locals.session.user,
      expires_at: res.locals.session.expiresAt.toISOString(),
    }),
  );
  app.post('/api/v1/auth/logout', async (_req, res) => {
    const sessionId = res.locals.session.sessionId as string;
    await db.session.delete({ where: { id: sessionId } });
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    onLogout(sessionId);
    res.status(204).end();
  });
  const admin: express.RequestHandler = (_req, res, next) => {
    if (res.locals.session.user.role !== 'admin')
      return next(new ApiError(403, 'FORBIDDEN', 'Chỉ admin được thực hiện thao tác này.'));
    next();
  };
  const operator: express.RequestHandler = (_req, res, next) => {
    if (!['admin', 'operator'].includes(res.locals.session.user.role as string))
      return next(new ApiError(403, 'FORBIDDEN', 'Chỉ operator/admin được xác nhận sự cố.'));
    next();
  };
  const features = express.Router();
  const context = { db, reply, admin, operator, publish: onEvent, notify };
  registerDevices(features, context);
  registerAlerts(features, context);
  registerAnalytics(features, context);
  registerUsers(features, context, onLogout);
  registerPushSubscriptions(features, context, webPush);
  app.use('/api/v1', features);
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Endpoint không tồn tại.')));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) return;
    const invalidJson = error instanceof SyntaxError && 'body' in error;
    const oversized =
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.too.large';
    const status =
      error instanceof ApiError
        ? error.status
        : error instanceof ZodError
          ? 422
          : invalidJson
            ? 400
            : oversized
              ? 413
              : 503;
    const code =
      error instanceof ApiError
        ? error.code
        : error instanceof ZodError
          ? 'VALIDATION_ERROR'
          : invalidJson
            ? 'INVALID_JSON'
            : oversized
              ? 'PAYLOAD_TOO_LARGE'
              : 'SERVICE_UNAVAILABLE';
    if (status >= 500) onFailure({ request_id: res.locals.requestId as string, code });
    res.status(status).json({
      error: {
        code,
        message:
          error instanceof ApiError
            ? error.message
            : error instanceof ZodError
              ? 'Dữ liệu không hợp lệ.'
              : 'Không thể xử lý yêu cầu.',
        ...(error instanceof ZodError
          ? { details: error.issues.map((i) => ({ path: i.path, message: i.message })) }
          : {}),
      },
      meta: { request_id: res.locals.requestId },
    });
  };
  app.use(errors);
  return app;
}
