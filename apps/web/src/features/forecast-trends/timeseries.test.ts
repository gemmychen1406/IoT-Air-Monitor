// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { FORECAST_CONFIG as CFG } from './config.js';
import { analyzeTrend, normalizeReadings, parseSyncedTime, rapidSlope } from './timeseries.js';
import { START, mins, reading, series } from './testHelpers.js';

describe('normalization and trend', () => {
  it('aggregates within minute, preserves gaps and missing moving averages', () => {
    const result = normalizeReadings([
      reading(0, 20, 50), reading(0, 22, 52, { at: START + 10_000 }),
      reading(2, 24, 54), reading(3, 25, 55), reading(4, 26, 56),
    ], START + mins(5));
    expect(result.points.map((point) => point.count)).toEqual([2, 0, 1, 1, 1]);
    expect(result.points[0]?.temperature).toBe(21);
    expect(result.points[1]?.temperatureMa).toBeNull();
    expect(result.points[2]?.temperatureMa).toBeNull();
    expect(result.points[4]?.temperatureMa).toBeCloseTo(25);
  });
  it('does not overweight retransmitted timestamps', () => {
    const a = reading(0, 20, 50);
    const result = normalizeReadings([a, a, reading(0, 30, 60, { at: START + 1000 })], START + mins(1));
    expect(result.duplicateTimestamps).toBe(1);
    expect(result.points[0]?.count).toBe(2);
    expect(result.points[0]?.temperature).toBe(25);
  });
  it('rejects unsynced, invalid and future samples', () => {
    const result = normalizeReadings([
      reading(0, 20, 50, { synced: false }), reading(0, null, null, { quality: 'invalid' }),
      reading(1, Number.NaN, 50), reading(1, 1000, 50), reading(3, 30, 70), reading(0, 20, 60),
    ], START + mins(2));
    expect(result.validSamples).toBe(1);
    expect(result.rejectedSamples).toBe(5);
  });
  it('parses only timezone-aware timestamps', () => {
    expect(parseSyncedTime('2026-01-01T09:00:00.000Z')).toBe(START);
    expect(parseSyncedTime('2026-01-01T16:00:00+07:00')).toBe(START);
    expect(parseSyncedTime('2026-01-01T09:00:00')).toBeNull();
  });
  it('handles increasing, decreasing and flat series', () => {
    const increasing = series(Array.from({ length: 10 }, (_, i) => 20 + i));
    expect(analyzeTrend(increasing, 'temperature', START + mins(9)).status).toBe('increasing');
    expect(analyzeTrend(series(increasing.map((p) => 35 - (p.temperature! - 20))), 'temperature', START + mins(9)).status).toBe('decreasing');
    expect(analyzeTrend(series(Array(10).fill(25)), 'temperature', START + mins(9)).status).toBe('stable');
    expect(rapidSlope(increasing, 'temperature')).toBeCloseTo(1);
  });
  it('uses elapsed timestamps, not array positions', () => {
    const points = series([10, 12, 14, 16, 18]);
    points[1]!.timestamp += mins(1);
    points[2]!.timestamp += mins(2);
    points[3]!.timestamp += mins(3);
    points[4]!.timestamp += mins(4);
    expect(analyzeTrend(points, 'temperature', START + mins(8)).slopePerMinute).toBeCloseTo(1);
  });
  it('observes exact stale boundary', () => {
    const points = series([25, 26, 27, 28, 29]);
    const end = points.at(-1)!.timestamp;
    expect(analyzeTrend(points, 'temperature', end + CFG.staleAfterMs).status).toBe('increasing');
    expect(analyzeTrend(points, 'temperature', end + CFG.staleAfterMs + 1).status).toBe('stale');
  });
  it('can use the exact synchronized sample time for stale detection', () => {
    const points = series([25, 26, 27, 28, 29]);
    const actualSampleTime = points.at(-1)!.timestamp + 45_000;
    expect(analyzeTrend(points, 'temperature', actualSampleTime + CFG.staleAfterMs, actualSampleTime).status).toBe('increasing');
    expect(analyzeTrend(points, 'temperature', actualSampleTime + CFG.staleAfterMs + 1, actualSampleTime).status).toBe('stale');
  });
  it('does not classify a broken 30-minute history as a reliable trend', () => {
    const points = series([20, 21, 22, 23, 24]);
    [0, 10, 15, 20, 30].forEach((minute, index) => { points[index]!.timestamp = START + mins(minute); });
    const trend = analyzeTrend(points, 'temperature', START + mins(30));
    expect(trend).toMatchObject({ status: 'insufficient', sampleCount: 5, slopePerMinute: null });
  });
  it('tolerates one missing bucket but never interpolates larger gaps', () => {
    const points = series([20, 21, 23, 24, 25, 26]);
    [0, 1, 3, 4, 5, 6].forEach((minute, index) => { points[index]!.timestamp = START + mins(minute); });
    expect(analyzeTrend(points, 'temperature', START + mins(6)).status).toBe('increasing');
  });
  it('uses trailing smoothing instead of the noisier raw readings', () => {
    const points = series([20, 20, 20, 20, 20, 20, 20, 20, 20, 50]);
    const trend = analyzeTrend(points, 'temperature', START + mins(9));
    const rawSlope = (50 - 20) * (9 - 4.5) / 82.5; // OLS for the one final spike
    expect(trend.status).toBe('increasing');
    expect(trend.slopePerMinute!).toBeLessThan(rawSlope);
  });
  it('ignores future, invalid and duplicate timestamps when calculating trend', () => {
    const points = series([20, 21, 22, 23, 24, 25]);
    points.push({ ...points[3]!, temperature: 23 });
    points.push({ ...points[5]!, timestamp: START + mins(7), temperature: 999 });
    points.push({ ...points[5]!, timestamp: START + mins(8), temperature: 30 });
    const trend = analyzeTrend(points, 'temperature', START + mins(5));
    expect(trend.sampleCount).toBe(6);
    expect(trend.status).toBe('increasing');
  });
  it('returns insufficient without measurements', () => {
    expect(analyzeTrend([], 'temperature', START).status).toBe('insufficient');
  });
});
