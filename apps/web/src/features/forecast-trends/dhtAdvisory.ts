// Forecast-only assessment of recent valid DHT11 minute buckets.
// The four states below are mutually exclusive; alerts require BOTH sustained
// slope and a large enough end-to-end change, not only a noisy short-term slope.
import { FORECAST_CONFIG as CFG } from './config.js';
import { fitLine } from './timeseries.js';
import type { Measure, MinuteReading } from './types.js';

export type DhtAssessmentStatus = 'stale' | 'insufficient' | 'normal' | 'watch';
export interface DhtNotice { title: string; detail: string; level: 'watch' }
export interface DhtAssessment {
  status: DhtAssessmentStatus;
  validMinutes: number;
  requiredMinutes: number;
  notices: DhtNotice[];
}

/** Median-of-three smoothing before linear regression; no interpolation across missing minutes. */
export function smoothedSlope(points: readonly { timestamp: number; value: number | null }[]): number | null {
  const last = points.slice(-CFG.dhtChangeMaxMinutes);
  if (last.length < CFG.dhtChangeMinMinutes || last.some((point) => point.value === null)) return null;
  if (last.some((point, index) => index > 0 && point.timestamp - last[index - 1]!.timestamp !== CFG.minuteMs)) return null;
  const averaged = last.slice(2).map((point, index) => {
    const sorted = [last[index]!.value!, last[index + 1]!.value!, last[index + 2]!.value!].sort((a, b) => a - b);
    return { timestamp: point.timestamp, value: sorted[1]! };
  });
  return fitLine(averaged)?.slope ?? null;
}

/**
 * Six to seven consecutive minute buckets. When metric is omitted, require
 * both sensors as the existing Tab 1 overall status does.
 */
function latestContinuousMinutes(points: readonly MinuteReading[], metric?: Measure): MinuteReading[] {
  const consecutive: MinuteReading[] = [];
  for (let index = points.length - 1; index >= 0 && consecutive.length < CFG.dhtChangeMaxMinutes; index--) {
    const point = points[index]!;
    const valid = metric
      ? point[metric] !== null && Number.isFinite(point[metric])
      : point.temperature !== null && point.humidity !== null &&
        Number.isFinite(point.temperature) && Number.isFinite(point.humidity);
    if (!valid || (consecutive.length && consecutive[0]!.timestamp - point.timestamp !== CFG.minuteMs)) break;
    consecutive.unshift(point);
  }
  return consecutive;
}

/** Single source of truth for the Tab 1 notices and per-metric fallback. */
function metricNotice(consecutive: readonly MinuteReading[], metric: Measure): DhtNotice | null {
  if (consecutive.length < CFG.dhtChangeMinMinutes) return null;
  const values = consecutive.map((point) => ({ timestamp: point.timestamp, value: point[metric] }));
  const slope = smoothedSlope(values);
  const change = values.at(-1)!.value! - values[0]!.value!;
  const rateThreshold = metric === 'temperature' ? CFG.temperatureRapidSlope : CFG.humidityRapidSlope;
  const amplitudeThreshold = metric === 'temperature' ? CFG.temperatureChangeAmplitude : CFG.humidityChangeAmplitude;
  if (slope === null || Math.abs(slope) < rateThreshold || Math.abs(change) < amplitudeThreshold ||
    Math.sign(slope) !== Math.sign(change)) return null;

  const increasing = slope > 0;
  const label = metric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm';
  const unit = metric === 'temperature' ? '°C' : 'điểm %RH';
  const advice = metric === 'temperature'
    ? increasing
      ? 'Nhiệt độ đang tăng; nên kiểm tra nguồn nhiệt và điều kiện thông gió tại khu vực.'
      : 'Nhiệt độ đang giảm; nên kiểm tra luồng khí mát, điều hòa hoặc thông gió tại khu vực.'
    : increasing
      ? 'Không khí đang ẩm hơn; nên kiểm tra nguồn hơi nước và thông gió tại khu vực.'
      : 'Không khí đang khô dần; có thể liên quan đến thông gió tăng hoặc nguồn hơi ẩm giảm, cần đối chiếu điều kiện thực tế.';
  return {
    level: 'watch',
    title: `${label} ${increasing ? 'tăng' : 'giảm'} liên tục`,
    detail: `Tốc độ ${Math.abs(slope).toFixed(2)} ${unit}/phút, tổng thay đổi ${Math.abs(change).toFixed(2)} ${unit} trong ${consecutive.length - 1} phút. ${advice}`,
  };
}

/**
 * Used by the automatic forecaster. Unlike the overall Tab 1 state, each
 * metric is evaluated independently but with exactly the same slope/amplitude
 * thresholds and 6–7 minute continuity rule.
 */
export function evaluateDhtMetricStatus(
  points: readonly MinuteReading[], metric: Measure, nowMs: number, latestSampleAt?: number | null,
): DhtAssessmentStatus {
  const latest = [...points].reverse().find((point) => point[metric] !== null && Number.isFinite(point[metric]));
  const actualLastAt = latestSampleAt ?? latest?.timestamp ?? null;
  if (actualLastAt !== null && nowMs - actualLastAt > CFG.staleAfterMs) return 'stale';
  const consecutive = latestContinuousMinutes(points, metric);
  if (consecutive.length < CFG.dhtChangeMinMinutes) return 'insufficient';
  return metricNotice(consecutive, metric) ? 'watch' : 'normal';
}

/**
 * The exact latestSampleAt (not the floored minute bucket) determines staleness.
 * It is deliberately passed from normalized DHT11 history; invalid sensor samples
 * cannot keep an old trend classified as current.
 */
export function evaluateDhtAssessment(
  points: readonly MinuteReading[], nowMs: number, latestSampleAt?: number | null,
): DhtAssessment {
  const latest = points.findLast((point) => point.temperature !== null && point.humidity !== null);
  const actualLastAt = latestSampleAt ?? latest?.timestamp ?? null;
  const consecutive = latestContinuousMinutes(points);
  const result: DhtAssessment = {
    status: 'insufficient',
    validMinutes: consecutive.length,
    requiredMinutes: CFG.dhtChangeMinMinutes,
    notices: [],
  };
  if (actualLastAt !== null && nowMs - actualLastAt > CFG.staleAfterMs) {
    return { ...result, status: 'stale' };
  }
  if (consecutive.length < CFG.dhtChangeMinMinutes) return result;

  const temperatureNotice = metricNotice(consecutive, 'temperature');
  const humidityNotice = metricNotice(consecutive, 'humidity');
  if (temperatureNotice) result.notices.push(temperatureNotice);
  if (humidityNotice) result.notices.push(humidityNotice);
  result.status = result.notices.length > 0 ? 'watch' : 'normal';
  return result;
}

/** Backward-compatible entry point used by legacy Forecast-only tests. */
export function evaluateDhtChange(points: readonly MinuteReading[], nowMs: number): DhtNotice[] {
  return evaluateDhtAssessment(points, nowMs).notices;
}
