import type { AnalyticsPeriod } from '@iot/contracts';

export function plotSeries(period: AnalyticsPeriod, bucket: 'minute' | 'hour' | 'day') {
  const interval = { minute: 60000, hour: 3600000, day: 86400000 }[bucket];
  const existing = new Map(period.series.map((p) => [Date.parse(p.bucket_start), p]));
  const points: { time: string; average: number | null; min: number | null; max: number | null }[] =
    [];
  for (
    let at = Math.floor(Date.parse(period.from) / interval) * interval;
    at < Date.parse(period.to) && points.length < 2000;
    at += interval
  ) {
    const p = existing.get(at);
    points.push({
      time: new Date(at).toLocaleString('vi-VN'),
      average: p?.average ?? null,
      min: p?.min ?? null,
      max: p?.max ?? null,
    });
  }
  return points;
}
