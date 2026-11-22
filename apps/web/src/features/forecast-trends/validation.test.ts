// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { walkForward } from './validation.js';
import { series } from './testHelpers.js';

describe('walk-forward backtesting', () => {
  it('evaluates on common targets and linear wins on a straight line', () => {
    const points = series(Array.from({ length: 70 }, (_, i) => 20 + i * 0.5));
    const result = walkForward(points, 'temperature', 10);
    expect(new Set(result.map((row) => row.pairs)).size).toBe(1);
    expect(result.find((row) => row.model === 'linear')?.mae).toBeCloseTo(0);
    expect(result.find((row) => row.model === 'naive')?.mae).toBeGreaterThan(0);
  });
  it('handles zero baseline without divide-by-zero', () => {
    const result = walkForward(series(Array(80).fill(25)), 'temperature', 5);
    expect(result[0]?.mae).toBe(0);
    expect(result[1]?.improvement).toBeNull();
  });
  it('skips origins with no observation at target tolerance', () => {
    const points = series(Array.from({ length: 60 }, (_, i) => i + 20))
      .filter((_, index) => index < 25 || index > 40);
    const result = walkForward(points, 'temperature', 5);
    expect(result[0]!.skipped).toBeGreaterThan(0);
  });
  it('uses a common set of recent completed targets and caps the window at 20 pairs', () => {
    const points = series(Array.from({ length: 100 }, (_, i) => 20 + i * 0.1));
    const latest = points.at(-1)!.timestamp;
    const rows = walkForward(points, 'temperature', 15, undefined, {
      minTargetAt: latest - 20 * 60_000,
      maxPairs: 20,
    });
    expect(rows.every(row => row.pairs === 20 && row.horizon === 15)).toBe(true);
    const none = walkForward(points, 'temperature', 15, undefined, {
      minTargetAt: latest + 60_000, maxPairs: 20,
    });
    expect(none.every(row => row.pairs === 0 && row.mae === null)).toBe(true);
  });

  it('does not count future readings as training', () => {
    const points = series(Array.from({ length: 50 }, (_, i) => i < 25 ? 20 + i : 300 - i * 3));
    const result = walkForward(points, 'temperature', 5);
    expect(result[0]!.pairs).toBeGreaterThan(0);
    expect(result.every((row) => Number.isFinite(row.mae ?? 0))).toBe(true);
  });
});


describe('walk-forward input integrity', () => {
  it('ignores invalid measurements and duplicate minute timestamps', () => {
    const original = series(Array.from({ length: 65 }, (_, i) => 20 + 0.03 * i));
    const reference = walkForward(original, 'temperature', 15, undefined, { multiStep: true });
    const dirty = [...original, original[10]!, { ...original[20]!, temperature: Number.NaN },
      { ...original[30]!, temperature: 500 }];
    const actual = walkForward(dirty, 'temperature', 15, undefined, { multiStep: true });
    expect(actual.map((row) => row.pairs)).toEqual(reference.map((row) => row.pairs));
    expect(actual.map((row) => row.mae)).toEqual(reference.map((row) => row.mae));
  });
});
