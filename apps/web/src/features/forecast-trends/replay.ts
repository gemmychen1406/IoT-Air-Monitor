// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import { forecastBoth } from './forecasting.js';
import { FORECAST_CONFIG as CFG } from './config.js';
import type { ForecastModel, ForecastResult, MinuteReading } from './types.js';

export interface HistoricalReplay {
  originTime: number;
  targetTime: number;
  forecast: ForecastResult;
  actual: { temperature: number | null; humidity: number | null };
}

/** Backtest one past interval. All forecast training ends strictly at originTime. */
export function historicalReplay(points: readonly MinuteReading[], model: ForecastModel, horizon: 15 | 30): HistoricalReplay | null {
  const valid = points.filter((point) => point.temperature !== null && point.humidity !== null);
  const target = valid.at(-1);
  if (!target) return null;
  const originTime = target.timestamp - horizon * CFG.minuteMs;
  const train = valid.filter((point) => point.timestamp <= originTime);
  const origin = train.at(-1);
  if (!origin || train.length < CFG.regressionMinimum || originTime - origin.timestamp > CFG.minuteMs) return null;
  const result = forecastBoth(train, model, horizon, origin.timestamp, origin.timestamp);
  if (result.temperature.status !== 'eligible' || result.humidity.status !== 'eligible') return null;
  if (result.temperature.points.at(-1)?.timestamp !== target.timestamp) return null;
  return {
    originTime: origin.timestamp,
    targetTime: target.timestamp,
    forecast: result,
    actual: { temperature: target.temperature, humidity: target.humidity },
  };
}
