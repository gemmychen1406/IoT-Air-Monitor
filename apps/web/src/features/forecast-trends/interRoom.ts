// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import { FORECAST_CONFIG as CFG } from './config.js';
import type { LagCorrelationPoint, LagResult, Measure, MinuteReading } from './types.js';

interface Change { time: number; value: number }
function changes(points: readonly MinuteReading[], metric: Measure): Change[] {
  const result: Change[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    // Missing minutes break the chain: never invent a gradient across gaps.
    if (a[metric] === null || b[metric] === null || b.timestamp - a.timestamp !== CFG.minuteMs) continue;
    result.push({ time: b.timestamp, value: b[metric]! - a[metric]! });
  }
  return result;
}
function correlation(a: readonly number[], b: readonly number[]) {
  if (a.length < CFG.lagMinPairs) return null;
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let sum = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const dx = a[i]! - ma;
    const dy = b[i]! - mb;
    sum += dx * dy;
    va += dx * dx;
    vb += dy * dy;
  }
  if (va < 1e-8 || vb < 1e-8) return null;
  return sum / Math.sqrt(va * vb);
}

/** A descriptive curve for the UI, calculated only from readings already in the API.
 * Missing minutes are excluded rather than interpolated. A high value alone does
 * not establish causality or prove that heat/moisture moved between the rooms.
 */
export function lagCorrelationProfile(
  source: readonly MinuteReading[], target: readonly MinuteReading[], metric: Measure,
): LagCorrelationPoint[] {
  const sourceChanges = changes(source, metric);
  const targetChanges = new Map(changes(target, metric).map((point) => [point.time, point.value]));
  const profile: LagCorrelationPoint[] = [];
  for (let lag = 0; lag <= CFG.lagMaxMinutes; lag++) {
    const sourceValues: number[] = [];
    const targetValues: number[] = [];
    for (const sample of sourceChanges) {
      const targetValue = targetChanges.get(sample.time + lag * CFG.minuteMs);
      if (targetValue === undefined) continue;
      sourceValues.push(sample.value);
      targetValues.push(targetValue);
    }
    profile.push({
      lagMinutes: lag,
      correlation: correlation(sourceValues, targetValues),
      samplePairs: sourceValues.length,
    });
  }
  return profile;
}

/** Purely observational lead/lag on first differences; NEVER a causal spread detector. */
export function analyzeRoomLag(
  sourceId: string, source: readonly MinuteReading[], targetId: string, target: readonly MinuteReading[], metric: Measure,
): LagResult {
  // A lag on almost-flat DHT11 traces is not useful evidence of spread.
  // Require substantial change at BOTH rooms before considering correlations.
  if (source.length < CFG.lagMinPairs + 1 || target.length < CFG.lagMinPairs + 1) {
    return { sourceId, targetId, metric, lagMinutes: null, correlation: null, samplePairs: 0,
      status: 'insufficient', detail: `Cần ít nhất ${CFG.lagMinPairs} cặp biến động đồng bộ.` };
  }
  const valuesA = source.flatMap((point) => point[metric] === null ? [] : [point[metric]!]);
  const valuesB = target.flatMap((point) => point[metric] === null ? [] : [point[metric]!]);
  const minimumRange = metric === 'temperature' ? 1.5 : 5;
  const rangeA = valuesA.length ? Math.max(...valuesA) - Math.min(...valuesA) : 0;
  const rangeB = valuesB.length ? Math.max(...valuesB) - Math.min(...valuesB) : 0;
  if (rangeA < minimumRange || rangeB < minimumRange) {
    return { sourceId, targetId, metric, lagMinutes: null, correlation: null, samplePairs: 0,
      status: 'not_detected', detail: 'Biến động chưa đủ lớn ở cả hai khu vực để suy xét quan hệ trễ.' };
  }
  const profile = lagCorrelationProfile(source, target, metric);
  const zeroCorrelation = profile[0]?.correlation ?? null;
  const maxPairs = Math.max(...profile.map((point) => point.samplePairs));
  const best = profile
    .filter((point) => point.lagMinutes > 0 && point.correlation !== null)
    .sort((a, b) => b.correlation! - a.correlation!)[0];
  if (maxPairs < CFG.lagMinPairs) {
    return { sourceId, targetId, metric, lagMinutes: null, correlation: null, samplePairs: maxPairs, status: 'insufficient', detail: `Cần ít nhất ${CFG.lagMinPairs} cặp biến động đồng bộ.` };
  }
  if (!best || best.correlation! < CFG.lagMinCorrelation || (zeroCorrelation !== null && best.correlation! - zeroCorrelation < CFG.lagMinLeadGain)) {
    return { sourceId, targetId, metric, lagMinutes: best?.lagMinutes ?? null, correlation: best?.correlation ?? null, samplePairs: best?.samplePairs ?? maxPairs, status: 'not_detected', detail: 'Chưa tìm thấy quan hệ trễ đủ rõ trên dữ liệu hiện có.' };
  }
  return {
    sourceId, targetId, metric, lagMinutes: best.lagMinutes, correlation: best.correlation, samplePairs: best.samplePairs, status: 'candidate',
    detail: `Biến động ở khu vực nguồn đi trước khoảng ${best.lagMinutes} phút (tương quan ${best.correlation!.toFixed(2)}, ${best.samplePairs} cặp). Đây chỉ là dấu hiệu thống kê, không chứng minh lan truyền vật lý.`,
  };
}

export function analyzeAllRoomPairs(rooms: readonly { id: string; points: MinuteReading[] }[]): LagResult[] {
  const result: LagResult[] = [];
  for (const source of rooms) {
    for (const target of rooms) {
      if (source.id === target.id) continue;
      for (const metric of ['temperature', 'humidity'] as const) {
        result.push(analyzeRoomLag(source.id, source.points, target.id, target.points, metric));
      }
    }
  }
  return result;
}
