import type { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  historyQuerySchema,
  analyticsQuerySchema,
  exportQuerySchema,
  type Reading,
  type Stats,
} from '@iot/contracts';
import type { FeatureContext } from '../lib/context.js';
import { ApiError } from '../lib/errors.js';
import { readingView } from './telemetry.js';

type Range = { from?: string; to?: string; time_basis: 'sampled' | 'received' };
function rangeWhere(q: Range): Prisma.SensorReadingWhereInput {
  if (!q.from) return {};
  return q.time_basis === 'sampled'
    ? { sampledAt: { gte: new Date(q.from), lt: new Date(q.to!) } }
    : { receivedAt: { gte: new Date(q.from), lt: new Date(q.to!) } };
}
const metrics = {
  temperature_c: {
    value: Prisma.sql`temperature_c`,
    quality: Prisma.sql`payload #>> '{sensors,dht11,quality}'`,
    profile: Prisma.sql`NULL::int`,
    unit: '°C',
  },
  humidity_pct: {
    value: Prisma.sql`humidity_pct`,
    quality: Prisma.sql`payload #>> '{sensors,dht11,quality}'`,
    profile: Prisma.sql`NULL::int`,
    unit: '%RH',
  },
  mq2_adc: {
    value: Prisma.sql`mq2_adc`,
    quality: Prisma.sql`payload #>> '{sensors,mq2,quality}'`,
    profile: Prisma.sql`(payload #>> '{sensors,mq2,adc_bits}')::int`,
    unit: 'ADC',
  },
  mq7_adc: {
    value: Prisma.sql`mq7_adc`,
    quality: Prisma.sql`payload #>> '{sensors,mq7,quality}'`,
    profile: Prisma.sql`(payload #>> '{sensors,mq7,adc_bits}')::int`,
    unit: 'ADC',
  },
};

export function csvCell(value: string | number | boolean | null | undefined) {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && (/^\s*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
async function write(res: Response, text: string) {
  if (res.destroyed) return;
  if (!res.write(text))
    await new Promise<void>((resolve) => {
      const done = () => {
        res.off('drain', done);
        res.off('close', done);
        resolve();
      };
      res.once('drain', done);
      res.once('close', done);
    });
}

export function registerAnalytics(router: Router, { db, reply }: FeatureContext) {
  async function requireDevice(id: string) {
    const device = await db.device.findUnique({ where: { id } });
    if (!device) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy thiết bị.');
    return device;
  }
  router.get('/devices/:id/readings/latest', async (req, res) => {
    const device = await requireDevice(z.uuid().parse(req.params.id));
    const latest =
      device.latestId === null
        ? null
        : await db.sensorReading.findUnique({ where: { id: device.latestId } });
    reply(res, latest ? readingView(latest) : null);
  });
  router.get('/devices/:id/readings', async (req, res) => {
    const device = await requireDevice(z.uuid().parse(req.params.id));
    const q = historyQuerySchema.parse(req.query);
    const rows = await db.sensorReading.findMany({
      where: {
        deviceId: device.id,
        ...rangeWhere(q),
        ...(q.cursor ? { id: { lt: BigInt(q.cursor) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    reply(res, page.map(readingView), {
      next_cursor: rows.length > q.limit ? String(page.at(-1)!.id) : null,
      time_basis: q.time_basis,
    });
  });
  router.get('/devices/:id/analytics', async (req, res) => {
    const device = await requireDevice(z.uuid().parse(req.params.id));
    const q = analyticsQuerySchema.parse(req.query);
    const from = new Date(q.from!);
    const to = new Date(q.to!);
    const duration = to.getTime() - from.getTime();
    const previousFrom = new Date(from.getTime() - duration);
    const metric = metrics[q.metric];
    const time = q.time_basis === 'sampled' ? Prisma.sql`sampled_at` : Prisma.sql`received_at`;
    const resolution = q.bucket === 'minute' ? 'minute' : 'hour';
    const rollupInterval = resolution === 'minute' ? 60000 : 3600000;
    const sqlBase = (start: Date, end: Date) => Prisma.sql`
      SELECT ${time} AS t, 1 AS total_count,
        CASE WHEN ${metric.quality} IN ('valid', 'uncalibrated') AND ${metric.value} IS NOT NULL THEN 1 ELSE 0 END AS valid_count,
        CASE WHEN ${metric.quality} IN ('valid', 'uncalibrated') THEN ${metric.value}::double precision ELSE NULL END AS value_sum,
        CASE WHEN ${metric.quality} IN ('valid', 'uncalibrated') THEN ${metric.value}::double precision ELSE NULL END AS minimum,
        CASE WHEN ${metric.quality} IN ('valid', 'uncalibrated') THEN ${metric.value}::double precision ELSE NULL END AS maximum,
        COALESCE(${metric.profile},0) AS profile
      FROM sensor_readings
      WHERE device_id = ${device.id}::uuid AND ${time} >= ${start} AND ${time} < ${end}
        ${q.adc_bits === undefined ? Prisma.empty : Prisma.sql`AND ${metric.profile} = ${q.adc_bits}`}
      UNION ALL SELECT bucket_start, total_count, valid_count, value_sum, minimum, maximum, adc_bits
      FROM sensor_rollups WHERE device_id = ${device.id}::uuid AND resolution = ${resolution} AND time_basis = ${q.time_basis} AND metric = ${q.metric}
      AND bucket_start >= ${start} AND bucket_start < ${end}
      ${q.adc_bits === undefined ? Prisma.empty : Prisma.sql`AND adc_bits = ${q.adc_bits}`}`;
    const aggregate = Prisma.sql`COALESCE(SUM(total_count),0)::int AS total_count,
      COALESCE(SUM(valid_count),0)::int AS valid_count,
      COALESCE(SUM(total_count-valid_count),0)::int AS invalid_count,
      MIN(minimum) AS min, MAX(maximum) AS max,
      SUM(value_sum) / NULLIF(SUM(valid_count),0) AS average`;
    const result = await db.$transaction(
      async (tx) => {
        let usesRollups = false;
        for (const [start, end] of q.compare
          ? [
              [previousFrom, from],
              [from, to],
            ]
          : [[from, to]]) {
          const rolled = await tx.sensorRollup.count({
            where: {
              deviceId: device.id,
              resolution,
              timeBasis: q.time_basis,
              metric: q.metric,
              bucketStart: {
                gte: new Date(Math.floor(start!.getTime() / rollupInterval) * rollupInterval),
                lt: end!,
              },
            },
          });
          usesRollups ||= rolled > 0;
          if (rolled && (start!.getTime() % rollupInterval || end!.getTime() % rollupInterval))
            throw new ApiError(
              422,
              'ROLLUP_ALIGNMENT_REQUIRED',
              `Dữ liệu đã tổng hợp: chọn from/to đúng đầu ${resolution === 'minute' ? 'phút' : 'giờ'} UTC hoặc chọn bucket nhỏ hơn nếu còn dữ liệu.`,
            );
          if (q.bucket === 'minute') {
            const expiredMinutes = await tx.sensorRollup.findFirst({
              where: {
                deviceId: device.id,
                resolution: 'hour',
                timeBasis: q.time_basis,
                metric: q.metric,
                bucketStart: { gte: start!, lt: end! },
              },
              orderBy: { bucketStart: 'asc' },
            });
            if (
              expiredMinutes &&
              !(await tx.sensorRollup.findFirst({
                where: {
                  deviceId: device.id,
                  resolution: 'minute',
                  timeBasis: q.time_basis,
                  metric: q.metric,
                  bucketStart: {
                    gte: expiredMinutes.bucketStart,
                    lt: new Date(expiredMinutes.bucketStart.getTime() + 3600000),
                  },
                },
              }))
            )
              throw new ApiError(
                422,
                'ROLLUP_RESOLUTION_UNAVAILABLE',
                'Dữ liệu phút đã hết hạn. Chọn bucket giờ/ngày.',
              );
          }
        }
        const profileRows = await tx.$queryRaw<
          { profiles: number[] | null }[]
        >`SELECT ARRAY_AGG(DISTINCT profile) FILTER (WHERE profile IS NOT NULL) AS profiles FROM (${sqlBase(q.compare ? previousFrom : from, to)}) AS all_samples`;
        const profiles = (profileRows[0]?.profiles ?? []).filter((p) => p !== 0);
        if (profiles.length > 1)
          throw new ApiError(
            409,
            'INCOMPATIBLE_ADC_PROFILES',
            'Không gộp ADC khác độ phân giải. Chọn adc_bits cụ thể.',
          );
        const period = async (start: Date, end: Date) => {
          const base = sqlBase(start, end);
          const summary = await tx.$queryRaw<
            Stats[]
          >`SELECT ${aggregate} FROM (${base}) AS samples`;
          const series = await tx.$queryRaw<
            (Stats & { bucket_start: Date })[]
          >`SELECT date_trunc(${q.bucket}, t, 'UTC') AS bucket_start, ${aggregate} FROM (${base}) AS samples GROUP BY bucket_start ORDER BY bucket_start`;
          return {
            from: start.toISOString(),
            to: end.toISOString(),
            summary: summary[0]!,
            series: series.map((s) => ({ ...s, bucket_start: s.bucket_start.toISOString() })),
          };
        };
        return {
          ...(await period(from, to)),
          metric: q.metric,
          unit: metric.unit,
          time_basis: q.time_basis,
          adc_bits: profiles[0] ?? null,
          source_kind: device.sourceKind,
          uses_rollups: usesRollups,
          previous: q.compare ? await period(previousFrom, from) : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    reply(res, result);
  });
  router.get('/devices/:id/readings/export', async (req, res) => {
    const device = await requireDevice(z.uuid().parse(req.params.id));
    const q = exportQuerySchema.parse(req.query);
    try {
      await db.$transaction(
        async (tx) => {
          const where = { deviceId: device.id, ...rangeWhere(q) };
          const rollup = await tx.sensorRollup.findFirst({
            where: {
              deviceId: device.id,
              timeBasis: q.time_basis,
              resolution: 'hour',
              bucketStart: {
                gte: new Date(Math.floor(Date.parse(q.from!) / 3600000) * 3600000),
                lt: new Date(q.to!),
              },
            },
          });
          if (rollup)
            throw new ApiError(
              409,
              'RAW_DATA_RETAINED_AS_ROLLUP',
              'Khoảng này có raw đã được tổng hợp/xóa theo retention; không thể xuất CSV raw đầy đủ. Thu hẹp khoảng hoặc xem Analytics.',
            );
          const count = await tx.sensorReading.count({ where });
          if (count > 100000)
            throw new ApiError(
              413,
              'EXPORT_TOO_LARGE',
              'Tối đa 100.000 dòng CSV. Chọn khoảng thời gian ngắn hơn.',
            );
          res.type('text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="readings-${device.id}.csv"`);
          const columns = [
            'device_id',
            'device_name',
            'source_kind',
            'sampled_at_utc',
            'received_at_utc',
            'time_quality',
            'boot_id',
            'seq',
            'temperature_c',
            'humidity_pct',
            'dht11_quality',
            'dht11_age_ms',
            'mq2_adc',
            'mq2_adc_bits',
            'mq2_quality',
            'mq2_age_ms',
            'mq7_adc',
            'mq7_adc_bits',
            'mq7_quality',
            'mq7_age_ms',
            'flame_detected',
            'flame_quality',
            'config_version',
            'firmware_version',
          ];
          await write(res, '\ufeff' + columns.map(csvCell).join(',') + '\r\n');
          let cursor: bigint | undefined;
          while (!res.destroyed) {
            const rows = await tx.sensorReading.findMany({
              where: { ...where, ...(cursor === undefined ? {} : { id: { gt: cursor } }) },
              select: { id: true, receivedAt: true, payload: true },
              orderBy: { id: 'asc' },
              take: 1000,
            });
            if (!rows.length) break;
            for (const row of rows) {
              const r = row.payload as unknown as Reading;
              const s = r.sensors;
              const values = [
                device.id,
                device.name,
                device.sourceKind,
                r.sampled_at,
                row.receivedAt.toISOString(),
                r.time_quality,
                r.boot_id,
                r.seq,
                s.dht11.temperature_c,
                s.dht11.humidity_pct,
                s.dht11.quality,
                s.dht11.age_ms,
                s.mq2.adc_raw,
                s.mq2.adc_bits,
                s.mq2.quality,
                s.mq2.age_ms,
                s.mq7.adc_raw,
                s.mq7.adc_bits,
                s.mq7.quality,
                s.mq7.age_ms,
                s.flame.detected,
                s.flame.quality,
                r.config_version,
                r.firmware_version,
              ];
              await write(res, values.map(csvCell).join(',') + '\r\n');
              if (res.destroyed) break;
            }
            cursor = rows.at(-1)!.id;
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 },
      );
      res.end();
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      throw error;
    }
  });
}
