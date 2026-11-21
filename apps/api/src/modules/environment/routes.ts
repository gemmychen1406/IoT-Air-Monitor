import type { Router } from 'express';
import { z } from 'zod';
import {
  counterSchema, defaultEnvironmentPolicy, deliveryChannels, deliveryStatuses,
  environmentKinds, environmentPolicyInput,
  type EnvironmentHistoryView, type EnvironmentSettingsView, type UserView,
} from '@iot/contracts';
import { ApiError } from '../../lib/errors.js';
import type { FeatureContext } from '../../lib/context.js';
import { environmentAttempts } from './delivery.js';
import { eligiblePushes, lockEnvironmentPolicy, nextDigest, type EnvironmentAvailability } from './policy.js';

const filters = z.strictObject({
  channel: z.enum(deliveryChannels).optional(),
  kind: z.enum(environmentKinds).optional(),
  status: z.enum(deliveryStatuses).optional(),
  device_id: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: counterSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).refine((v) => !v.from || !v.to || Date.parse(v.from) < Date.parse(v.to));

export function registerEnvironment(router: Router, { db, reply, admin }: FeatureContext, availability: EnvironmentAvailability) {
  for (const channel of deliveryChannels) {
    const telegram = channel === 'telegram';
    const path = `/environment/settings/${channel}`;
    const guards = telegram ? [admin] : [];
    const key = (user: UserView) => telegram ? 'telegram' : `webpush:${user.id}`;
    const settingsView = async (user: UserView): Promise<EnvironmentSettingsView> => {
      const now = new Date();
      const row = await db.environmentPolicy.findUnique({ where: { id: key(user) }, include: { devices: true } });
      const policy = row ? environmentPolicyInput.parse(row.config) : defaultEnvironmentPolicy;
      const next = row && policy.enabled && policy.digest.enabled
        ? row.devices.map((item) => nextDigest(item.startedAt, now, policy.digest.interval_minutes).getTime())
        : [];
      const channel_ready = telegram ? availability.telegram : !!availability.pushPublicKey &&
        (await eligiblePushes(db, user.id, availability.pushPublicKey, now)).length > 0;
      return {
        policy, channel_ready, simulator_allowed_by_server: !telegram || availability.telegramSimulators,
        next_digest_at: next.length ? new Date(Math.min(...next)).toISOString() : null,
      };
    };
    router.get(path, ...guards, async (_req, res) => reply(res, await settingsView(res.locals.session.user as UserView)));
    router.put(path, ...guards, async (req, res) => {
      const user = res.locals.session.user as UserView;
      const policy = environmentPolicyInput.parse(req.body);
      const id = key(user);
      await db.$transaction(async (tx) => {
        await lockEnvironmentPolicy(tx, id, true);
        if (await tx.device.count({ where: { id: { in: policy.device_ids } } }) !== policy.device_ids.length)
          throw new ApiError(422, 'INVALID_DEVICE_SELECTION', 'Một số thiết bị không tồn tại.');
        const old = await tx.environmentPolicy.findUnique({ where: { id }, select: { config: true } });
        const previous = old ? environmentPolicyInput.parse(old.config) : defaultEnvironmentPolicy;
        await tx.environmentPolicy.upsert({
          where: { id }, create: { id, channel, userId: telegram ? null : user.id, config: policy },
          update: { config: policy },
        });
        const devices = policy.enabled ? policy.device_ids : [];
        await tx.environmentDeviceState.deleteMany({ where: { policyId: id, deviceId: { notIn: devices } } });
        const now = new Date();
        if (devices.length) await tx.environmentDeviceState.createMany({
          data: devices.map((deviceId) => ({ policyId: id, deviceId, startedAt: now })),
          skipDuplicates: true,
        });
        if (!policy.connectivity.enabled || !previous.connectivity.enabled) {
          // Mark the current per-device high water mark without replaying past transitions.
          await tx.$executeRaw`
            UPDATE environment_device_states e SET offline_id=NULL, offline_at=NULL, offline_queued=false,
              status_cursor=COALESCE((SELECT MAX(h.id) FROM device_status_history h WHERE h.device_id=e.device_id),0)
            WHERE e.policy_id=${id}
          `;
        }
        const disabled = [
          ...(!policy.digest.enabled ? ['digest'] : []),
          ...(!policy.variation.enabled ? ['variation'] : []),
          ...(!policy.connectivity.enabled ? ['offline', 'online'] : []),
        ];
        await tx.environmentDelivery.updateMany({
          where: { policyId: id, status: 'pending', OR: [{ deviceId: { notIn: devices } }, { kind: { in: disabled } }] },
          data: { status: 'skipped', lastErrorCode: 'POLICY_OR_DEVICE_DISABLED' },
        });
        await tx.environmentDelivery.updateMany({
          where: { policyId: id, status: 'pending', lastErrorCode: 'QUIET_HOURS' },
          data: { nextAttemptAt: now },
        });
        const deferred = { status: 'pending', lastErrorCode: 'QUIET_HOURS', nextAttemptAt: { gt: now } };
        if (telegram) await tx.telegramNotification.updateMany({
          where: deferred, data: { nextAttemptAt: now },
        });
        else await tx.webPushDelivery.updateMany({
          where: { ...deferred, subscription: { session: { userId: user.id } } },
          data: { nextAttemptAt: now },
        });
      });
      reply(res, await settingsView(user));
    });
  }

  router.get('/environment/history', async (req, res) => {
    const user = res.locals.session.user as UserView;
    const f = filters.parse(req.query);
    const owner = { userId: user.id, channel: 'webpush' };
    const rows = await db.environmentDelivery.findMany({
      where: {
        OR: user.role === 'admin' ? [owner, { channel: 'telegram' }] : [owner],
        channel: f.channel, status: f.status, kind: f.kind, deviceId: f.device_id,
        ordinal: f.cursor ? { lt: BigInt(f.cursor) } : undefined,
        createdAt: { gte: f.from ? new Date(f.from) : undefined, lt: f.to ? new Date(f.to) : undefined },
      },
      orderBy: { ordinal: 'desc' }, take: f.limit + 1,
    });
    const data: EnvironmentHistoryView[] = rows.slice(0, f.limit).map((row) => ({
      id: row.id, kind: z.enum(environmentKinds).parse(row.kind), channel: z.enum(deliveryChannels).parse(row.channel),
      status: z.enum(deliveryStatuses).parse(row.status), device_name: row.deviceName, simulator: row.simulator,
      location: row.location, summary: row.summary, occurred_at: row.occurredAt.toISOString(),
      created_at: row.createdAt.toISOString(), next_attempt_at: row.nextAttemptAt.toISOString(),
      accepted_at: row.acceptedAt?.toISOString() ?? null, last_error_code: row.lastErrorCode, attempts: environmentAttempts(row),
    }));
    reply(res, data, { next_cursor: rows.length > f.limit ? String(rows[f.limit - 1]!.ordinal) : null });
  });
}
