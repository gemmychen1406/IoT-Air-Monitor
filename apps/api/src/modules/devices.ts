import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  createDeviceSchema,
  patchDeviceSchema,
  credentialSchema,
  rotationSchema,
  updateConfigSchema,
  configAckSchema,
  heartbeatSchema,
  counterSchema,
} from '@iot/contracts';
import type { FeatureContext } from '../lib/context.js';
import { audit, lockDevice } from '../lib/context.js';
import { ApiError } from '../lib/errors.js';
import { authenticateDevice, hashSecret, newSecret } from './auth.js';
import { listDevices } from './telemetry.js';
import { markSeen, reconcileOffline } from './presence.js';

export const initialConfig = { reporting_interval_ms: 5000 };
const keyParam = z.string().regex(/^[A-Za-z0-9_-]{16}$/);

export function registerDeviceTransport(
  router: Router,
  { db, reply, publish }: Pick<FeatureContext, 'db' | 'reply' | 'publish'>,
) {
  router.get('/device/config', async (req, res) => {
    const key = await authenticateDevice(db, req.headers.authorization);
    const device = await db.device.findUniqueOrThrow({ where: { id: key.deviceId } });
    const config = await db.deviceConfig.findUniqueOrThrow({
      where: { deviceId_version: { deviceId: device.id, version: device.desiredConfigVersion } },
    });
    const etag = `"${config.version}-${config.contentHash}"`;
    res.setHeader('ETag', etag);
    if (req.get('If-None-Match') === etag) {
      res.status(304).end();
      return;
    }
    reply(res, {
      version: config.version,
      config: config.config,
      content_hash: config.contentHash,
    });
  });
  router.post('/device/config/ack', async (req, res) => {
    const key = await authenticateDevice(db, req.headers.authorization);
    const input = configAckSchema.parse(req.body);
    await db.$transaction(async (tx) => {
      const device = await lockDevice(tx, key.deviceId);
      const config = await tx.deviceConfig.findUnique({
        where: { deviceId_version: { deviceId: device.id, version: input.version } },
      });
      if (!config || config.contentHash !== input.content_hash)
        throw new ApiError(422, 'CONFIG_HASH_MISMATCH', 'Version/hash cấu hình không khớp.');
      await tx.deviceConfigAck.upsert({
        where: {
          deviceId_version_status: {
            deviceId: device.id,
            version: input.version,
            status: input.status,
          },
        },
        create: {
          deviceId: device.id,
          version: input.version,
          status: input.status,
          reason: input.reason,
        },
        update: {},
      });
      if (input.status === 'applied' && input.version >= (device.appliedConfigVersion ?? 0)) {
        const content = config.config as { reporting_interval_ms: number };
        await tx.device.update({
          where: { id: device.id },
          data: {
            appliedConfigVersion: input.version,
            reportingIntervalMs: content.reporting_interval_ms,
          },
        });
      }
      await markSeen(tx, device, new Date(), key.keyId);
    });
    reply(res, { accepted: true });
    publish('device.config.applied', key.deviceId);
  });
  router.post('/device/heartbeat', async (req, res) => {
    const key = await authenticateDevice(db, req.headers.authorization);
    const input = heartbeatSchema.parse(req.body);
    if (input.device_id !== key.deviceId)
      throw new ApiError(403, 'DEVICE_MISMATCH', 'Key không thuộc thiết bị này.');
    await db.$transaction(async (tx) => {
      const device = await lockDevice(tx, key.deviceId);
      const count = BigInt(input.boot_counter);
      if (device.bootCounter === count && device.bootId !== input.boot_id)
        throw new ApiError(409, 'BOOT_CONFLICT', 'Boot counter bị tái sử dụng.');
      if (device.bootCounter === null || count > device.bootCounter)
        await tx.device.update({
          where: { id: device.id },
          data: { bootId: input.boot_id, bootCounter: count, latestSeq: null, latestId: null },
        });
      await markSeen(tx, device, new Date(), key.keyId);
    });
    reply(res, { accepted: true });
    publish('device.status.changed', key.deviceId);
  });
}

export function registerDevices(router: Router, { db, reply, admin, publish }: FeatureContext) {
  router.get('/devices', async (req, res) => {
    const query = z
      .object({ archived: z.enum(['all', 'true', 'false']).default('false') })
      .parse(req.query);
    for (const id of await reconcileOffline(db)) publish('device.status.changed', id);
    reply(res, await listDevices(db, query.archived));
  });
  router.post('/devices', admin, async (req, res) => {
    const input = createDeviceSchema.parse(req.body);
    const device = await db.$transaction(async (tx) => {
      const row = await tx.device.create({
        data: { name: input.name, sourceKind: input.source_kind },
      });
      await tx.deviceConfig.create({
        data: {
          deviceId: row.id,
          version: 1,
          config: initialConfig,
          contentHash: hashSecret(JSON.stringify(initialConfig)),
          createdBy: res.locals.session.user.id as string,
        },
      });
      await audit(tx, res.locals.session.user.id as string, row.id, 'device.created', {
        source_kind: row.sourceKind,
      });
      return row;
    });
    res.status(201);
    reply(res, { id: device.id, name: device.name, source_kind: device.sourceKind });
    publish('device.updated', device.id);
  });
  router.get('/devices/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const device = (await listDevices(db, 'all', id))[0];
    if (!device) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy thiết bị.');
    reply(res, device);
  });
  router.patch('/devices/:id', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = patchDeviceSchema.parse(req.body);
    await db.$transaction(async (tx) => {
      const device = await lockDevice(tx, id);
      const now = new Date();
      if (input.archived && !device.archivedAt && device.connectivity !== 'offline') {
        await tx.deviceStatusHistory.create({
          data: {
            deviceId: id,
            previousStatus: device.connectivity,
            newStatus: 'offline',
            effectiveAt: now,
            detectedAt: now,
            reason: 'device_archived',
          },
        });
      }
      await tx.device.update({
        where: { id },
        data: {
          name: input.name,
          location: input.location,
          description: input.description,
          ...(input.archived === undefined
            ? {}
            : {
                archivedAt: input.archived ? (device.archivedAt ?? now) : null,
                connectivity: input.archived ? 'offline' : device.connectivity,
              }),
        },
      });
      await audit(tx, res.locals.session.user.id as string, id, 'device.updated', input);
    });
    reply(res, (await listDevices(db, 'all', id))[0]);
    publish('device.updated', id);
  });

  router.get('/devices/:id/credentials', admin, async (req, res) => {
    const deviceId = z.uuid().parse(req.params.id);
    const query = z
      .strictObject({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        cursor: keyParam.optional(),
      })
      .parse(req.query);
    if (!(await db.device.findUnique({ where: { id: deviceId } })))
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy thiết bị.');
    const anchor = query.cursor
      ? await db.deviceCredential.findFirst({ where: { deviceId, keyId: query.cursor } })
      : null;
    if (query.cursor && !anchor)
      throw new ApiError(422, 'INVALID_CURSOR', 'Cursor không thuộc thiết bị.');
    const keys = await db.deviceCredential.findMany({
      where: {
        deviceId,
        ...(anchor
          ? {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = keys.slice(0, query.limit);
    reply(
      res,
      page.map((key) => ({
        key_id: key.keyId,
        label: key.label,
        created_at: key.createdAt.toISOString(),
        expires_at: key.expiresAt?.toISOString() ?? null,
        revoked_at: key.revokedAt?.toISOString() ?? null,
        last_used_at: key.lastUsedAt?.toISOString() ?? null,
        replaces_key_id: key.replacesKeyId,
        status: key.revokedAt
          ? 'revoked'
          : key.expiresAt && key.expiresAt <= new Date()
            ? 'expired'
            : 'active',
      })),
      { next_cursor: keys.length > query.limit ? page.at(-1)!.keyId : null },
    );
  });
  async function issue(
    deviceId: string,
    userId: string,
    input: { label: string; expires_at?: string | null },
    previous?: string,
    overlap = 60,
  ) {
    if (input.expires_at && Date.parse(input.expires_at) <= Date.now())
      throw new ApiError(422, 'INVALID_EXPIRY', 'Hạn key phải ở tương lai.');
    const keyId = randomBytes(12).toString('base64url');
    const secret = newSecret();
    await db.$transaction(async (tx) => {
      const device = await lockDevice(tx, deviceId);
      if (device.archivedAt)
        throw new ApiError(409, 'DEVICE_ARCHIVED', 'Khôi phục thiết bị trước khi cấp key.');
      if (previous) {
        const old = await tx.deviceCredential.findFirst({
          where: { deviceId, keyId: previous, revokedAt: null },
        });
        if (!old || (old.expiresAt && old.expiresAt <= new Date()))
          throw new ApiError(409, 'KEY_NOT_ACTIVE', 'Key cũ không còn hoạt động.');
        const expiresAt = new Date(
          Math.min(old.expiresAt?.getTime() ?? Infinity, Date.now() + overlap * 60000),
        );
        await tx.deviceCredential.update({ where: { keyId: previous }, data: { expiresAt } });
      }
      const activeCount = await tx.deviceCredential.count({
        where: {
          deviceId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (activeCount >= 20)
        throw new ApiError(409, 'KEY_LIMIT', 'Tối đa 20 key hoạt động; thu hồi key cũ trước.');
      await tx.deviceCredential.create({
        data: {
          deviceId,
          keyId,
          secretHash: hashSecret(secret),
          label: input.label,
          expiresAt: input.expires_at,
          replacesKeyId: previous,
        },
      });
      await audit(tx, userId, deviceId, previous ? 'credential.rotated' : 'credential.created', {
        key_id: keyId,
        replaces_key_id: previous ?? null,
      });
    });
    return { key_id: keyId, key: `${keyId}.${secret}` };
  }
  router.post('/devices/:id/credentials', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = credentialSchema.parse(req.body ?? {});
    const result = await issue(id, res.locals.session.user.id as string, input);
    res.status(201);
    reply(res, result);
    publish('device.updated', id);
  });
  router.post('/devices/:id/credentials/:keyId/rotate', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const keyId = keyParam.parse(req.params.keyId);
    const input = rotationSchema.parse(req.body ?? {});
    const result = await issue(
      id,
      res.locals.session.user.id as string,
      input,
      keyId,
      input.overlap_minutes,
    );
    res.status(201);
    reply(res, result);
    publish('device.updated', id);
  });
  router.delete('/devices/:id/credentials/:keyId', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const keyId = keyParam.parse(req.params.keyId);
    await db.$transaction(async (tx) => {
      await lockDevice(tx, id);
      const result = await tx.deviceCredential.updateMany({
        where: { deviceId: id, keyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (
        !result.count &&
        !(await tx.deviceCredential.findFirst({ where: { deviceId: id, keyId } }))
      )
        throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy key.');
      if (result.count)
        await audit(tx, res.locals.session.user.id as string, id, 'credential.revoked', {
          key_id: keyId,
        });
    });
    res.status(204).end();
    publish('device.updated', id);
  });

  router.get('/devices/:id/config', async (req, res) => {
    const deviceId = z.uuid().parse(req.params.id);
    const device = await db.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy thiết bị.');
    const [history, acknowledgements] = await Promise.all([
      db.deviceConfig.findMany({
        where: { deviceId },
        orderBy: { version: 'desc' },
        take: 100,
        include: { author: { select: { email: true } } },
      }),
      db.deviceConfigAck.findMany({
        where: { deviceId },
        orderBy: { receivedAt: 'desc' },
        take: 100,
      }),
    ]);
    const versions = history.map((c) => ({
      version: c.version,
      config: c.config,
      content_hash: c.contentHash,
      created_at: c.createdAt.toISOString(),
      author: c.author?.email ?? null,
    }));
    reply(res, {
      desired: versions.find((c) => c.version === device.desiredConfigVersion),
      applied_version: device.appliedConfigVersion,
      history: versions,
      acknowledgements: acknowledgements.map((a) => ({
        version: a.version,
        status: a.status,
        reason: a.reason,
        received_at: a.receivedAt.toISOString(),
      })),
    });
  });
  router.put('/devices/:id/config', admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = updateConfigSchema.parse(req.body);
    const config = await db.$transaction(async (tx) => {
      const device = await lockDevice(tx, id);
      if (device.archivedAt) throw new ApiError(409, 'DEVICE_ARCHIVED', 'Thiết bị đang lưu trữ.');
      if (input.expected_version !== device.desiredConfigVersion)
        throw new ApiError(
          409,
          'CONFIG_VERSION_CONFLICT',
          'Cấu hình đã thay đổi. Tải lại trước khi lưu.',
        );
      const row = await tx.deviceConfig.create({
        data: {
          deviceId: id,
          version: device.desiredConfigVersion + 1,
          config: input.config,
          contentHash: hashSecret(JSON.stringify(input.config)),
          createdBy: res.locals.session.user.id as string,
        },
      });
      await tx.device.update({ where: { id }, data: { desiredConfigVersion: row.version } });
      await audit(tx, res.locals.session.user.id as string, id, 'config.created', {
        version: row.version,
        reporting_interval_ms: input.config.reporting_interval_ms,
      });
      return row;
    });
    reply(res, {
      version: config.version,
      config: config.config,
      content_hash: config.contentHash,
    });
    publish('device.config.updated', id);
  });
  router.get('/devices/:id/status-history', async (req, res) => {
    const deviceId = z.uuid().parse(req.params.id);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        cursor: counterSchema.optional(),
      })
      .parse(req.query);
    if (!(await db.device.findUnique({ where: { id: deviceId } })))
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy thiết bị.');
    const rows = await db.deviceStatusHistory.findMany({
      where: { deviceId, ...(query.cursor ? { id: { lt: BigInt(query.cursor) } } : {}) },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    reply(
      res,
      page.map((s) => ({
        id: String(s.id),
        previous_status: s.previousStatus,
        new_status: s.newStatus,
        effective_at: s.effectiveAt.toISOString(),
        detected_at: s.detectedAt.toISOString(),
        reason: s.reason,
      })),
      { next_cursor: rows.length > query.limit ? String(page.at(-1)!.id) : null },
    );
  });
}
