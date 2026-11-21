// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import { FORECAST_CONFIG as CFG } from './config.js';
import { fitLine, latestValid } from './timeseries.js';
import type { ForecastModel, ForecastResult, Measure, MeasureForecast, MinuteReading } from './types.js';

export function predictAt(
  points: readonly MinuteReading[], metric: Measure, model: ForecastModel,
  originTime: number, targetTime: number,
): number | null {
  // The training cutoff is explicit. A caller can pass the complete history
  // without accidentally training on future observations during backtesting.
  if (targetTime <= originTime) return null;
  const observed = points.filter((p) => p[metric] !== null && p.timestamp <= originTime)
    .map((p) => ({ timestamp: p.timestamp, value: p[metric] as number }))
    .sort((a, b) => a.timestamp - b.timestamp);
  const last = observed.at(-1);
  if (!last || targetTime <= last.timestamp) return null;
  const recent = observed.filter((point) => point.timestamp >= last.timestamp - CFG.trendMinutes * CFG.minuteMs);
  if (model === 'naive') return last.value;
  if (recent.length < CFG.regressionMinimum) return null;
  let value: number;
  if (model === 'linear') {
    const fit = fitLine(recent);
    if (!fit) return null;
    value = fit.intercept + fit.slope * ((targetTime - fit.origin) / CFG.minuteMs);
  } else {
    // First two observations initialize level and trend; do not update the second one twice.
    // Trend has units per minute, including when observations are irregularly spaced.
    let level = recent[0]!.value;
    let prevTime = recent[1]!.timestamp;
    const firstDelta = (prevTime - recent[0]!.timestamp) / CFG.minuteMs;
    if (firstDelta <= 0) return null;
    let trend = (recent[1]!.value - level) / firstDelta;
    level = recent[1]!.value;
    for (let i = 2; i < recent.length; i++) {
      const point = recent[i]!;
      const delta = (point.timestamp - prevTime) / CFG.minuteMs;
      if (delta <= 0) return null;
      const previousLevel = level;
      level = CFG.holtAlpha * point.value + (1 - CFG.holtAlpha) * (level + trend * delta);
      trend = CFG.holtBeta * ((level - previousLevel) / delta) + (1 - CFG.holtBeta) * trend;
      prevTime = point.timestamp;
    }
    value = level + trend * ((targetTime - last.timestamp) / CFG.minuteMs);
  }
  if (!Number.isFinite(value)) return null;
  return metric === 'humidity' ? Math.max(0, Math.min(100, value)) : value;
}

export function forecastMeasure(
  points: readonly MinuteReading[], metric: Measure, model: ForecastModel,
  horizonMinutes: 15 | 30, nowMs: number, actualSampleAt?: number | null,
): MeasureForecast {
  const last = latestValid(points.filter((p) => p.timestamp <= nowMs), metric);
  if (!last) return { status: 'insufficient', reason: 'Chưa có số đo hợp lệ.', lastSampleAt: null, current: null, points: [] };
  if (nowMs - (actualSampleAt ?? last.timestamp) > CFG.staleAfterMs) {
    return { status: 'stale', reason: 'Dữ liệu cũ quá 5 phút; tạm khóa dự báo.', lastSampleAt: last.timestamp, current: last.value, points: [] };
  }
  const training = points.filter((p) => p.timestamp <= last.timestamp && p[metric] !== null && p.timestamp >= last.timestamp - CFG.trendMinutes * CFG.minuteMs);
  if (model !== 'naive' && training.length < CFG.regressionMinimum) {
    return { status: 'insufficient', reason: `Cần ít nhất ${CFG.regressionMinimum} phút có số đo hợp lệ cho ${model === 'holt' ? 'Holt' : 'hồi quy'}.`, lastSampleAt: last.timestamp, current: last.value, points: [] };
  }
  const output = [];
  for (let minute = 1; minute <= horizonMinutes; minute++) {
    const timestamp = last.timestamp + minute * CFG.minuteMs;
    const value = predictAt(training, metric, model, last.timestamp, timestamp);
    if (value === null) {
      return { status: 'calculation_error', reason: 'Không thể tính dự báo từ chuỗi hiện tại.', lastSampleAt: last.timestamp, current: last.value, points: [] };
    }
    output.push({ timestamp, value });
  }
  return { status: 'eligible', reason: null, lastSampleAt: last.timestamp, current: last.value, points: output };
}

export function forecastBoth(points: readonly MinuteReading[], model: ForecastModel, horizon: 15 | 30, nowMs: number, actualSampleAt?: number | null): ForecastResult {
  return {
    temperature: forecastMeasure(points, 'temperature', model, horizon, nowMs, actualSampleAt),
    humidity: forecastMeasure(points, 'humidity', model, horizon, nowMs, actualSampleAt),
  };
}
