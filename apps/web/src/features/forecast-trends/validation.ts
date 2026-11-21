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
  const sorted = [...points].filter((point) => point[metric] !== null).sort((a, b) => a.timestamp - b.timestamp);
  const models: ForecastModel[] = ['naive', 'linear', 'holt'];
  const completed: { targetAt: number; errors: number[] }[] = [];
  let skipped = 0;
  for (let i = CFG.regressionMinimum - 1; i < sorted.length; i++) {
    const origin = sorted[i]!;
    const expectedTime = origin.timestamp + horizon * CFG.minuteMs;
    const nearest = sorted.filter((p) => p.timestamp > origin.timestamp && Math.abs(p.timestamp - expectedTime) <= CFG.validationToleranceMinutes * CFG.minuteMs)
      .sort((a, b) => Math.abs(a.timestamp - expectedTime) - Math.abs(b.timestamp - expectedTime) || a.timestamp - b.timestamp)[0];
    if (!nearest) { skipped++; continue; }
    if (window?.minTargetAt !== undefined && nearest.timestamp < window.minTargetAt) continue;
    // No readings after origin are included in training.
    const train = sorted.slice(0, i + 1);
    const predictions = models.map((model) => predictAt(train, metric, model, origin.timestamp, nearest.timestamp));
    if (predictions.some((prediction) => prediction === null)) { skipped++; continue; }
    completed.push({
      targetAt: nearest.timestamp,
      errors: predictions.map((prediction) => Math.abs(postProcess(prediction!) - nearest[metric]!)),
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
  const sorted = [...points].filter((p) => p[metric] !== null).sort((a, b) => a.timestamp - b.timestamp);
  const output: ValidationSample[] = [];
  for (let i = CFG.regressionMinimum - 1; i < sorted.length; i++) {
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
