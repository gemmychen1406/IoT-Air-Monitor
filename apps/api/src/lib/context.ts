import type { RequestHandler, Response } from 'express';
import type { Database } from '@iot/database';
import type { Prisma } from '@prisma/client';
import { ApiError } from './errors.js';
import type { AlertNotifier } from '../modules/notifications.js';

export type FeatureContext = {
  db: Database;
  reply: (res: Response, data: unknown, extra?: object) => unknown;
  admin: RequestHandler;
  operator: RequestHandler;
  publish: (type: string, deviceId: string) => void;
  notify?: AlertNotifier;
};
export async function audit(
  tx: Prisma.TransactionClient,
  userId: string | null,
  deviceId: string,
  action: string,
  metadata: Prisma.InputJsonObject = {},
) {
  await tx.auditLog.create({ data: { userId, deviceId, resourceId: deviceId, action, metadata } });
}
export async function lockDevice(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM devices WHERE id = ${id}::uuid FOR UPDATE`;
  const device = await tx.device.findUnique({ where: { id } });
  if (!device) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy thiết bị.');
  return device;
}
