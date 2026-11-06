import type { Database } from '@iot/database';
import type { Device, Prisma } from '@prisma/client';
import { ApiError } from '../lib/errors.js';

export async function markSeen(
  tx: Prisma.TransactionClient,
  device: Device,
  now: Date,
  keyId: string,
) {
  const key = await tx.deviceCredential.findUnique({ where: { keyId } });
  if (
    !key ||
    key.deviceId !== device.id ||
    key.revokedAt ||
    (key.expiresAt && key.expiresAt <= now)
  )
    throw new ApiError(401, 'INVALID_DEVICE_KEY', 'Credential đã hết hiệu lực.');
  if (device.archivedAt) throw new ApiError(403, 'DEVICE_ARCHIVED', 'Thiết bị đang lưu trữ.');
  if (device.connectivity !== 'online') {
    await tx.deviceStatusHistory.create({
      data: {
        deviceId: device.id,
        previousStatus: device.connectivity,
        newStatus: 'online',
        effectiveAt: now,
        detectedAt: now,
        reason: 'authenticated_contact',
      },
    });
  }
  await tx.device.update({
    where: { id: device.id },
    data: { lastSeenAt: now, connectivity: 'online' },
  });
  await tx.deviceCredential.update({ where: { keyId }, data: { lastUsedAt: now } });
}

export async function reconcileOffline(db: Database, now = new Date()) {
  const candidates = await db.device.findMany({
    where: {
      connectivity: 'online',
      archivedAt: null,
      lastSeenAt: { lte: new Date(now.getTime() - 30000) },
    },
    take: 1000,
  });
  const changed: string[] = [];
  for (const candidate of candidates) {
    const cutoff = new Date(now.getTime() - Math.max(30000, candidate.reportingIntervalMs * 3));
    if (!candidate.lastSeenAt || candidate.lastSeenAt > cutoff) continue;
    const didChange = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM devices WHERE id = ${candidate.id}::uuid FOR UPDATE`;
      const current = await tx.device.findUniqueOrThrow({ where: { id: candidate.id } });
      if (
        current.connectivity !== 'online' ||
        current.archivedAt ||
        !current.lastSeenAt ||
        current.lastSeenAt.getTime() + Math.max(30000, current.reportingIntervalMs * 3) >
          now.getTime()
      )
        return false;
      await tx.device.update({ where: { id: current.id }, data: { connectivity: 'offline' } });
      await tx.deviceStatusHistory.create({
        data: {
          deviceId: current.id,
          previousStatus: 'online',
          newStatus: 'offline',
          effectiveAt: new Date(
            current.lastSeenAt.getTime() + Math.max(30000, current.reportingIntervalMs * 3),
          ),
          detectedAt: now,
          reason: 'heartbeat_timeout',
        },
      });
      return true;
    });
    if (didChange) changed.push(candidate.id);
  }
  return changed;
}
