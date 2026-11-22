// [FORECAST - FILE MOI] Kiem thu module Phan tich xu huong & Du bao; khong thuoc cac module khac.
import { describe, expect, it } from 'vitest';
import { forecastMeasure, predictAt } from './forecasting.js';
import { START, mins, series } from './testHelpers.js';

describe('short horizon forecasting', () => {
  it('Naive repeats latest observed value', () => {
    const points = series([22, 24, 26]);
    const result = forecastMeasure(points, 'temperature', 'naive', 15, START + mins(2));
    expect(result.status).toBe('eligible');
    expect(result.points.length).toBe(15);
    expect(result.points.at(-1)?.value).toBe(26);
  });
  it('linear OLS extrapolates real elapsed time', () => {
    const points = series([20, 21, 22, 23, 24, 25]);
    expect(predictAt(points, 'temperature', 'linear', START + mins(5), START + mins(10))).toBeCloseTo(30);
  });
  it('predicts simple models at the exact raw-sample horizon, including seconds', () => {
    const points = series([20, 21, 22, 23, 24, 25]);
    const sampledAt = START + mins(5) + 45_000;
    const result = forecastMeasure(points, 'temperature', 'linear', 15, sampledAt, sampledAt, 25);
    expect(result.status).toBe('eligible');
    expect(result.lastSampleAt).toBe(sampledAt);
    expect(result.points.at(-1)?.timestamp).toBe(sampledAt + mins(15));
    expect(result.points.at(-1)?.value).toBeCloseTo(40.75);
  });
  it('Holt does not double-update the second observation', () => {
    const points = series([20, 22, 24, 26, 28, 30]);
    expect(predictAt(points, 'temperature', 'holt', START + mins(5), START + mins(10))).toBeCloseTo(40);
  });
  it('handles irregular time intervals for Holt', () => {
    const points = series([20, 22, 24, 26, 28, 30]);
    for (let i = 0; i < points.length; i++) points[i]!.timestamp = START + mins(i * 2);
    expect(predictAt(points, 'temperature', 'holt', START + mins(10), START + mins(15))).toBeCloseTo(35);
  });
  it('clamps humidity to 100 and allows unconstrained temperature', () => {
    const points = series([20, 30, 40, 50, 60, 70], [80, 85, 90, 95, 99, 100]);
    expect(predictAt(points, 'humidity', 'linear', START + mins(5), START + mins(30))).toBe(100);
    expect(predictAt(points, 'temperature', 'linear', START + mins(5), START + mins(30))!).toBeGreaterThan(100);
  });
  it('blocks Holt and linear when under five minutes of data', () => {
    const points = series([21, 22, 23, 24]);
    expect(forecastMeasure(points, 'temperature', 'holt', 15, START + mins(3)).status).toBe('insufficient');
    expect(forecastMeasure(points, 'temperature', 'linear', 15, START + mins(3)).status).toBe('insufficient');
    expect(forecastMeasure(points, 'temperature', 'naive', 15, START + mins(3)).status).toBe('eligible');
  });
  it('blocks stale source and returns no fabricated forecast line', () => {
    const output = forecastMeasure(series([20, 21, 22, 23, 24]), 'temperature', 'holt', 30, START + mins(20));
    expect(output.status).toBe('stale');
    expect(output.points).toEqual([]);
  });
  it('does not train on later readings even if caller supplies a full history', () => {
    const points = series([20, 21, 22, 23, 24, 250, -100]);
    expect(predictAt(points, 'temperature', 'linear', START + mins(4), START + mins(6))).toBeCloseTo(26);
    expect(predictAt(points.slice(0, 5), 'temperature', 'linear', START + mins(4), START + mins(6))).toBeCloseTo(26);
  });
});
