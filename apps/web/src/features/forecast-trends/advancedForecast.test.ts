import { describe, expect, it } from 'vitest';
import { advancedForecast } from './advancedForecast.js';
import { compareAdvancedCurves } from './curveValidation.js';
import { forecastMeasure } from './forecasting.js';
import { selectForecastModel } from './modelSelection.js';
import { normalizeReadings } from './timeseries.js';
import { reading, series, START, mins } from './testHelpers.js';

const cyclic = (length: number) => series(
  Array.from({ length }, (_, i) => 27 + Math.sin(i * 2 * Math.PI / 15)),
  Array.from({ length }, (_, i) => 60 + 2 * Math.cos(i * 2 * Math.PI / 15)),
);

describe('advanced Forecast: no made-up future data', () => {
  it('rejects seasonal prediction when the source has no repeating seasonal amplitude', () => {
    const points = series(Array(160).fill(25), Array(160).fill(65));
    expect(advancedForecast(points, 'temperature', 'holt_winters', START + mins(159), 30)).toBeNull();
  });

  it('Holt-Winters can forecast a stable observed cycle as a NON-straight curve', () => {
    const points = cyclic(180);
    const curve = advancedForecast(points, 'temperature', 'holt_winters', START + mins(179), 30);
    expect(curve?.length).toBe(30);
    expect(new Set(curve!.map((value) => value.toFixed(2))).size).toBeGreaterThan(8);
  });

  it('random forest trains on 50 complete sliding windows, not a few recent samples', () => {
    const short = cyclic(85);
    expect(advancedForecast(short, 'temperature', 'random_forest', START + mins(84), 30)).toBeNull();
    const longer = cyclic(160);
    const curve = advancedForecast(longer, 'temperature', 'random_forest', START + mins(159), 30);
    expect(curve).toHaveLength(30);
    expect(curve!.every(Number.isFinite)).toBe(true);
  });

  it('ignores future observations strictly after the forecast origin', () => {
    const points = cyclic(200);
    const origin = START + mins(159);
    const before = advancedForecast(points.slice(0, 160), 'temperature', 'random_forest', origin, 15);
    // Future history is deliberately different; it cannot affect the past forecast.
    const contaminated = points.map((point, i) => i < 160 ? point : { ...point, temperature: 99, humidity: 99 });
    const after = advancedForecast(contaminated, 'temperature', 'random_forest', origin, 15);
    expect(after).toEqual(before);
  });

  it('chooses the periodic model only when its multi-step MAE beats the best baseline', () => {
    const points = cyclic(210);
    const score = compareAdvancedCurves(points, 'temperature', 30, 'holt_winters', 20, 50);
    expect(score.pairs).toBeGreaterThanOrEqual(8);
    expect(score.mae!).toBeLessThan(score.comparisonMae!);
    const choice = selectForecastModel(points, 'temperature', 30, START + mins(209));
    expect(choice.model).toBe('holt_winters');
    expect(choice.explanation).toContain('MAE đa mốc');
  });

  it('anchors live forecast to the most recent accepted raw DHT11 reading', () => {
    const history = normalizeReadings([
      reading(0, 25, 60), reading(0, 26, 61, { at: START + 30_000 }),
      reading(1, 26, 60), reading(2, 27, 61), reading(3, 28, 62),
      reading(4, 29, 63), reading(5, 30, 64, { at: START + mins(5) + 30_000 }),
    ], START + mins(6));
    const raw = history.latestSample!;
    const forecast = forecastMeasure(history.points, 'temperature', 'naive', 15, raw.timestamp,
      raw.timestamp, raw.temperature);
    expect(forecast.current).toBe(raw.temperature);
    expect(forecast.lastSampleAt).toBe(raw.timestamp);
    expect(forecast.points.at(-1)?.value).toBe(raw.temperature);
  });
});
