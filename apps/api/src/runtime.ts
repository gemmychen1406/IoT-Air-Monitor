import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { Database } from '@iot/database';
import { createApp } from './app.js';
import { authenticateUser } from './modules/auth.js';
import { z } from 'zod';
import { allowedWebOrigins } from './lib/origins.js';
import { reconcileOffline } from './modules/presence.js';
import { telegramNotifier, startTelegramWorker } from './modules/notifications.js';
import type { TelegramConfig } from './modules/telegram-client.js';
import { webPushNotifier, startWebPushWorker, type WebPushConfig } from './modules/web-push.js';

export function createRuntime(
  db: Database,
  origin: string,
  logging: {
    onRequest?: (entry: { request_id: string; method: string; status: number }) => void;
    onFailure?: (entry: { request_id: string; code: string }) => void;
    secureCookies?: boolean;
    telegram?: TelegramConfig;
    webPush?: WebPushConfig;
    onNotification?: (entry: {
      notification_id?: string;
      status?: string;
      code?: string | null;
      channel?: 'telegram' | 'webpush';
    }) => void;
  } = {},
) {
  const app = createApp({
    db,
    origin,
    ...logging,
    webPush: logging.webPush,
    notify:
      logging.telegram || logging.webPush
        ? async (tx, incident) => {
            if (logging.telegram)
              await telegramNotifier(logging.telegram.includeSimulators)(tx, incident);
            if (logging.webPush) await webPushNotifier()(tx, incident);
          }
        : undefined,
    onTelemetry: (deviceId) =>
      io
        .of('/monitoring')
        .to(`device:${deviceId}`)
        .emit('telemetry.created', {
          version: 1,
          event_id: crypto.randomUUID(),
          type: 'telemetry.created',
          emitted_at: new Date().toISOString(),
          device_id: deviceId,
          data: { refetch: true },
        }),
    onLogout: (sessionId) =>
      io.of('/monitoring').in(`session:${sessionId}`).disconnectSockets(true),
    onEvent: (type, deviceId) => publish(type, deviceId),
  });
  const http = createServer(app);
  const origins = allowedWebOrigins(origin);
  const io = new Server(http, {
    cors: { origin: origins, credentials: true },
    maxHttpBufferSize: 16384,
    allowRequest: (req, done) =>
      done(null, !req.headers.origin || origins.includes(req.headers.origin)),
  });
  const namespace = io.of('/monitoring');
  function publish(type: string, deviceId: string) {
    const audience = type === 'device.updated' ? namespace : namespace.to(`device:${deviceId}`);
    audience.emit(type, {
      version: 1,
      event_id: crypto.randomUUID(),
      type,
      emitted_at: new Date().toISOString(),
      device_id: deviceId,
      data: { refetch: true },
    });
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopWorker: (() => Promise<void>) | undefined;
  let stopPushWorker: (() => Promise<void>) | undefined;
  let reconciling = false;
  async function reconcile() {
    if (reconciling) return;
    reconciling = true;
    try {
      for (const id of await reconcileOffline(db)) publish('device.status.changed', id);
    } catch {
      logging.onFailure?.({ request_id: 'presence', code: 'PRESENCE_RECONCILE_FAILED' });
    } finally {
      reconciling = false;
    }
  }
  http.on('listening', () => {
    if (logging.telegram)
      stopWorker = startTelegramWorker(db, logging.telegram, (entry) =>
        logging.onNotification?.({ ...entry, channel: 'telegram' }),
      );
    if (logging.webPush)
      stopPushWorker = startWebPushWorker(db, logging.webPush, (entry) =>
        logging.onNotification?.({ ...entry, channel: 'webpush' }),
      );
    timer = setInterval(() => void reconcile(), 5000);
    timer.unref();
    void reconcile();
  });
  http.on('close', () => {
    if (timer) clearInterval(timer);
    void stopWorker?.();
    void stopPushWorker?.();
  });
  namespace.use(async (socket, next) => {
    try {
      socket.data.session = await authenticateUser(db, undefined, socket.request.headers.cookie);
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });
  namespace.on('connection', (socket) => {
    const session = socket.data.session as Awaited<ReturnType<typeof authenticateUser>>;
    void socket.join(`session:${session.sessionId}`);
    const expiry = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, session.expiresAt.getTime() - Date.now()),
    );
    expiry.unref();
    socket.on('disconnect', () => clearTimeout(expiry));
    const subscribeSchema = z.strictObject({ device_ids: z.array(z.uuid()).min(1).max(100) });
    socket.on('devices.subscribe', async (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') return;
      const parsed = subscribeSchema.safeParse(payload);
      if (!parsed.success) return ack({ error: 'VALIDATION_ERROR', accepted_device_ids: [] });
      try {
        await authenticateUser(db, undefined, socket.request.headers.cookie);
        const devices = await db.device.findMany({
          where: { id: { in: parsed.data.device_ids } },
          select: { id: true },
        });
        const accepted = devices.map((d) => d.id);
        // Group-scoped v1: all authenticated roles can read all devices.
        await socket.join(accepted.map((id) => `device:${id}`));
        ack({
          accepted_device_ids: accepted,
          rejected_device_ids: parsed.data.device_ids.filter((id) => !accepted.includes(id)),
        });
      } catch {
        socket.disconnect(true);
      }
    });
    socket.on('devices.unsubscribe', (payload: unknown) => {
      const parsed = subscribeSchema.safeParse(payload);
      if (parsed.success)
        for (const id of parsed.data.device_ids) void socket.leave(`device:${id}`);
    });
  });
  return {
    app,
    http,
    io,
    stopNotifications: async () => {
      await stopWorker?.();
      await stopPushWorker?.();
    },
  };
}
