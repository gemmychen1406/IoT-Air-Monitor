// Chọn mô hình riêng cho từng chỉ số và từng mốc 15/30 phút.
// Không thay đổi ForecastModel hoặc thuật toán dự báo gốc.
import { FORECAST_CONFIG as CFG } from './config.js';
import { evaluateDhtMetricStatus } from './dhtAdvisory.js';
import type { DhtAssessmentStatus } from './dhtAdvisory.js';
import { walkForward, type ValidationRow } from './validation.js';
import type { ForecastModel, Measure, MinuteReading } from './types.js';

export type ForecastSelection = 'auto' | ForecastModel;
export type SelectionBasis = 'mae' | 'fallback' | 'manual' | 'stale' | 'insufficient';

export interface ModelSelectionResult {
  model: ForecastModel;
  basis: SelectionBasis;
  metric: Measure;
  horizon: 15 | 30;
  pairs: number;
  mae: number | null;
  metricStatus: DhtAssessmentStatus;
  explanation: string;
}

export const MODEL_LABELS: Record<ForecastModel, string> = {
  naive: 'Naive', linear: 'Hồi quy tuyến tính', holt: 'Holt',
};
const SIMPLE_FIRST: readonly ForecastModel[] = ['naive', 'linear', 'holt'];
const minGain: Record<Measure, number> = { temperature: 0.05, humidity: 0.2 };
const clampHumidity = (value: number) => Math.max(0, Math.min(100, value));
const pretty = (value: number, metric: Measure) =>
  `${value.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${metric === 'temperature' ? '°C' : '%RH'}`;

/**
 * Choose the simplest model whose MAE is less than the significance threshold
 * above the minimum observed MAE. At exactly the threshold, prefer the model
 * with lower MAE. All three results must come from the same walk-forward pairs.
 */
export function chooseByMae(rows: readonly ValidationRow[], metric: Measure): ValidationRow | null {
  const ordered = SIMPLE_FIRST.map((model) => rows.find((row) => row.model === model));
  if (ordered.some((row) => !row || row.metric !== metric || row.mae === null ||
    !Number.isFinite(row.mae) || row.pairs < CFG.validationMinimumPairs)) return null;
  const complete = ordered as ValidationRow[];
  if (new Set(complete.map((row) => `${row.horizon}:${row.pairs}`)).size !== 1) return null;
  const bestMae = Math.min(...complete.map((row) => row.mae!));
  // Subtract tiny numerical tolerance to make exactly-the-threshold a real gain.
  return complete.find((row) => row.mae! - bestMae < minGain[metric] - 1e-10) ??
    complete.reduce((best, row) => row.mae! < best.mae! ? row : best);
}

/**
 * Never trains on future readings. walkForward builds train/test windows whose
 * observation at the target time is excluded from the input for that origin.
 */
export function selectForecastModel(
  points: readonly MinuteReading[], metric: Measure, horizon: 15 | 30,
  nowMs: number, latestSampleAt?: number | null, preference: ForecastSelection = 'auto',
): ModelSelectionResult {
  const status = evaluateDhtMetricStatus(points, metric, nowMs, latestSampleAt);
  const lastValid = [...points].reverse().find((point) => point[metric] !== null && Number.isFinite(point[metric]));
  const actualLastAt = latestSampleAt ?? lastValid?.timestamp ?? null;
  const base = { metric, horizon, metricStatus: status };
  if (actualLastAt === null) return {
    ...base, model: preference === 'auto' ? 'naive' : preference, basis: 'insufficient', pairs: 0, mae: null,
    explanation: 'Chưa có mẫu hợp lệ để thực hiện dự báo.',
  };
  if (nowMs - actualLastAt > CFG.staleAfterMs) return {
    ...base, model: preference === 'auto' ? 'naive' : preference, basis: 'stale', pairs: 0, mae: null,
    explanation: 'Dữ liệu cũ hơn 5 phút; tạm khóa dự báo thời gian thực.',
  };
  if (preference !== 'auto') return {
    ...base, model: preference, basis: 'manual', pairs: 0, mae: null,
    explanation: `Bạn đang chọn ${MODEL_LABELS[preference]} thủ công.`,
  };

  const rows = walkForward(points, metric, horizon, metric === 'humidity' ? clampHumidity : undefined);
  const pairs = Math.min(...rows.map((row) => row.pairs));
  const best = chooseByMae(rows, metric);
  if (best !== null) return {
    ...base, model: best.model, basis: 'mae', pairs: best.pairs, mae: best.mae,
    explanation: `Tự chọn ${MODEL_LABELS[best.model]} theo sai số MAE lịch sử ${pretty(best.mae!, metric)} qua ${best.pairs} mốc đối chiếu ở khoảng +${horizon} phút. Khi sai số gần nhau, ưu tiên mô hình đơn giản hơn.`,
  };

  const fallback: ForecastModel = status === 'watch' ? 'holt' : 'naive';
  return {
    ...base, model: fallback, basis: 'fallback', pairs: Number.isFinite(pairs) ? pairs : 0, mae: null,
    explanation: `Tự chọn ${MODEL_LABELS[fallback]} theo quy tắc dự phòng: chưa đủ ${CFG.validationMinimumPairs} mốc đối chiếu (${Number.isFinite(pairs) ? pairs : 0}/${CFG.validationMinimumPairs}); ${status === 'watch' ? 'chỉ số đang biến động liên tục vượt ngưỡng.' : status === 'normal' ? 'chỉ số chưa có biến động liên tục vượt ngưỡng.' : 'chưa đủ mẫu liên tục để đánh giá biến động.'}`,
  };
}
