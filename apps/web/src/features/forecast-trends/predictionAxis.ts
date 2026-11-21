// Truc Y du bao duoc lay tu so do va du bao, khong ep bat dau tu 0.
import type { Measure } from './types.js';

export interface PredictionAxisValue { actual: number | null; predicted: number | null }

export function predictionYAxisDomain(
  data: readonly PredictionAxisValue[], metric: Measure,
): [number, number] {
  const values = data.flatMap((row) => [row.actual, row.predicted])
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return metric === 'humidity' ? [0, 100] : [0, 40];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const padding = Math.max(metric === 'temperature' ? 1.5 : 5, (hi - lo) * 0.2);
  const lower = metric === 'humidity' ? Math.max(0, lo - padding) : lo - padding;
  const upper = metric === 'humidity' ? Math.min(100, hi + padding) : hi + padding;
  return [Math.floor(lower * 10) / 10, Math.ceil(upper * 10) / 10];
}
