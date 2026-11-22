/** Forecast-only, dependency-free research models. They never synthesize missing sensor data.
 * Every fitted model receives readings strictly at/before its prediction origin.
 */
import { FORECAST_CONFIG as CFG } from './config.js';
import type { Measure, MinuteReading } from './types.js';

export type AdvancedForecastModel = 'random_forest' | 'holt_winters';

const bounds = (metric: Measure, value: number): number =>
  metric === 'humidity' ? Math.max(0, Math.min(100, value)) : Math.max(-40, Math.min(125, value));

function recentContinuous(points: readonly MinuteReading[], cutoff: number): MinuteReading[] {
  const sorted = points.filter((p) => p.timestamp <= cutoff).sort((a, b) => a.timestamp - b.timestamp);
  const tail: MinuteReading[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i]!;
    if (point.temperature === null || point.humidity === null ||
        !Number.isFinite(point.temperature) || !Number.isFinite(point.humidity)) break;
    if (tail.length && tail[0]!.timestamp - point.timestamp !== CFG.minuteMs) break;
    tail.unshift(point);
    if (tail.length >= CFG.advancedMaxMinutes) break;
  }
  return tail;
}

function pearsonLag(residuals: readonly number[], lag: number): number {
  const xs = residuals.slice(-2 * lag, -lag);
  const ys = residuals.slice(-lag);
  if (xs.length !== lag || ys.length !== lag) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / lag;
  const my = ys.reduce((a, b) => a + b, 0) / lag;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < lag; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  return vx > 1e-9 && vy > 1e-9 ? cov / Math.sqrt(vx * vy) : 0;
}

/** Additive Holt-Winters, only when a measurable and repeating seasonal pattern exists. */
function forecastSeasonal(readings: readonly MinuteReading[], metric: Measure, horizon: number): number[] | null {
  const values = readings.map((reading) => reading[metric]!);
  const n = values.length;
  const avgX = (n - 1) / 2;
  const avgY = values.reduce((a, b) => a + b, 0) / n;
  let top = 0, bottom = 0;
  for (let i = 0; i < n; i++) {
    top += (i - avgX) * (values[i]! - avgY);
    bottom += (i - avgX) ** 2;
  }
  const slope = bottom ? top / bottom : 0;
  const residual = values.map((v, i) => v - avgY - slope * (i - avgX));
  const minAmplitude = metric === 'temperature' ? 0.12 : 0.45;
  if (Math.max(...residual) - Math.min(...residual) < minAmplitude * 2) return null;
  const periods = [8, 10, 12, 15, 20, 30, 45, 60];
  const ranked = periods.filter((period) => n >= 3 * period)
    .map((period) => ({ period, correlation: pearsonLag(residual, period) }))
    .filter((candidate) => candidate.correlation >= 0.72)
    .sort((a, b) => b.correlation - a.correlation);
  const chosen = ranked[0];
  if (!chosen) return null;
  const p = chosen.period;
  const firstMean = values.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const secondMean = values.slice(p, 2 * p).reduce((a, b) => a + b, 0) / p;
  let level = firstMean;
  let trend = (secondMean - firstMean) / p;
  const season = values.slice(0, p).map((value) => value - firstMean);
  const alpha = 0.35, beta = 0.08, gamma = 0.25;
  for (let i = p; i < n; i++) {
    const oldLevel = level;
    const oldSeason = season[i - p]!;
    level = alpha * (values[i]! - oldSeason) + (1 - alpha) * (level + trend);
    trend = beta * (level - oldLevel) + (1 - beta) * trend;
    season.push(gamma * (values[i]! - level) + (1 - gamma) * oldSeason);
  }
  const result: number[] = [];
  for (let minute = 1; minute <= horizon; minute++) {
    // Trend damping limits implausible runaway extrapolation over 30 minutes.
    const dampedTrend = trend * 0.97 * (1 - 0.97 ** minute) / (1 - 0.97);
    result.push(bounds(metric, level + dampedTrend + season[n - p + (minute - 1) % p]!));
  }
  return result.every(Number.isFinite) ? result : null;
}

interface Sample { feature: number[]; target: number[] }
interface Leaf { average: number[] }
interface Branch { feature: number; split: number; left: Tree; right: Tree }
type Tree = Leaf | Branch;

function featuresAt(points: readonly MinuteReading[], i: number): number[] | null {
  if (i < 20) return null;
  const offsets = [0, 1, 3, 5, 10, 15, 20];
  const result: number[] = [];
  for (const metric of ['temperature', 'humidity'] as const) {
    for (const lag of offsets) {
      const value = points[i - lag]?.[metric];
      if (value === null || value === undefined || !Number.isFinite(value)) return null;
      result.push(value);
    }
    const current = points[i]![metric]!;
    result.push(current - points[i - 5]![metric]!, current - points[i - 20]![metric]!);
    for (const width of [5, 20]) {
      const window = points.slice(i - width + 1, i + 1).map((point) => point[metric]!);
      const mean = window.reduce((a, b) => a + b, 0) / width;
      result.push(mean, Math.max(...window) - Math.min(...window));
    }
  }
  return result;
}

function meanTargets(samples: readonly Sample[], indices: readonly number[], horizon: number): number[] {
  const values = Array(horizon).fill(0) as number[];
  for (const index of indices) {
    for (let h = 0; h < horizon; h++) values[h]! += samples[index]!.target[h]!;
  }
  return values.map((v) => v / indices.length);
}

function impurity(samples: readonly Sample[], indices: readonly number[], horizon: number): number {
  if (!indices.length) return Infinity;
  const steps = [...new Set([Math.min(4, horizon - 1), Math.floor((horizon - 1) / 2), horizon - 1])];
  let total = 0;
  for (const step of steps) {
    let sum = 0, sumSquares = 0;
    for (const index of indices) {
      const target = samples[index]!.target[step]!;
      sum += target; sumSquares += target * target;
    }
    total += Math.max(0, sumSquares - sum * sum / indices.length);
  }
  return total;
}

function buildTree(samples: readonly Sample[], ids: number[], horizon: number, depth: number, random: () => number): Tree {
  const average = meanTargets(samples, ids, horizon);
  if (depth >= 4 || ids.length < 14) return { average };
  const featureCount = samples[0]!.feature.length;
  const tried = new Set<number>();
  let choice: { feature: number; split: number; left: number[]; right: number[]; score: number } | null = null;
  for (let attempt = 0; attempt < Math.min(7, featureCount); attempt++) {
    let feature = Math.floor(random() * featureCount);
    while (tried.has(feature)) feature = (feature + 1) % featureCount;
    tried.add(feature);
    const sorted = ids.map((id) => samples[id]!.feature[feature]!).sort((a, b) => a - b);
    for (const quantile of [0.25, 0.5, 0.75]) {
      const split = sorted[Math.floor((sorted.length - 1) * quantile)]!;
      const left = ids.filter((id) => samples[id]!.feature[feature]! <= split);
      if (left.length < 5 || ids.length - left.length < 5) continue;
      const right = ids.filter((id) => samples[id]!.feature[feature]! > split);
      const score = impurity(samples, left, horizon) + impurity(samples, right, horizon);
      if (!choice || score < choice.score) choice = { feature, split, left, right, score };
    }
  }
  if (!choice || choice.score >= impurity(samples, ids, horizon) - 1e-8) return { average };
  return {
    feature: choice.feature, split: choice.split,
    left: buildTree(samples, choice.left, horizon, depth + 1, random),
    right: buildTree(samples, choice.right, horizon, depth + 1, random),
  };
}

function walkTree(tree: Tree, feature: readonly number[]): number[] {
  while ('split' in tree) tree = feature[tree.feature]! <= tree.split ? tree.left : tree.right;
  return tree.average;
}

/** Small seeded random forest with multi-output leaves: all horizons predicted directly.
 * Training row i uses i-20..i; its target uses i+1..i+horizon.
 * All rows are cut off at the caller's prediction origin, preventing leakage.
 */
function forecastForest(readings: readonly MinuteReading[], metric: Measure, horizon: number): number[] | null {
  const n = readings.length;
  const feature = featuresAt(readings, n - 1);
  if (!feature) return null;
  const samples: Sample[] = [];
  for (let i = 20; i + horizon < n; i++) {
    const item = featuresAt(readings, i);
    if (!item) continue;
    const current = readings[i]![metric]!;
    const target = Array.from({ length: horizon }, (_, step) => readings[i + step + 1]![metric]! - current);
    if (target.every(Number.isFinite)) samples.push({ feature: item, target });
  }
  if (samples.length < CFG.forestMinTrainingRows) return null;
  let seed = 3214837;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const result = Array(horizon).fill(0) as number[];
  const count = 8;
  for (let treeIndex = 0; treeIndex < count; treeIndex++) {
    const bootstrap = Array.from({ length: samples.length }, () => Math.floor(random() * samples.length));
    const tree = buildTree(samples, bootstrap, horizon, 0, random);
    const predicted = walkTree(tree, feature);
    for (let step = 0; step < horizon; step++) result[step]! += predicted[step]! / count;
  }
  return result.map((delta) => bounds(metric, readings.at(-1)![metric]! + delta));
}

export function advancedForecast(
  history: readonly MinuteReading[], metric: Measure, model: AdvancedForecastModel,
  originTime: number, horizon: 15 | 30,
): number[] | null {
  const readings = recentContinuous(history, originTime);
  if (!readings.length || readings.at(-1)!.timestamp !== originTime) return null;
  const output = model === 'holt_winters'
    ? forecastSeasonal(readings, metric, horizon)
    : forecastForest(readings, metric, horizon);
  return output?.length === horizon && output.every(Number.isFinite) ? output : null;
}
