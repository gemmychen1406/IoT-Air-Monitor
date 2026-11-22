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
  it('refuses a trend over large holes despite five valid observations', () => {
    const data = series([20, 21, 22, 23, 24]);
    [0, 10, 15, 20, 30].forEach((minute, index) => { data[index]!.timestamp = START + mins(minute); });
    const result = analyzeTrend(data, 'temperature', START + mins(30));
    expect(result).toMatchObject({ status: 'insufficient', sampleCount: 5, slopePerMinute: null });
  });
  it('tolerates one missing minute but not two consecutive missing minutes', () => {
    const valid = series([20, 21, 23, 24, 25, 26]);
    valid.forEach((point, i) => { point.timestamp = START + mins(i >= 2 ? i + 1 : i); });
    expect(analyzeTrend(valid, 'temperature', START + mins(6)).status).toBe('increasing');
    const broken = valid.map((point) => ({ ...point }));
    broken[2]!.timestamp = START + mins(4);
    expect(analyzeTrend(broken, 'temperature', START + mins(6)).status).toBe('insufficient');
  });
  it('calculates a causal three-minute moving-average slope instead of a raw regression', () => {
    const values = [20, 20, 24, 21, 21, 24, 24, 25];
    const data = series(values);
    const result = analyzeTrend(data, 'temperature', START + mins(7));
    const smoothed = values.slice(2).map((_, index) =>
      ({ timestamp: START + mins(index + 2), value: (values[index]! + values[index + 1]! + values[index + 2]!) / 3 }));
    const expected = smoothed.reduce((sum, item, i) => sum + (i - 2.5) * item.value, 0) /
      smoothed.reduce((sum, _, i) => sum + (i - 2.5) ** 2, 0);
    expect(result.slopePerMinute).toBeCloseTo(expected);
    // A change to an observation AFTER the tested cutoff must not affect its slope.
    const future = series([125], undefined, START + mins(8));
    expect(analyzeTrend([...data, ...future], 'temperature', START + mins(7)).slopePerMinute).toBeCloseTo(expected);
  });
  it('ignores invalid values, future rows and identical-timestamp retransmissions', () => {
    const data = series([20, 21, 22, 23, 24]);
    const bogus = [
      { ...data[0]!, timestamp: Number.NaN },
      { ...data[1]!, temperature: Infinity },
      { ...data[2]!, temperature: 300 },
      { ...data[4]!, timestamp: START + mins(30) },
      { ...data[2]! },
    ];
    const clean = analyzeTrend(data, 'temperature', START + mins(4));
    const result = analyzeTrend([...bogus, ...data].reverse(), 'temperature', START + mins(4));
    expect(result).toMatchObject({ status: 'increasing', sampleCount: 5, current: 24 });
    expect(result.slopePerMinute).toBeCloseTo(clean.slopePerMinute!);
    expect(analyzeTrend([{ ...data[0]!, humidity: Number.NaN }], 'humidity', START).sampleCount).toBe(0);
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
  it('returns insufficient without measurements', () => {
    expect(analyzeTrend([], 'temperature', START).status).toBe('insufficient');
  });
});
