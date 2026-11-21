// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { historicalReplay } from './replay.js';
import { START, mins, series } from './testHelpers.js';

describe('historical replay without live forecast claims', () => {
  it('replays a forecast with training data strictly before the target', () => {
    const points = series(Array.from({ length: 70 }, (_, i) => 22 + i * 0.1));
    const value = historicalReplay(points, 'linear', 15);
    expect(value?.originTime).toBe(START + mins(54));
    expect(value?.targetTime).toBe(START + mins(69));
    expect(value?.forecast.temperature.points.at(-1)?.value).toBeCloseTo(points.at(-1)!.temperature!);
  });
  it('does not invent a replay for too short a series', () => {
    expect(historicalReplay(series([25, 26, 27]), 'holt', 15)).toBeNull();
  });
});
