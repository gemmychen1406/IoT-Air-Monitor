// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import { FORECAST_CONFIG as CFG } from './config.js';
import type { Measure, MeasureForecast, MinuteReading } from './types.js';

/**
 * Do not include missing buckets before the first actual measurement on the chart.
 * Interior gaps remain visible as gaps; no data is fabricated or interpolated.
 */
export function trimEmptyStart<T extends { temperature: number | null; humidity: number | null }>(
  points: readonly T[],
): T[] {
  const first = points.findIndex((point) => point.temperature !== null || point.humidity !== null);
  return first < 0 ? [] : points.slice(first);
}

export interface ForecastChartPoint {
  timestamp: number;
  actual: number | null;
  predicted: number | null;
}

export interface ForecastTimeline {
  origin: number;
  forecastEnd: number;
  ticks: number[];
  data: ForecastChartPoint[];
}

/**
 * The forecast X axis starts at the measurement used as the forecast origin.
 * Historical observations BEFORE that instant are deliberately excluded.
 * In replay mode only, actual observations AFTER origin are shown for comparison.
 */
export function forecastTimeline(
  history: readonly MinuteReading[],
  metric: Measure,
  forecast: MeasureForecast,
  replay: boolean,
): ForecastTimeline | null {
  const origin = forecast.lastSampleAt;
  const lastPrediction = forecast.points.at(-1);
  if (forecast.status !== 'eligible' || origin === null || !lastPrediction ||
    !Number.isFinite(origin) || !Number.isFinite(lastPrediction.timestamp) ||
    lastPrediction.timestamp <= origin) return null;

  const forecastEnd = lastPrediction.timestamp;
  const entries = new Map<number, ForecastChartPoint>();
  // First visible point = the latest known measurement (or replay origin).
  entries.set(origin, { timestamp: origin, actual: forecast.current, predicted: forecast.current });

  if (replay) {
    for (const observation of history) {
      if (observation.timestamp <= origin || observation.timestamp > forecastEnd) continue;
      entries.set(observation.timestamp, {
        timestamp: observation.timestamp,
        actual: observation[metric],
        predicted: null,
      });
    }
  }

  for (const prediction of forecast.points) {
    if (prediction.timestamp <= origin || prediction.timestamp > forecastEnd) continue;
    const row = entries.get(prediction.timestamp) ?? {
      timestamp: prediction.timestamp, actual: null, predicted: null,
    };
    row.predicted = prediction.value;
    entries.set(prediction.timestamp, row);
  }

  const ticks = [origin];
  for (let time = origin + 5 * CFG.minuteMs; time < forecastEnd; time += 5 * CFG.minuteMs) {
    ticks.push(time);
  }
  ticks.push(forecastEnd);

  return {
    origin,
    forecastEnd,
    ticks,
    data: [...entries.values()].sort((a, b) => a.timestamp - b.timestamp),
  };
}
