import type { Database } from '@iot/database';
import { z } from 'zod';

export async function runMaintenance(
  db: Database,
  options: { apply?: boolean; now?: Date; batchSize?: number } = {},
) {
  const now = options.now ?? new Date();
  const batchSize = z
    .number()
    .int()
    .min(1)
    .max(5000)
    .parse(options.batchSize ?? 1000);
  const cutoff = new Date(now.getTime() - 14 * 86400000);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(73143)`;
      const [count] = await tx.$queryRaw<
        { n: number }[]
      >`SELECT COUNT(*)::int AS n FROM sensor_readings r WHERE received_at < ${cutoff} AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.latest_id = r.id)`;
      const auditCutoff = new Date(now.getTime() - 180 * 86400000);
      const statusCutoff = new Date(now.getTime() - 365 * 86400000);
      const eligibleAudit = await tx.auditLog.count({ where: { createdAt: { lt: auditCutoff } } });
      const eligibleStatus = await tx.deviceStatusHistory.count({
        where: { detectedAt: { lt: statusCutoff } },
      });
      const preview = {
        eligible: count!.n,
        eligible_audit: eligibleAudit,
        eligible_status: eligibleStatus,
      };
      if (!options.apply)
        return { ...preview, removed: 0, pruned_audit: 0, pruned_status: 0, dry_run: true };
      // Aggregate only rows actually deleted in this transaction. A rollback restores
      // both raw and rollups; retries cannot count the same raw sample twice.
      const [result] = await tx.$queryRaw<{ n: number }[]>`
      WITH removed AS (
        DELETE FROM sensor_readings WHERE id IN (
          SELECT r.id FROM sensor_readings r WHERE received_at < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.latest_id = r.id)
          ORDER BY received_at, id LIMIT ${batchSize} FOR UPDATE
        ) RETURNING *
      ), aggregated AS (
        SELECT r.device_id, resolution, basis, metric, bits, date_trunc(resolution, t, 'UTC') AS bucket,
          COUNT(*)::int AS total, COUNT(v) FILTER (WHERE quality IN ('valid','uncalibrated'))::int AS valid,
          COALESCE(SUM(v) FILTER (WHERE quality IN ('valid','uncalibrated')),0) AS value_sum,
          MIN(v) FILTER (WHERE quality IN ('valid','uncalibrated')) AS minimum,
          MAX(v) FILTER (WHERE quality IN ('valid','uncalibrated')) AS maximum
        FROM removed r
        CROSS JOIN LATERAL (VALUES
          ('temperature_c', r.temperature_c::double precision, r.payload #>> '{sensors,dht11,quality}', 0),
          ('humidity_pct', r.humidity_pct::double precision, r.payload #>> '{sensors,dht11,quality}', 0),
          ('mq2_adc', r.mq2_adc::double precision, r.payload #>> '{sensors,mq2,quality}', (r.payload #>> '{sensors,mq2,adc_bits}')::int),
          ('mq7_adc', r.mq7_adc::double precision, r.payload #>> '{sensors,mq7,quality}', (r.payload #>> '{sensors,mq7,adc_bits}')::int)
        ) metrics(metric, v, quality, bits)
        CROSS JOIN (VALUES ('minute'),('hour')) resolutions(resolution)
        CROSS JOIN LATERAL (VALUES ('sampled',r.sampled_at),('received',r.received_at)) times(basis,t)
        WHERE t IS NOT NULL GROUP BY r.device_id, resolution, basis, metric, bits, bucket
      ), saved AS (
        INSERT INTO sensor_rollups (device_id,resolution,time_basis,metric,adc_bits,bucket_start,total_count,valid_count,value_sum,minimum,maximum)
        SELECT device_id,resolution,basis,metric,bits,bucket,total,valid,value_sum,minimum,maximum FROM aggregated
        ON CONFLICT (device_id,resolution,time_basis,metric,adc_bits,bucket_start) DO UPDATE SET
          total_count = sensor_rollups.total_count + EXCLUDED.total_count,
          valid_count = sensor_rollups.valid_count + EXCLUDED.valid_count,
          value_sum = sensor_rollups.value_sum + EXCLUDED.value_sum,
          minimum = LEAST(sensor_rollups.minimum,EXCLUDED.minimum),
          maximum = GREATEST(sensor_rollups.maximum,EXCLUDED.maximum)
        RETURNING 1
      ) SELECT COUNT(*)::int AS n FROM removed`;
      await tx.sensorRollup.deleteMany({
        where: {
          OR: [
            { resolution: 'minute', bucketStart: { lt: new Date(now.getTime() - 90 * 86400000) } },
            { resolution: 'hour', bucketStart: { lt: new Date(now.getTime() - 365 * 86400000) } },
          ],
        },
      });
      await tx.session.deleteMany({ where: { expiresAt: { lt: now } } });
      const prunedAudit =
        await tx.$executeRaw`DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created_at < ${auditCutoff} ORDER BY id LIMIT ${batchSize})`;
      const prunedStatus =
        await tx.$executeRaw`DELETE FROM device_status_history WHERE id IN (SELECT id FROM device_status_history WHERE detected_at < ${statusCutoff} ORDER BY id LIMIT ${batchSize})`;
      // Incidents/events/acknowledgements remain intact: safety history is never
      // automatically cascaded away, even when older than the planned minimum.
      await tx.auditLog.create({
        data: {
          action: 'maintenance.applied',
          resourceType: 'maintenance',
          metadata: { removed: result!.n, raw_days: 14, batch_size: batchSize },
        },
      });
      return {
        ...preview,
        removed: result!.n,
        pruned_audit: prunedAudit,
        pruned_status: prunedStatus,
        dry_run: false,
      };
    },
    { timeout: 60000 },
  );
}
