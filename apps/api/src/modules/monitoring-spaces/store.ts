import type { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';

export const nameKey = (name: string) =>
  name.normalize('NFC').toLowerCase().normalize('NFC');

// Serialize MVP catalog writes so archiving cannot race with assignment or restoration.
export async function lockSpaceCatalog(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(174230, 1)`;
}

export async function requireArea(tx: Prisma.TransactionClient, id: string) {
  const area = await tx.monitoringArea.findUnique({ where: { id } });
  if (!area) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy khu vực.');
  return area;
}

export async function requireRoom(tx: Prisma.TransactionClient, id: string) {
  const room = await tx.monitoringRoom.findUnique({ where: { id }, include: { area: true } });
  if (!room) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy phòng.');
  return room;
}

export function assertActiveSpace(archivedAt: Date | null) {
  if (archivedAt) throw new ApiError(409, 'SPACE_ARCHIVED', 'Khu vực hoặc phòng đã lưu trữ.');
}

export function assertUniqueName(match: { id: string } | null, current?: string) {
  if (match && match.id !== current)
    throw new ApiError(409, 'DUPLICATE_NAME', 'Tên đã được sử dụng trong phạm vi này.');
}
