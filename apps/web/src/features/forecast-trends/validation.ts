// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import { FORECAST_CONFIG as CFG } from './config.js';
import { predictAt } from './forecasting.js';
import type { ForecastModel, Measure, MinuteReading } from './types.js';

/** Optional constraints for scoring recently completed forecast/actual pairs.
 * minTargetAt is applied to the time of the ACTUAL observation, never the origin.
 * maxPairs retains the latest fully comparable pairs in chronological order.
 */
export interface WalkForwardWindow {
  minTargetAt?: number;
  maxPairs?: number;
  multiStep?: boolean; // compare +5, +10, ... +horizon, not only the endpoint
}

export interface ValidationRow {
  model: ForecastModel;
  horizon: number;
  metric: Measure;
  pairs: number;
  skipped: number;
  mae: number | null;
  improvement: number | null;
}

/** Rolling-origin evaluation, common origin/target pairs for all three models. */
export function walkForward(
  points: readonly MinuteReading[], metric: Measure, horizon: number,
  postProcess: (value: number) => number = (value) => value,
  window?: WalkForwardWindow,
): ValidationRow[] {
  // Only measured, physically valid samples can be origins or observed targets.
  // One unique minute timestamp corresponds to one real forecast opportunity.
  const unique = new Map<number, MinuteReading>();
  for (const point of points) {
    const value = point[metric];
    if (!Number.isFinite(point.timestamp) || typeof value !== 'number' || !Number.isFinite(value) ||
      (metric === 'humidity' && (value < 0 || value > 100)) ||
      (metric === 'temperature' && (value < -40 || value > 125))) continue;
    unique.set(point.timestamp, point);
  }
  const sorted = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
  const models: ForecastModel[] = ['naive', 'linear', 'holt'];
  const completed: { targetAt: number; errors: number[] }[] = [];
  let skipped = 0;
  for (let i = CFG.regressionMinimum - 1; i < sorted.length; i++) {
    const origin = sorted[i]!;
    const steps = window?.multiStep
      ? Array.from({ length: Math.floor(horizon / 5) }, (_, index) => (index + 1) * 5)
      : [horizon];
    const targets = steps.map((step) => {
      const time = origin.timestamp + step * CFG.minuteMs;
      return sorted.filter((p) => p.timestamp > origin.timestamp &&
        Math.abs(p.timestamp - time) <= CFG.validationToleranceMinutes * CFG.minuteMs)
        .sort((a, b) => Math.abs(a.timestamp - time) - Math.abs(b.timestamp - time) || a.timestamp - b.timestamp)[0];
    });
    if (targets.some((target) => !target)) { skipped++; continue; }
    const lastTarget = targets.at(-1)!;
    if (window?.minTargetAt !== undefined && lastTarget.timestamp < window.minTargetAt) continue;
    // All models share the exact same completed origin and target minutes.
    const train = sorted.slice(0, i + 1);
    const predictions = models.map((model) => targets.map((target) =>
      predictAt(train, metric, model, origin.timestamp, target!.timestamp)));
    if (predictions.some((path) => path.some((prediction) => prediction === null))) { skipped++; continue; }
    completed.push({
      targetAt: lastTarget.timestamp,
      errors: predictions.map((path) => path.reduce<number>((total, prediction, index) =>
        total + Math.abs(postProcess(prediction!) - targets[index]![metric]!), 0) / steps.length),
    });
  }
  // The same completed origin/target pairs are used for ALL models.
  // Never let an incomplete/model-specific pair bias the ranking.
  completed.sort((a, b) => a.targetAt - b.targetAt);
  const recent = window?.maxPairs === undefined ? completed
    : window.maxPairs <= 0 ? [] : completed.slice(-window.maxPairs);
  const errors = new Map<ForecastModel, number[]>(models.map((name, index) => [
    name, recent.map((pair) => pair.errors[index]!),
  ]));
  const mae = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const baseline = mae(errors.get('naive')!);
  return models.map((model) => {
    const values = errors.get(model)!;
    const result = mae(values);
    return {
      model, horizon, metric, pairs: values.length, skipped, mae: result,
      improvement: baseline === null || baseline < 1e-9 || result === null ? null : (baseline - result) / baseline * 100,
    };
  });
}

export interface ValidationSample { timestamp: number; actual: number; prediction: number }
/** Chart-ready walk-forward predictions, using only observations before each target. */
export function validationTrace(
  points: readonly MinuteReading[], metric: Measure, model: ForecastModel, horizon: 15 | 30,
  clamp: (value: number) => number = (value) => value,
): ValidationSample[] {
  const unique = new Map<number, MinuteReading>();
  for (const point of points) {
    const value = point[metric];
    if (!Number.isFinite(point.timestamp) || typeof value !== 'number' || !Number.isFinite(value) ||
      (metric === 'humidity' && (value < 0 || value > 100)) ||
      (metric === 'temperature' && (value < -40 || value > 125))) continue;
    unique.set(point.timestamp, point);
  }
  const sorted = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
  const output: ValidationSample[] = [];
  const advanced = model === 'random_forest' || model === 'holt_winters';
  const firstOrigin = advanced ? Math.max(CFG.regressionMinimum - 1, sorted.length - 30 - horizon) : CFG.regressionMinimum - 1;
  for (let i = firstOrigin; i < sorted.length; i++) {
    const origin = sorted[i]!;
    const target = origin.timestamp + horizon * CFG.minuteMs;
    const nearest = sorted.find((p) => p.timestamp > origin.timestamp && Math.abs(p.timestamp - target) <= CFG.validationToleranceMinutes * CFG.minuteMs);
    if (!nearest) continue;
    const predicted = predictAt(sorted.slice(0, i + 1), metric, model, origin.timestamp, nearest.timestamp);
    if (predicted === null) continue;
    output.push({ timestamp: nearest.timestamp, actual: nearest[metric]!, prediction: clamp(predicted) });
  }
  return output.slice(-75);
}
