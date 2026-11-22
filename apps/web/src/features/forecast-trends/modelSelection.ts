// Chọn mô hình riêng cho từng chỉ số và từng mốc 15/30 phút.
// Giữ các mô hình cơ sở để đối chứng; chỉ chọn mô hình nâng cao khi kiểm chứng tốt hơn.
import { FORECAST_CONFIG as CFG } from './config.js';
import { evaluateDhtMetricStatus } from './dhtAdvisory.js';
import type { DhtAssessmentStatus } from './dhtAdvisory.js';
import { walkForward, type ValidationRow } from './validation.js';
import { compareAdvancedCurves, commonOriginMaes, type CurveScore } from './curveValidation.js';
import type { ForecastModel, Measure, MinuteReading } from './types.js';

export type ForecastSelection = 'auto' | ForecastModel;
export type SelectionBasis = 'recent_mae' | 'mae' | 'fallback' | 'manual' | 'stale' | 'insufficient';

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
  naive: 'Naive', linear: 'Linear', holt: 'Holt',
  random_forest: 'Random Forest', holt_winters: 'Holt-Winters',
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
export function chooseByMae(rows: readonly ValidationRow[], metric: Measure, minimumPairs: number = CFG.validationMinimumPairs): ValidationRow | null {
  const ordered = SIMPLE_FIRST.map((model) => rows.find((row) => row.model === model));
  if (ordered.some((row) => !row || row.metric !== metric || row.mae === null ||
    !Number.isFinite(row.mae) || row.pairs < minimumPairs)) return null;
  const complete = ordered as ValidationRow[];
  if (new Set(complete.map((row) => `${row.horizon}:${row.pairs}`)).size !== 1) return null;
  const bestMae = Math.min(...complete.map((row) => row.mae!));
  // Subtract tiny numerical tolerance to make exactly-the-threshold a real gain.
  return complete.find((row) => row.mae! - bestMae < minGain[metric] - 1e-10) ??
    complete.reduce((best, row) => row.mae! < best.mae! ? row : best);
}

/** For a complete multi-step score, select the actual lowest MAE; stable ordering
 * breaks only exact numerical ties. This is intentionally stricter than the
 * legacy endpoint-only simplicity threshold.
 */
function chooseBestMultiMae(rows: readonly ValidationRow[], metric: Measure, minimumPairs: number): ValidationRow | null {
  const complete = SIMPLE_FIRST.map((name) => rows.find((row) => row.model === name));
  if (complete.some((row) => !row || row.metric !== metric || row.mae === null ||
    !Number.isFinite(row.mae) || row.pairs < minimumPairs)) return null;
  const valid = complete as ValidationRow[];
  if (new Set(valid.map((row) => `${row.horizon}:${row.pairs}`)).size !== 1) return null;
  return valid.reduce((best, row) => row.mae! < best.mae! - 1e-10 ? row : best);
}

/** A tie-break can pick a *slightly* higher MAE, so do not claim it is the minimum. */
export function describeMaeChoice(
  picked: ValidationRow, rows: readonly ValidationRow[], metric: Measure, horizon: 15 | 30,
): string {
  const minObserved = Math.min(...rows.filter((row) => row.mae !== null).map((row) => row.mae!));
  const detail = picked.mae! <= minObserved + 1e-9
    ? 'có MAE thấp nhất'
    : 'có MAE gần mức thấp nhất';
  return `Chọn ${MODEL_LABELS[picked.model]} vì ${detail}: ${pretty(picked.mae!, metric)} (đối chiếu ${picked.pairs} mốc +${horizon} phút).`;
}

/**
 * Never trains on future readings. walkForward builds train/test windows whose
 * observation at the target time is excluded from the input for that origin.
 */
export function selectForecastModel(
  points: readonly MinuteReading[], metric: Measure, horizon: 15 | 30,
  nowMs: number, latestSampleAt?: number | null, preference: ForecastSelection = 'auto',
  advancedScores?: Partial<Record<'random_forest' | 'holt_winters', CurveScore>> | null,
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

  // Advanced models share the same per-origin cache. Compare advanced candidates
  // only on the INTERSECTION of origins both can forecast (same real targets).
  // Each advanced model is compared against the best baseline on those same origins.
  const advancedNames = ['random_forest', 'holt_winters'] as const;
  const full = Object.fromEntries(advancedNames.map((name) => [name,
    advancedScores === undefined ? compareAdvancedCurves(points, metric, horizon, name) : advancedScores?.[name],
  ])) as Record<(typeof advancedNames)[number], CurveScore | undefined>;
  const allReady = advancedNames.every((name) => full[name] && full[name]!.pendingOrigins === 0);
  if (allReady) {
    const recent = Object.fromEntries(advancedNames.map((name) => [name,
      compareAdvancedCurves(points, metric, horizon, name, undefined, 20, 0),
    ])) as Record<(typeof advancedNames)[number], CurveScore>;
    const recentCommon = commonOriginMaes(recent.random_forest, recent.holt_winters);
    const fullCommon = commonOriginMaes(full.random_forest, full.holt_winters);
    const shared = recentCommon && recentCommon.pairs >= 8
      ? { result: recentCommon, basis: 'recent_mae' as const }
      : fullCommon && fullCommon.pairs >= 20
        ? { result: fullCommon, basis: 'mae' as const } : null;
    if (shared) {
      const { result, basis } = shared;
      const bestBase = (['naive', 'linear', 'holt'] as const)
        .reduce((best, name) => result.mae[name] < result.mae[best] ? name : best, 'naive' as 'naive' | 'linear' | 'holt');
      const winner = advancedNames.reduce((best, name) =>
        result.mae[name] < result.mae[best] ? name : best);
      const gain = result.mae[bestBase] - result.mae[winner];
      const absoluteGain = minGain[metric];
      if (gain >= absoluteGain && result.mae[bestBase] > 0 && gain / result.mae[bestBase] >= 0.08) {
        return { ...base, model: winner, basis, pairs: result.pairs, mae: result.mae[winner],
          explanation: `Chọn ${MODEL_LABELS[winner]}: MAE đa mốc ${pretty(result.mae[winner], metric)} trên ${result.pairs} mốc chung (+5 đến +${horizon} phút), tốt hơn ${MODEL_LABELS[bestBase]} và mô hình nâng cao còn lại trên đúng tập đó.`,
        };
      }
    } else {
      // No reliable cross-model intersection yet. A single eligible advanced
      // candidate can still beat baselines on ITS OWN matched origins; two
      // ineligible-to-compare advanced models must never be ranked by raw MAE.
      const qualified = advancedNames.flatMap((name) => {
        const value = full[name]!;
        if (value.pairs < 20 || value.mae === null || value.comparisonMae === null ||
            value.comparisonModel === null || value.comparisonMae <= 0) return [];
        const gain = value.comparisonMae - value.mae;
        return gain >= minGain[metric] && gain / value.comparisonMae >= 0.08
          ? [{ name, value }] : [];
      });
      if (qualified.length === 1) {
        const { name, value } = qualified[0]!;
        return { ...base, model: name, basis: 'mae', pairs: value.pairs, mae: value.mae,
          explanation: `Chọn ${MODEL_LABELS[name]}: MAE ${pretty(value.mae!, metric)} trên ${value.pairs} mốc hợp lệ, tốt hơn ${MODEL_LABELS[value.comparisonModel!]} tại chính các mốc này; chưa đủ mốc chung để so với mô hình nâng cao còn lại.`,
        };
      }
    }
  }

  const postProcess = metric === 'humidity' ? clampHumidity : undefined;
  // A completed recent pair must have an observed target reading in the last
  // 20 minutes. A long data gap must NOT make weeks-old pairs look recent.
  // Require 6 common pairs, cap to 20 most recently completed comparisons.
  const recentRows = walkForward(points, metric, horizon, postProcess, {
    minTargetAt: actualLastAt - 20 * CFG.minuteMs,
    maxPairs: 20,
    multiStep: true,
  });
  const recentBest = chooseBestMultiMae(recentRows, metric, 6);
  if (recentBest !== null) return {
    ...base, model: recentBest.model, basis: 'recent_mae', pairs: recentBest.pairs, mae: recentBest.mae,
    explanation: `MAE đa mốc (+5 đến +${horizon} phút). ` + describeMaeChoice(recentBest, recentRows, metric, horizon).replace(
      `mốc +${horizon} phút`, `mốc gần nhất ở khoảng +${horizon} phút`,
    ),
  };

  const rows = walkForward(points, metric, horizon, postProcess, { multiStep: true });
  const pairs = Math.min(...rows.map((row) => row.pairs));
  const best = chooseBestMultiMae(rows, metric, CFG.validationMinimumPairs);
  if (best !== null) return {
    ...base, model: best.model, basis: 'mae', pairs: best.pairs, mae: best.mae,
    explanation: `MAE đa mốc (+5 đến +${horizon} phút). ` + describeMaeChoice(best, rows, metric, horizon),
  };

  const fallback: ForecastModel = status === 'watch' ? 'holt' : 'naive';
  return {
    ...base, model: fallback, basis: 'fallback', pairs: Number.isFinite(pairs) ? pairs : 0, mae: null,
    explanation: `Chọn ${MODEL_LABELS[fallback]} theo trạng thái ${status === 'watch' ? 'biến động liên tục' : status === 'normal' ? 'ổn định' : 'chưa đủ dữ liệu để kết luận'} hiện tại (chưa đủ mốc đối chiếu).`,
  };
}
