/**
 * Independent chronological holdout for the Auto MODEL CHOICE at the split point.
 *
 * The selector sees only the first 70% of the observed history. Its chosen model
 * is then FROZEN for evaluation in the final 30%; at every test origin only
 * measurements already observed by that origin are passed to the forecaster.
 * This deliberately tests an out-of-sample choice, NOT the continuously
 * readjusted Auto model displayed by the live UI.
 */
import { FORECAST_CONFIG as CFG } from './config.js';
import { predictAt } from './forecasting.js';
import { selectForecastModel, type ModelSelectionResult } from './modelSelection.js';
import type { ForecastModel, Measure, MinuteReading } from './types.js';

export const HOLDOUT_MODELS = ['naive', 'linear', 'holt', 'random_forest', 'holt_winters'] as const;
export type HoldoutModel = (typeof HOLDOUT_MODELS)[number];
export type HoldoutHorizon = 15 | 30;

export interface HoldoutModelScore {
  model: HoldoutModel;
  mae: number | null;
  pairs: number;
}

export interface AutoHoldoutResult {
  metric: Measure;
  horizon: HoldoutHorizon;
  trainEndAt: number | null;
  testStartAt: number | null;
  trainCount: number;
  selected: ForecastModel | null;
  selectionBasis: ModelSelectionResult['basis'] | null;
  autoMae: number | null;
  autoPairs: number;
  naiveMae: number | null;
  naivePairs: number;
  comparisons: HoldoutModelScore[];
  skipped: number;
  status: 'evaluated' | 'insufficient';
  message: string;
}

function valid(point: MinuteReading, metric: Measure): boolean {
  const value = point[metric];
  return typeof value === 'number' && Number.isFinite(value) &&
    (metric === 'temperature' ? value >= -40 && value <= 125 : value >= 0 && value <= 100);
}

/** Timestamp de-duplication; do not invent/interpolate missing minute observations. */
export function normalizedHoldoutHistory(history: readonly MinuteReading[]): MinuteReading[] {
  const byTime = new Map<number, MinuteReading>();
  for (const point of history) {
    if (!Number.isFinite(point.timestamp) ||
      !Number.isInteger(point.timestamp / CFG.minuteMs)) continue;
    if (!valid(point, 'temperature') && !valid(point, 'humidity')) continue;
    byTime.set(point.timestamp, point);
  }
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export interface HoldoutSplit {
  train: MinuteReading[];
  test: MinuteReading[];
  trainEndAt: number;
  testStartAt: number;
}

/** Split by chronology, never randomize. One time bucket belongs to one side. */
export function chronologicalHoldout(history: readonly MinuteReading[], ratio = 0.7): HoldoutSplit | null {
  const sorted = normalizedHoldoutHistory(history);
  const cutoff = Math.floor(sorted.length * ratio);
  // 100 actual minute readings are needed to give advanced models a fair chance
  // to train and leave at least one +30 minute endpoint in the held-out window.
  if (cutoff < 100 || sorted.length - cutoff < 31) return null;
  return {
    train: sorted.slice(0, cutoff), test: sorted.slice(cutoff),
    trainEndAt: sorted[cutoff - 1]!.timestamp, testStartAt: sorted[cutoff]!.timestamp,
  };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function spacedIndices(indices: readonly number[], maxCount: number): number[] {
  if (indices.length <= maxCount) return [...indices];
  if (maxCount <= 1) return [indices[0]!];
  return Array.from({ length: maxCount }, (_, i) => indices[Math.round(i * (indices.length - 1) / (maxCount - 1))]!);
}

/**
 * Score one metric/horizon. All comparable predictions use the SAME observed
 * origin/target timestamps. Each fixed model can have fewer eligible pairs;
 * its count is therefore displayed alongside its own MAE.
 *
 * maxOrigins is a UI performance budget, not a fabricated sample count.
 */
export function evaluateAutoHoldout(
  history: readonly MinuteReading[], metric: Measure, horizon: HoldoutHorizon, maxOrigins = 12,
): AutoHoldoutResult {
  const split = chronologicalHoldout(history);
  const empty: AutoHoldoutResult = {
    metric, horizon, trainEndAt: split?.trainEndAt ?? null,
    testStartAt: split?.testStartAt ?? null, trainCount: split?.train.length ?? 0,
    selected: null, selectionBasis: null,
    autoMae: null, autoPairs: 0, naiveMae: null, naivePairs: 0,
    comparisons: HOLDOUT_MODELS.map((model) => ({ model, mae: null, pairs: 0 })),
    skipped: 0, status: 'insufficient',
    message: 'Chưa đủ lịch sử hợp lệ để tách 70% ban đầu và 30% kiểm thử (+30 phút).',
  };
  if (!split || maxOrigins < 1) return empty;
  const historySorted = [...split.train, ...split.test];
  const measured = new Map(historySorted.map((point) => [point.timestamp, point]));
  const lastAt = historySorted.at(-1)!.timestamp;
  const cutoffIndex = split.train.length - 1;
  const candidates: number[] = [];
  for (let index = cutoffIndex; index < historySorted.length; index++) {
    const origin = historySorted[index]!;
    const targetAt = origin.timestamp + horizon * CFG.minuteMs;
    if (targetAt > lastAt || !valid(origin, metric)) continue;
    const target = measured.get(targetAt);
    if (!target || !valid(target, metric) || target.timestamp < split.testStartAt) continue;
    candidates.push(index);
  }
  if (!candidates.length) return {
    ...empty, message: `Không có cặp số đo thực tế hợp lệ ở đúng mốc +${horizon} phút trong đoạn kiểm thử.`,
  };

  // Choose ONLY from the training portion. Never pass held-out values to Auto.
  const chosen = selectForecastModel(split.train, metric, horizon,
    split.trainEndAt, split.trainEndAt, 'auto');
  const errors = new Map<HoldoutModel, number[]>(HOLDOUT_MODELS.map((model) => [model, []]));
  const autoErrors: number[] = [];
  let skipped = 0;
  for (const index of spacedIndices(candidates, maxOrigins)) {
    const origin = historySorted[index]!;
    const targetAt = origin.timestamp + horizon * CFG.minuteMs;
    const actual = measured.get(targetAt)![metric]!;
    const past = historySorted.slice(0, index + 1); // strictly no future samples
    const predicted = new Map<HoldoutModel, number | null>();
    for (const name of HOLDOUT_MODELS) {
      const value = predictAt(past, metric, name, origin.timestamp, targetAt);
      predicted.set(name, value !== null && Number.isFinite(value) ? value : null);
    }
    const auto = predicted.get(chosen.model);
    const naive = predicted.get('naive');
    if (auto === null || auto === undefined || naive === null || naive === undefined) {
      skipped++;
      continue;
    }
    autoErrors.push(Math.abs(auto - actual));
    for (const name of HOLDOUT_MODELS) {
      const value = predicted.get(name);
      if (value !== null && value !== undefined) errors.get(name)!.push(Math.abs(value - actual));
    }
  }
  const baseline = errors.get('naive')!;
  const evaluated = autoErrors.length >= 3;
  return {
    ...empty, selected: chosen.model, selectionBasis: chosen.basis,
    autoMae: mean(autoErrors), autoPairs: autoErrors.length,
    naiveMae: mean(baseline), naivePairs: baseline.length,
    comparisons: HOLDOUT_MODELS.map((model) => ({
      model, mae: mean(errors.get(model)!), pairs: errors.get(model)!.length,
    })),
    skipped, status: evaluated ? 'evaluated' : 'insufficient',
    message: evaluated
      ? autoErrors.length < 8
        ? 'Kết quả sơ bộ: số mốc kiểm thử còn ít, cần thêm dữ liệu mới.'
        : 'Đã đánh giá trên dữ liệu giữ lại theo thời gian; đây không phải cam kết độ chính xác tương lai.'
      : `Mới có ${autoErrors.length} cặp kiểm thử hợp lệ; cần tối thiểu 3 cặp để hiển thị đánh giá sơ bộ.`,
  };
}
