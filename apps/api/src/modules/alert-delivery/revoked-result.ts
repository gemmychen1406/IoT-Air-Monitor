import type { Database } from '@iot/database';
import type { PushResult } from '../web-push.js';

// A request can already be in flight when logout deletes its job. Reconcile
// only the attempt that was active on deletion. This never creates send work.
export async function recordRevokedPushResult(
  db: Database,
  jobId: string,
  attempt: number,
  result: PushResult,
  completed: Date,
) {
  await db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ ordinal: bigint }[]>`
      SELECT ordinal FROM alert_deliveries WHERE channel='webpush' AND job_id=${jobId}::uuid
      AND attempts=${attempt} AND status='skipped' AND last_error_code='PUSH_SUBSCRIPTION_REMOVED'
      FOR UPDATE
    `;
    if (!row) return;
    const updated = await tx.alertDeliveryAttempt.updateMany({
      where: {
        deliveryOrdinal: row.ordinal, number: attempt,
        outcome: 'unknown', errorCode: 'PUSH_SUBSCRIPTION_REMOVED',
      },
      data: { outcome: result.ok ? 'sent' : 'failed', errorCode: result.ok ? null : result.code, finishedAt: completed },
    });
    if (result.ok && updated.count) {
      await tx.alertDelivery.update({
        where: { ordinal: row.ordinal },
        data: { status: 'sent', acceptedAt: completed, lastErrorCode: null },
      });
    }
  });
}
