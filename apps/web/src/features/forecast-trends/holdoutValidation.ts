/** A deliberately conservative, *single-origin* holdout check.
 * The last 30 measured minutes are never provided to model fitting or selection.
 * Only observed +15/+30 minute targets can be scored (no synthetic data).
 * One target per horizon is NOT sufficient to establish predictive accuracy.
 */
import { FORECAST_CONFIG as CFG } from './config.js';
import { predictAt } from './forecasting.js';
import { selectForecastModel } from './modelSelection.js';
import type { ForecastModel, Measure, MinuteReading } from './types.js';

export interface HoldoutRow {
  metric: Measure;
  horizon: 15 | 30;
  model: ForecastModel | null;
  originAt: number | null;
  targetAt: number | null;
  pairs: 0 | 1;
  mae: number | null;
  naiveMae: number | null;
  prediction: number | null;
  actual: number | null;
  reason: string | null;
}

/** Auto selection is run on the training prefix, NEVER on the held-out targets. */
export function evaluateHoldoutForecasts(points: readonly MinuteReading[]): HoldoutRow[] {
  const valid = [...points].filter((p) => Number.isFinite(p.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const lastAt = valid.at(-1)?.timestamp ?? null;
  const cutoff = lastAt === null ? null : lastAt - 30 * CFG.minuteMs;
  return (['temperature', 'humidity'] as const).flatMap((metric) =>
    ([15, 30] as const).map((horizon): HoldoutRow => {
      const unavailable = (reason: string, originAt: number | null = null, model: ForecastModel | null = null): HoldoutRow => ({
        metric, horizon, model, originAt, targetAt: originAt === null ? null : originAt + horizon * CFG.minuteMs,
        pairs: 0, mae: null, naiveMae: null, prediction: null, actual: null, reason,
      });
      if (cutoff === null) return unavailable('Chưa có chuỗi đo để giữ lại 30 phút kiểm thử.');
      const train = valid.filter((p) => p.timestamp <= cutoff);
      const origin = train.at(-1);
      if (!origin || origin.timestamp !== cutoff ||
          typeof origin[metric] !== 'number' || !Number.isFinite(origin[metric]) ||
          train.filter((p) => typeof p[metric] === 'number' && Number.isFinite(p[metric])).length < CFG.regressionMinimum) {
        return unavailable('Thiếu mẫu hợp lệ ở mốc chia tập hoặc dữ liệu huấn luyện quá ngắn.');
      }
      // Select on training only; changing observations after cutoff cannot affect this choice.
      const selected = selectForecastModel(train, metric, horizon, cutoff, cutoff);
      const targetAt = cutoff + horizon * CFG.minuteMs;
      const actual = valid.find((p) => p.timestamp === targetAt)?.[metric];
      if (typeof actual !== 'number' || !Number.isFinite(actual)) {
        return unavailable(`Không có số đo thật tại mốc +${horizon} phút của tập kiểm thử.`, cutoff, selected.model);
      }
      const predicted = predictAt(train, metric, selected.model, cutoff, targetAt);
      const naive = predictAt(train, metric, 'naive', cutoff, targetAt);
      if (predicted === null || naive === null || !Number.isFinite(predicted) || !Number.isFinite(naive)) {
        return unavailable('Mô hình không đủ điều kiện dự báo trên tập huấn luyện.', cutoff, selected.model);
      }
      return { metric, horizon, model: selected.model, originAt: cutoff, targetAt,
        pairs: 1, mae: Math.abs(predicted - actual), naiveMae: Math.abs(naive - actual),
        prediction: predicted, actual, reason: null };
    }),
  );
}
