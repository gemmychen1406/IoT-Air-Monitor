import { FORECAST_CONFIG as CFG } from './config.js';
import type { Measure, MeasureForecast, MinuteReading } from './types.js';
import type { ValidationSample } from './validation.js';

export interface CombinedValidationPoint {
  timestamp: number;
  actual: number | null;
  prediction: number | null;
  future: number | null;
}

/** A chart overlay only: historical validation always stays on the measured
 * side of the current reading, while future values are forecasts only.
 * Null observations and missing minute buckets are never interpolated.
 */
export function combineValidationAndFuture(
  history: readonly MinuteReading[], trace: readonly ValidationSample[],
  metric: Measure, forecast: MeasureForecast,
): { data: CombinedValidationPoint[]; origin: number | null } {
  const isFuture = forecast.status === 'eligible' && forecast.current !== null &&
    forecast.lastSampleAt !== null && Number.isFinite(forecast.lastSampleAt) &&
    forecast.points.some((point) => point.timestamp > forecast.lastSampleAt! && Number.isFinite(point.value));
  const latestHistoricalTime = history.reduce((max, point) => Number.isFinite(point.timestamp) ? Math.max(max, point.timestamp) : max, -Infinity);
  const origin = isFuture ? forecast.lastSampleAt! : null;
  const endOfHistory = origin ?? (Number.isFinite(latestHistoricalTime) ? latestHistoricalTime : null);
  if (endOfHistory === null) return { data: [], origin: null };

  const startOfHistory = endOfHistory - 30 * CFG.minuteMs;
  const entries = new Map<number, CombinedValidationPoint>();
  const row = (timestamp: number): CombinedValidationPoint => {
    const previous = entries.get(timestamp);
    if (previous) return previous;
    const created: CombinedValidationPoint = { timestamp, actual: null, prediction: null, future: null };
    entries.set(timestamp, created);
    return created;
  };
  let previous: number | null = null;
  const measured = history.filter((point) => Number.isFinite(point.timestamp) &&
    point.timestamp >= startOfHistory && point.timestamp <= endOfHistory)
    .slice().sort((a, b) => a.timestamp - b.timestamp);
  for (const point of measured) {
    if (previous !== null && point.timestamp - previous > CFG.minuteMs * 1.5) {
      row(previous + CFG.minuteMs); // explicit break for missing time buckets
    }
    const value = point[metric];
    row(point.timestamp).actual = typeof value === 'number' && Number.isFinite(value) ? value : null;
    previous = point.timestamp;
  }
  for (const sample of trace) {
    if (!Number.isFinite(sample.timestamp) || sample.timestamp < startOfHistory ||
      sample.timestamp > endOfHistory || !Number.isFinite(sample.prediction)) continue;
    row(sample.timestamp).prediction = sample.prediction;
  }
  if (origin !== null) {
    const anchor = row(origin);
    anchor.actual = forecast.current;
    anchor.future = forecast.current;
    for (const item of forecast.points) {
      if (!Number.isFinite(item.timestamp) || !Number.isFinite(item.value) || item.timestamp <= origin) continue;
      row(item.timestamp).future = item.value;
    }
  }
  return { data: [...entries.values()].sort((a, b) => a.timestamp - b.timestamp), origin };
}
