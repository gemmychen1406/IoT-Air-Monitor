import { describe, expect, it } from 'vitest';
import { chooseByMae, describeMaeChoice, selectForecastModel } from './modelSelection.js';
import { walkForward } from './validation.js';
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
    expect(temp.explanation).toContain('chưa đủ mốc đối chiếu');
    expect(humidity.explanation).toContain('chưa đủ mốc đối chiếu');
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

  it('does not claim lowest MAE if tie-break selects a slightly worse simple model', () => {
    const historical = rows('temperature', [0.40, 0.37, 0.36]);
    const picked = chooseByMae(historical, 'temperature')!;
    expect(picked.model).toBe('naive');
    const reason = describeMaeChoice(picked, historical, 'temperature', 15);
    expect(reason).toContain('MAE gần mức thấp nhất');
    expect(reason).not.toContain('MAE thấp nhất');
    expect(reason).toContain('48 mốc +15 phút');
  });

  it('reports lowest MAE only when the chosen model actually has the minimum', () => {
    const historical = rows('humidity', [3.0, 2.5, 1.5]);
    const picked = chooseByMae(historical, 'humidity')!;
    const reason = describeMaeChoice(picked, historical, 'humidity', 30);
    expect(picked.model).toBe('holt');
    expect(reason).toContain('MAE thấp nhất');
    expect(reason).toContain('1,50 %RH');
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
    expect(selection.basis).toBe('recent_mae');
    expect(selection.pairs).toBeGreaterThanOrEqual(6);
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
    expect(short.basis).toBe('recent_mae');
    expect(long.basis).toBe('recent_mae');
    expect(long.pairs).toBeGreaterThanOrEqual(6);
  });

  it('limits humidity to physical 0..100 and uses the humidity MAE threshold', () => {
    const humid = series(Array(100).fill(25), Array.from({ length: 100 }, (_, i) => Math.min(99, 48 + i * 0.8)));
    const now = START + mins(99);
    const selection = selectForecastModel(humid, 'humidity', 15, now);
    expect(selection.basis).toBe('recent_mae');
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

describe('recent completed MAE comparisons at the requested horizon', () => {
  it('switches to Linear when the last 20 completed comparisons follow a new increasing regime', () => {
    // Older readings oscillate around 25C, newer readings rise steadily.
    // The historical majority favours Naive, but recent +15-min errors favour Linear.
    const temps = Array.from({ length: 145 }, (_, i) =>
      i < 130 ? 25 + 0.3 * Math.sin(i / 9) : 25 + (i - 130) * 0.08);
    const points = series(temps);
    const current = START + mins(temps.length - 1);
    const full = walkForward(points, 'temperature', 15);
    const recent = walkForward(points, 'temperature', 15, undefined, {
      minTargetAt: current - mins(20), maxPairs: 20,
    });
    expect(recent.every(row => row.pairs >= 6 && row.pairs <= 20)).toBe(true);
    expect(chooseByMae(full, 'temperature')?.model).toBe('naive');
    expect(chooseByMae(recent, 'temperature', 6)?.model).toBe('linear');
    const selection = selectForecastModel(points, 'temperature', 15, current);
    // Multi-step MAE favours Holt across +5/+10/+15 here even though
    // the original endpoint-only MAE ranks Linear first.
    expect(selection).toMatchObject({ basis: 'recent_mae', model: 'holt', horizon: 15 });
    expect(selection.explanation).toContain('mốc gần nhất ở khoảng +15 phút');
  });

  it('uses full-history MAE when the last 20 minutes contain fewer than 6 completed pairs', () => {
    const earlier = series(Array.from({ length: 100 }, (_, i) => 25 + 0.4 * Math.sin(i / 5)));
    const later = series([26, 26.1, 26.1, 26.2, 26.3], undefined, START + mins(180));
    const points = [...earlier, ...later];
    const now = START + mins(184);
    const recent = walkForward(points, 'temperature', 15, undefined, {
      minTargetAt: now - mins(20), maxPairs: 20,
    });
    expect(recent[0]?.pairs).toBeLessThan(6);
    const full = walkForward(points, 'temperature', 15);
    expect(full[0]!.pairs).toBeGreaterThanOrEqual(30);
    const selected = selectForecastModel(points, 'temperature', 15, now);
    expect(selected.basis).toBe('mae');
    expect(selected.pairs).toBe(full[0]?.pairs);
    expect(selected.explanation).not.toContain('mốc gần nhất');
  });

  it('uses fallback for insufficient recent and historical pairs, independently by metric', () => {
    const points = series(Array(7).fill(24), [45, 48, 51, 54, 57, 60, 63]);
    const now = START + mins(6);
    expect(selectForecastModel(points, 'temperature', 30, now)).toMatchObject({ basis: 'fallback', model: 'naive' });
    expect(selectForecastModel(points, 'humidity', 30, now)).toMatchObject({ basis: 'fallback', model: 'holt' });
  });

  it('uses the same prediction horizon for both recent and full history, never +5 for +30', () => {
    const points = series(Array.from({ length: 100 }, (_, i) => 23 + 0.3 * Math.sin(i / 7)));
    const selection = selectForecastModel(points, 'temperature', 30, START + mins(99));
    expect(selection.horizon).toBe(30);
    expect(selection.explanation).toContain('+30 phút');
    const recent = walkForward(points, 'temperature', 30, undefined, {
      minTargetAt: START + mins(79), maxPairs: 20,
    });
    expect(recent[0]?.pairs).toBeGreaterThanOrEqual(6);
    expect(recent[0]?.horizon).toBe(30);
  });
});
