// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { evaluateAdvisory } from './advisory.js';
import { analyzeTrend } from './timeseries.js';
import { forecastBoth } from './forecasting.js';
import { START, mins, series } from './testHelpers.js';

describe('trend and forecast advisories', () => {
  it('reports normal for flat, in-range measurements', () => {
    const points = series(Array(10).fill(25), Array(10).fill(50));
    const now = START + mins(9);
    const result = evaluateAdvisory(points, analyzeTrend(points, 'temperature', now), analyzeTrend(points, 'humidity', now), forecastBoth(points, 'holt', 15, now));
    expect(result.level).toBe('normal');
  });
  it('reports noteworthy forecast threshold crossings', () => {
    const points = series([28, 29, 30, 31, 32, 33], [50, 50, 50, 50, 50, 50]);
    const now = START + mins(5);
    const result = evaluateAdvisory(points, analyzeTrend(points, 'temperature', now), analyzeTrend(points, 'humidity', now), forecastBoth(points, 'holt', 15, now));
    expect(result.details.some((detail) => detail.includes('dự báo'))).toBe(true);
  });
  it('blocks interpretation on stale measurements', () => {
    const points = series(Array(10).fill(25));
    const now = START + mins(30);
    expect(evaluateAdvisory(points, analyzeTrend(points, 'temperature', now), analyzeTrend(points, 'humidity', now), forecastBoth(points, 'naive', 15, now)).level).toBe('unavailable');
  });
});
