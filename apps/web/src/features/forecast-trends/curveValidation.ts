/** Multi-step rolling-origin comparison. No observations after origin go into training. */
import { FORECAST_CONFIG as CFG } from './config.js';
import { advancedForecast, type AdvancedForecastModel } from './advancedForecast.js';
import { predictAt } from './forecasting.js';
import type { Measure, MinuteReading } from './types.js';

export interface CurveScore {
  model: AdvancedForecastModel;
  horizon: 15 | 30;
  metric: Measure;
  pairs: number; // distinct forecast origins; their target windows may overlap
  mae: number | null;
  comparisonMae: number | null; // lowest traditional MAE on exactly the same origins
  comparisonModel: 'naive' | 'linear' | 'holt' | null;
  steps: number;
}

export function compareAdvancedCurves(
  points: readonly MinuteReading[], metric: Measure, horizon: 15 | 30,
  model: AdvancedForecastModel, maxOrigins = 20, targetWindowMinutes?: number,
): CurveScore {
  const empty: CurveScore = { model, metric, horizon, pairs: 0, mae: null,
    comparisonMae: null, comparisonModel: null, steps: horizon / 5 };
  const valid = points.filter((p) => p[metric] !== null).sort((a, b) => a.timestamp - b.timestamp);
  if (valid.length < CFG.forestMinTrainingRows + 20 + horizon) return empty;
  const latest = valid.at(-1)!.timestamp;
  const stepMinutes = Array.from({ length: horizon / 5 }, (_, i) => (i + 1) * 5);
  const models = ['naive', 'linear', 'holt'] as const;
  const candidate: { advanced: number; basic: number[] }[] = [];
  // Target must already have been measured. No backtest predictions from the future.
  for (let i = valid.length - 1; i >= 0 && candidate.length < maxOrigins; i--) {
    const origin = valid[i]!;
    if (origin.timestamp + horizon * CFG.minuteMs > latest) continue;
    if (targetWindowMinutes !== undefined && origin.timestamp + horizon * CFG.minuteMs < latest - targetWindowMinutes * CFG.minuteMs) break;
    const targets = stepMinutes.map((minute) => valid.find((p) => p.timestamp === origin.timestamp + minute * CFG.minuteMs));
    if (targets.some((point) => !point)) continue;
    const past = valid.slice(0, i + 1);
    const path = advancedForecast(past, metric, model, origin.timestamp, horizon);
    if (!path) continue;
    const error = stepMinutes.reduce((sum, minute, index) => sum + Math.abs(path[minute - 1]! - targets[index]![metric]!), 0) / stepMinutes.length;
    const basic = models.map((name) => {
      let sum = 0;
      for (let j = 0; j < stepMinutes.length; j++) {
        const at = origin.timestamp + stepMinutes[j]! * CFG.minuteMs;
        const predicted = predictAt(past, metric, name, origin.timestamp, at);
        if (predicted === null) return null;
        sum += Math.abs(predicted - targets[j]![metric]!);
      }
      return sum / stepMinutes.length;
    });
    if (basic.some((v) => v === null)) continue;
    candidate.push({ advanced: error, basic: basic as number[] });
  }
  if (!candidate.length) return empty;
  const avg = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const traditional = models.map((name, index) => ({ model: name, mae: avg(candidate.map((row) => row.basic[index]!)) }))
    .sort((a, b) => a.mae - b.mae)[0]!;
  return {
    ...empty, pairs: candidate.length, mae: avg(candidate.map((row) => row.advanced)),
    comparisonMae: traditional.mae, comparisonModel: traditional.model,
  };
}
