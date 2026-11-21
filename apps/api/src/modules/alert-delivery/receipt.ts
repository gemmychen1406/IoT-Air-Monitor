import type { Prisma } from '@prisma/client';
import type { ReceiptView } from '@iot/contracts';
import { ApiError } from '../../lib/errors.js';

export function receiptView(row: { receivedAt: Date; late: boolean }): ReceiptView {
  return { received_at: row.receivedAt.toISOString(), source: 'web', late: row.late };
}

export function eligibleForReceipt(tx: Prisma.TransactionClient, incidentId: string, userId: string) {
  // Telegram targets the workspace. Push targets the owner of each queued subscription.
  return tx.alertDelivery.findFirst({
    where: { incidentId, OR: [{ channel: 'telegram' }, { channel: 'webpush', recipientUserId: userId }] },
    select: { ordinal: true },
  });
}

export async function recordReceipt(
  tx: Prisma.TransactionClient,
  incidentId: string,
  userId: string,
  sessionId: string,
): Promise<ReceiptView> {
  const session = await tx.session.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session || session.userId !== userId || !session.user.active || session.expiresAt <= new Date())
    throw new ApiError(401, 'UNAUTHORIZED', 'Phiên đã hết hạn hoặc bị thu hồi.');

  const [incident] = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM alert_incidents WHERE id = ${incidentId}::uuid FOR SHARE
  `;
  if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sự cố.');
  if (!(await eligibleForReceipt(tx, incidentId, userId)))
    throw new ApiError(403, 'RECEIPT_NOT_ELIGIBLE', 'Tài khoản không thuộc đối tượng nhận cảnh báo này.');

  // INSERT ON CONFLICT DO NOTHING waits for a concurrent insert and preserves its timestamp.
  await tx.alertReceipt.createMany({
    data: { incidentId, userId, late: incident.status === 'ended' },
    skipDuplicates: true,
  });
  return receiptView(await tx.alertReceipt.findUniqueOrThrow({
    where: { incidentId_userId: { incidentId, userId } },
  }));
}
