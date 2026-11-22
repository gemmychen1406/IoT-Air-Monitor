/** Multi-step rolling-origin comparisons. Each fitted model only receives readings <= origin. */
import { FORECAST_CONFIG as CFG } from './config.js';
import { advancedForecast, type AdvancedForecastModel } from './advancedForecast.js';
import { predictAt } from './forecasting.js';
import type { Measure, MinuteReading } from './types.js';

export interface CurveScore {
  model: AdvancedForecastModel;
  horizon: 15 | 30;
  metric: Measure;
  pairs: number; // actual scored origins; 5-minute target windows can overlap
  mae: number | null;
  comparisonMae: number | null; // best baseline on EXACTLY the same scored origins
  comparisonModel: 'naive' | 'linear' | 'holt' | null;
  steps: number;
  eligibleOrigins: number; // origins with measured targets; model may still be ineligible
  evaluatedOrigins: number; // eligible origins already checked (including rejected ones)
  pendingOrigins: number; // not yet evaluated, never treated as failed predictions
}

type OriginScore = { advanced: number; basic: readonly [number, number, number] } | null;
const cache = new Map<string, OriginScore>();
const CACHE_LIMIT = 8000; // bounded across navigation, devices, and horizon changes
let computations = 0;
const baselines = ['naive', 'linear', 'holt'] as const;

/** Primarily for deterministic cache tests. No persistent or fabricated results. */
export function resetCurveValidationCache(): void { cache.clear(); computations = 0; }
export function curveValidationCacheStats(): { entries: number; computations: number } {
  return { entries: cache.size, computations };
}

// Two incremental non-cryptographic checksums track actual training values at/before each origin.
// Appended samples leave old prefix signatures unchanged; edited historic samples invalidate them.
function hashText(seed: number, input: string, factor: number): number {
  let value = seed;
  for (let i = 0; i < input.length; i++) value = Math.imul(value ^ input.charCodeAt(i), factor) >>> 0;
  return value;
}
function cacheRead(key: string): { found: boolean; value: OriginScore } {
  if (!cache.has(key)) return { found: false, value: null };
  const value = cache.get(key)!;
  cache.delete(key); cache.set(key, value); // bounded LRU, also caches rejected origins
  return { found: true, value };
}
function cacheWrite(key: string, value: OriginScore): void {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/**
 * With maxNewOrigins = Infinity (default) this scores ALL eligible origins.
 * The UI calls with a small maxNewOrigins and repeats on later idle turns:
 * previously scored origins are read from cache, never retrained unnecessarily.
 * maxOrigins/targetWindowMinutes are optional backward-compatible filters.
 */
export function compareAdvancedCurves(
  points: readonly MinuteReading[], metric: Measure, horizon: 15 | 30,
  model: AdvancedForecastModel, maxOrigins = Infinity, targetWindowMinutes?: number,
  maxNewOrigins = Infinity,
): CurveScore {
  const empty: CurveScore = { model, metric, horizon, pairs: 0, mae: null,
    comparisonMae: null, comparisonModel: null, steps: horizon / 5,
    eligibleOrigins: 0, evaluatedOrigins: 0, pendingOrigins: 0 };
  // All time indexes represent observed minute buckets, not interpolated data.
  const valid = points.filter((p) => Number.isFinite(p.timestamp) &&
    p[metric] !== null && Number.isFinite(p[metric]))
    .sort((a, b) => a.timestamp - b.timestamp);
  // Duplicated timestamps must not become duplicate forecast origins.
  const unique: MinuteReading[] = [];
  for (const reading of valid) {
    if (unique.at(-1)?.timestamp === reading.timestamp) unique[unique.length - 1] = reading;
    else unique.push(reading);
  }
  if (!unique.length) return empty;
  const latest = unique.at(-1)!.timestamp;
  const byTimestamp = new Map(unique.map((point) => [point.timestamp, point]));
  const steps = Array.from({ length: horizon / 5 }, (_, index) => (index + 1) * 5);
  const signatures: string[] = [];
  let h1 = 2166136261, h2 = 0x9e3779b9;
  for (const point of unique) {
    const value = `${point.timestamp}/${point.temperature ?? 'null'}/${point.humidity ?? 'null'}/${point.count}`;
    h1 = hashText(h1, value, 16777619);
    h2 = hashText(h2, value, 2246822519);
    signatures.push(`${h1.toString(16)}:${h2.toString(16)}`);
  }

  let eligibleOrigins = 0, evaluatedOrigins = 0, sumAdvanced = 0, pairs = 0;
  const sumBasic = [0, 0, 0];
  const budget = Math.max(0, maxNewOrigins);
  let newEvaluations = 0;
  const maxCount = Math.max(0, maxOrigins);
  for (let i = unique.length - 1; i >= 0 && eligibleOrigins < maxCount; i--) {
    const origin = unique[i]!;
    if (origin.timestamp + horizon * CFG.minuteMs > latest) continue;
    if (targetWindowMinutes !== undefined &&
      origin.timestamp + horizon * CFG.minuteMs < latest - targetWindowMinutes * CFG.minuteMs) break;
    const targets = steps.map((minute) => byTimestamp.get(origin.timestamp + minute * CFG.minuteMs));
    if (targets.some((value) => !value)) continue;
    eligibleOrigins++;
    const targetSignature = targets.map((point) => `${point!.timestamp}:${point![metric]}`).join('|');
    const key = `${model}/${metric}/${horizon}/${origin.timestamp}/${i + 1}/${signatures[i]}/${targetSignature}`;
    const cached = cacheRead(key);
    if (!cached.found && newEvaluations >= budget) continue;
    let entry = cached.value;
    if (!cached.found) {
      newEvaluations++;
      computations++;
      const past = unique.slice(0, i + 1); // strict training cutoff: NO future measurements
      const path = advancedForecast(past, metric, model, origin.timestamp, horizon);
      if (path && steps.every((minute) => Number.isFinite(path[minute - 1]))) {
        const advanced = steps.reduce((sum, minute, index) =>
          sum + Math.abs(path[minute - 1]! - targets[index]![metric]!), 0) / steps.length;
        const basic = baselines.map((name) => {
          let sum = 0;
          for (let j = 0; j < steps.length; j++) {
            const at = origin.timestamp + steps[j]! * CFG.minuteMs;
            const prediction = predictAt(past, metric, name, origin.timestamp, at);
            if (prediction === null || !Number.isFinite(prediction)) return null;
            sum += Math.abs(prediction - targets[j]![metric]!);
          }
          return sum / steps.length;
        });
        if (Number.isFinite(advanced) && basic.every((value) => value !== null && Number.isFinite(value))) {
          entry = { advanced, basic: basic as [number, number, number] };
        }
      }
      cacheWrite(key, entry);
    }
    evaluatedOrigins++;
    if (entry) {
      pairs++;
      sumAdvanced += entry.advanced;
      for (let j = 0; j < baselines.length; j++) sumBasic[j]! += entry.basic[j]!;
    }
  }
  const pendingOrigins = eligibleOrigins - evaluatedOrigins;
  if (!pairs) return { ...empty, eligibleOrigins, evaluatedOrigins, pendingOrigins };
  const best = baselines.map((name, index) => ({ name, mae: sumBasic[index]! / pairs }))
    .sort((a, b) => a.mae - b.mae)[0]!;
  return { ...empty, pairs, mae: sumAdvanced / pairs, comparisonMae: best.mae,
    comparisonModel: best.name, eligibleOrigins, evaluatedOrigins, pendingOrigins };
}
