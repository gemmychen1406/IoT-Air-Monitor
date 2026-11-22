// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import type { ReadingView } from '@iot/contracts';
import { FORECAST_CONFIG as CFG } from './config.js';
import type { Measure, MinuteReading, NormalizedHistory, TrendResult } from './types.js';

export function parseSyncedTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Shared across forecasts and lag analysis: only synchronized, valid DHT11 readings. */
export function normalizeReadings(readings: readonly ReadingView[], nowMs: number): NormalizedHistory {
  const byTimestamp = new Map<number, { t: number; h: number; count: number }>();
  let rejectedSamples = 0;
  let duplicateTimestamps = 0;
  let latestReceivedAt: number | null = null;
  for (const reading of readings) {
    const payload = reading?.payload;
    const dht = payload?.sensors?.dht11;
    const timestamp = payload?.time_quality === 'synced' ? parseSyncedTime(payload.sampled_at) : null;
    const temperature = dht?.temperature_c;
    const humidity = dht?.humidity_pct;
    if (
      timestamp === null || timestamp > nowMs || dht?.quality !== 'valid' ||
      typeof temperature !== 'number' || !Number.isFinite(temperature) ||
      typeof humidity !== 'number' || !Number.isFinite(humidity) ||
      temperature < -40 || temperature > 125 || humidity < 0 || humidity > 100
    ) {
      rejectedSamples++;
      continue;
    }
    const receivedAt = parseSyncedTime(reading.received_at);
    if (receivedAt !== null) latestReceivedAt = Math.max(latestReceivedAt ?? receivedAt, receivedAt);
    const existing = byTimestamp.get(timestamp);
    if (existing) {
      // One instant counts once, even if telemetry was retransmitted.
      // Conflicting readings at an identical timestamp are averaged, not double-weighted.
      duplicateTimestamps++;
      existing.t += temperature;
      existing.h += humidity;
      existing.count++;
    } else {
      byTimestamp.set(timestamp, { t: temperature, h: humidity, count: 1 });
    }
  }
  const minuteMap = new Map<number, { temperature: number; humidity: number; count: number }>();
  let latestSampleAt: number | null = null;
  for (const [timestamp, sample] of byTimestamp) {
    latestSampleAt = Math.max(latestSampleAt ?? timestamp, timestamp);
    const minute = Math.floor(timestamp / CFG.minuteMs) * CFG.minuteMs;
    const existing = minuteMap.get(minute) ?? { temperature: 0, humidity: 0, count: 0 };
    existing.temperature += sample.t / sample.count;
    existing.humidity += sample.h / sample.count;
    existing.count++;
    minuteMap.set(minute, existing);
  }
  const times = [...minuteMap.keys()].sort((a, b) => a - b);
  const points: MinuteReading[] = [];
  if (times.length) {
    // Prevent unbounded allocation if data unexpectedly spans many days.
    const first = Math.max(times[0]!, times[times.length - 1]! - CFG.historyMinutes * CFG.minuteMs);
    for (let stamp = first; stamp <= times[times.length - 1]!; stamp += CFG.minuteMs) {
      const bucket = minuteMap.get(stamp);
      points.push({
        timestamp: stamp,
        temperature: bucket ? bucket.temperature / bucket.count : null,
        humidity: bucket ? bucket.humidity / bucket.count : null,
        count: bucket?.count ?? 0,
        temperatureMa: null,
        humidityMa: null,
      });
    }
  }
  for (let i = CFG.movingAverageMinutes - 1; i < points.length; i++) {
    const window = points.slice(i - CFG.movingAverageMinutes + 1, i + 1);
    if (window.every((point) => point.temperature !== null)) {
      points[i]!.temperatureMa = window.reduce((sum, point) => sum + point.temperature!, 0) / window.length;
    }
    if (window.every((point) => point.humidity !== null)) {
      points[i]!.humidityMa = window.reduce((sum, point) => sum + point.humidity!, 0) / window.length;
    }
  }
  const latestRaw = latestSampleAt === null ? null : byTimestamp.get(latestSampleAt);
  const latestSample = latestSampleAt !== null && latestRaw
    ? { timestamp: latestSampleAt, temperature: latestRaw.t / latestRaw.count,
      humidity: latestRaw.h / latestRaw.count } : null;
  return { points, validSamples: byTimestamp.size, rejectedSamples, duplicateTimestamps,
    latestSampleAt, latestSample, latestReceivedAt };
}

export function latestValid(points: readonly MinuteReading[], metric: Measure) {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (p[metric] !== null) return { timestamp: p.timestamp, value: p[metric] as number };
  }
  return null;
}

/** Ordinary least squares with actual elapsed minutes; points need not be equally spaced. */
export function fitLine(data: readonly { timestamp: number; value: number }[]) {
  if (data.length < 2) return null;
  const origin = data[0]!.timestamp;
  const xs = data.map((p) => (p.timestamp - origin) / CFG.minuteMs);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = data.reduce((a, p) => a + p.value, 0) / data.length;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < data.length; i++) {
    const dx = xs[i]! - mx;
    covariance += dx * (data[i]!.value - my);
    variance += dx * dx;
  }
  if (variance <= 1e-12) return null;
  const slope = covariance / variance;
  return { origin, slope, intercept: my - slope * mx };
}

/** An explicit 30-minute view: keep valid observations only, and give duplicate
 * minute timestamps one equal-weight contribution (no extra weight for replays).
 * normalizeReadings normally guarantees both properties, but analyzeTrend can
 * also receive independently constructed/test histories.
 */
function trendObservations(points: readonly MinuteReading[], metric: Measure, nowMs: number) {
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const point of points) {
    const value = point[metric];
    if (!Number.isFinite(point.timestamp) || point.timestamp > nowMs ||
        typeof value !== 'number' || !Number.isFinite(value) ||
        (metric === 'humidity' && (value < 0 || value > 100)) ||
        (metric === 'temperature' && (value < -40 || value > 125))) continue;
    const existing = buckets.get(point.timestamp) ?? { sum: 0, count: 0 };
    existing.sum += value;
    existing.count++;
    buckets.set(point.timestamp, existing);
  }
  return [...buckets].sort(([a], [b]) => a - b)
    .map(([timestamp, bucket]) => ({ timestamp, value: bucket.sum / bucket.count }));
}

/** Trend is derived from a CAUSAL trailing three-minute average. Only fully
 * observed, consecutive minute buckets contribute to the smoothed regression;
 * if there are fewer than two smoothed values, retain the legacy raw fallback.
 * No gap is ever filled with an invented reading.
 */
export function analyzeTrend(points: readonly MinuteReading[], metric: Measure, nowMs: number, actualSampleAt?: number | null): TrendResult {
  const valid = trendObservations(points, metric, nowMs);
  const last = valid.at(-1);
  const ageMs = last ? Math.max(0, nowMs - (actualSampleAt ?? last.timestamp)) : null;
  const window = last ? valid.filter((point) => point.timestamp >= last.timestamp - CFG.trendMinutes * CFG.minuteMs) : [];
  const values = window.map((point) => point.value);
  const result: TrendResult = {
    status: 'insufficient', slopePerMinute: null, current: last?.value ?? null,
    average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    minimum: values.length ? Math.min(...values) : null,
    maximum: values.length ? Math.max(...values) : null,
    sampleCount: values.length, lastSampleAt: last?.timestamp ?? null, ageMs,
  };
  const stale = ageMs !== null && ageMs > CFG.staleAfterMs;
  const unavailable = { ...result, status: stale ? 'stale' as const : 'insufficient' as const };
  if (window.length < CFG.regressionMinimum) return unavailable;

  // With 1-minute buckets, a difference >2 minutes means more than one
  // consecutive minute is unobserved; never infer a reliable trend across it.
  const maxGapMs = CFG.trendMaxGapMinutes * CFG.minuteMs;
  if (window.some((point, index) => index > 0 &&
      point.timestamp - window[index - 1]!.timestamp > maxGapMs)) return unavailable;

  const smoothed: { timestamp: number; value: number }[] = [];
  for (let i = CFG.movingAverageMinutes - 1; i < window.length; i++) {
    const trailing = window.slice(i - CFG.movingAverageMinutes + 1, i + 1);
    if (trailing.some((point, index) => index > 0 &&
        point.timestamp - trailing[index - 1]!.timestamp !== CFG.minuteMs)) continue;
    smoothed.push({ timestamp: trailing.at(-1)!.timestamp,
      value: trailing.reduce((sum, point) => sum + point.value, 0) / trailing.length });
  }
  const line = fitLine(smoothed.length >= 2 ? smoothed : window);
  if (!line || !Number.isFinite(line.slope)) return unavailable;
  const stableThreshold = metric === 'temperature' ? CFG.temperatureStableSlope : CFG.humidityStableSlope;
  return { ...result, slopePerMinute: line.slope,
    status: stale ? 'stale' : line.slope > stableThreshold ? 'increasing' : line.slope < -stableThreshold ? 'decreasing' : 'stable' };
}

export function rapidSlope(points: readonly MinuteReading[], metric: Measure) {
  const last = latestValid(points, metric);
  if (!last) return null;
  const recent = points.filter((p) => p.timestamp >= last.timestamp - CFG.rapidChangeMinutes * CFG.minuteMs && p[metric] !== null);
  if (recent.length < 3) return null;
  return fitLine(recent.map((p) => ({ timestamp: p.timestamp, value: p[metric]! })))?.slope ?? null;
}
