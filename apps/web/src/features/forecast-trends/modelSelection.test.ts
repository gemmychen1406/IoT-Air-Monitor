import { describe, expect, it } from 'vitest';
import { chooseByMae, selectForecastModel } from './modelSelection.js';
import { evaluateDhtMetricStatus } from './dhtAdvisory.js';
import { forecastMeasure } from './forecasting.js';
import { series, START, mins } from './testHelpers.js';
import type { Measure } from './types.js';
import type { ValidationRow } from './validation.js';

function rows(metric: Measure, maes: [number, number, number], pairs = 48, horizon = 15): ValidationRow[] {
  return (['naive', 'linear', 'holt'] as const).map((model, i) => ({
    model, metric, horizon, pairs, mae: maes[i]!, improvement: null, skipped: 0,
  }));
}

describe('automatic forecast selection - independently by metric and horizon', () => {
  it('defaults to Naive on stable temperature but Holt on rapidly rising humidity before 30 pairs', () => {
    const points = series(Array(7).fill(25), [45, 48, 51, 54, 57, 60, 63]);
    const now = START + mins(6);
    const temp = selectForecastModel(points, 'temperature', 15, now);
    const humidity = selectForecastModel(points, 'humidity', 15, now);
    expect(temp).toMatchObject({ basis: 'fallback', metricStatus: 'normal', model: 'naive', pairs: 0 });
    expect(humidity).toMatchObject({ basis: 'fallback', metricStatus: 'watch', model: 'holt', pairs: 0 });
    expect(temp.explanation).toContain('0/30');
    expect(humidity.explanation).toContain('0/30');
  });

  it('can detect one metric even if the other is invalid in some minute buckets', () => {
    const points = series(Array(7).fill(25), [45, 48, 51, 54, 57, 60, 63]);
    points[4]!.temperature = null;
    const now = START + mins(6);
    expect(evaluateDhtMetricStatus(points, 'temperature', now)).toBe('insufficient');
    expect(evaluateDhtMetricStatus(points, 'humidity', now)).toBe('watch');
    expect(selectForecastModel(points, 'temperature', 15, now).model).toBe('naive');
    expect(selectForecastModel(points, 'humidity', 15, now).model).toBe('holt');
  });

  it('prefers simpler model when temperature MAE differences are below 0.05 °C', () => {
    expect(chooseByMae(rows('temperature', [0.40, 0.37, 0.36]), 'temperature')?.model).toBe('naive');
    expect(chooseByMae(rows('temperature', [0.40, 0.34, 0.33]), 'temperature')?.model).toBe('linear');
    expect(chooseByMae(rows('temperature', [0.40, 0.37, 0.25]), 'temperature')?.model).toBe('holt');
  });

  it('requires minimum gain at exactly the 0.05 °C / 0.2 %RH boundaries', () => {
    expect(chooseByMae(rows('temperature', [0.5, 0.45, 0.45]), 'temperature')?.model).toBe('linear');
    expect(chooseByMae(rows('humidity', [1.5, 1.3, 1.3]), 'humidity')?.model).toBe('linear');
    expect(chooseByMae(rows('humidity', [1.5, 1.35, 1.31]), 'humidity')?.model).toBe('naive');
  });

  it('rejects incomplete comparisons and fewer than 30 common pairs', () => {
    expect(chooseByMae(rows('temperature', [0.2, 0.1, 0.05], 29), 'temperature')).toBeNull();
    const inconsistent = rows('temperature', [0.2, 0.1, 0.05]);
    inconsistent[2]!.pairs = 47;
    expect(chooseByMae(inconsistent, 'temperature')).toBeNull();
  });

  it('blocks stale data after strictly more than five minutes, including manual mode', () => {
    const points = series(Array(7).fill(25));
    const lastAt = START + mins(6) + 10_000;
    expect(selectForecastModel(points, 'temperature', 15, lastAt + mins(5), lastAt).basis).not.toBe('stale');
    const stale = selectForecastModel(points, 'temperature', 15, lastAt + mins(5) + 1, lastAt);
    expect(stale).toMatchObject({ basis: 'stale', mae: null });
    expect(selectForecastModel(points, 'humidity', 30, lastAt + mins(6), lastAt, 'holt').basis).toBe('stale');
    expect(forecastMeasure(points, 'temperature', stale.model, 15, lastAt + mins(6), lastAt).status).toBe('stale');
  });

  it('returns no live prediction when no valid samples are available', () => {
    expect(selectForecastModel([], 'temperature', 15, START)).toMatchObject({ basis: 'insufficient', pairs: 0, mae: null });
  });

  it('uses MAE with at least 30 common historical pairs and reports the error and count', () => {
    const points = series(Array.from({ length: 100 }, (_, i) => 20 + i * 0.08));
    const selection = selectForecastModel(points, 'temperature', 15, START + mins(99));
    expect(selection.basis).toBe('mae');
    expect(selection.pairs).toBeGreaterThanOrEqual(30);
    expect(selection.model).not.toBe('naive');
    expect(selection.mae).not.toBeNull();
    expect(selection.explanation).toContain('MAE');
    expect(selection.explanation).toContain(String(selection.pairs));
  });

  it('evaluates horizons separately; sufficient at +15 can be insufficient at +30', () => {
    const points = series(Array.from({ length: 51 }, (_, i) => 20 + 0.07 * i));
    const now = START + mins(50);
    const short = selectForecastModel(points, 'temperature', 15, now);
    const long = selectForecastModel(points, 'temperature', 30, now);
    expect(short.basis).toBe('mae');
    expect(long.basis).toBe('fallback');
    expect(long.pairs).toBeLessThan(30);
  });

  it('limits humidity to physical 0..100 and uses the humidity MAE threshold', () => {
    const humid = series(Array(100).fill(25), Array.from({ length: 100 }, (_, i) => Math.min(99, 48 + i * 0.8)));
    const now = START + mins(99);
    const selection = selectForecastModel(humid, 'humidity', 15, now);
    expect(selection.basis).toBe('mae');
    expect(selection.mae).not.toBeNull();
    expect(chooseByMae(rows('humidity', [1.2, 1.1, 1.05]), 'humidity')?.model).toBe('naive');
    const result = forecastMeasure(humid, 'humidity', selection.model, 15, now);
    expect(result.status).toBe('eligible');
    expect(result.points.every((point) => point.value >= 0 && point.value <= 100)).toBe(true);
  });

  it('keeps three manual choices independent of the automatic rule', () => {
    const points = series(Array(7).fill(24), [40, 44, 48, 52, 56, 60, 64]);
    const now = START + mins(6);
    for (const model of ['naive', 'linear', 'holt'] as const) {
      expect(selectForecastModel(points, 'temperature', 30, now, undefined, model))
        .toMatchObject({ model, basis: 'manual' });
    }
  });
});
