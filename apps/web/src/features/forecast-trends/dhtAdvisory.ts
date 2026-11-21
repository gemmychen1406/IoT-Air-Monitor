// Forecast-only assessment of recent valid DHT11 minute buckets.
// The four states below are mutually exclusive; alerts require BOTH sustained
// slope and a large enough end-to-end change, not only a noisy short-term slope.
import { FORECAST_CONFIG as CFG } from './config.js';
import { fitLine } from './timeseries.js';
import type { MinuteReading } from './types.js';

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

/** Six to seven consecutive minute buckets, both temperature and humidity valid. */
function latestContinuousMinutes(points: readonly MinuteReading[]): MinuteReading[] {
  const consecutive: MinuteReading[] = [];
  for (let index = points.length - 1; index >= 0 && consecutive.length < CFG.dhtChangeMaxMinutes; index--) {
    const point = points[index]!;
    if (point.temperature === null || point.humidity === null ||
      !Number.isFinite(point.temperature) || !Number.isFinite(point.humidity) ||
      (consecutive.length && consecutive[0]!.timestamp - point.timestamp !== CFG.minuteMs)) break;
    consecutive.unshift(point);
  }
  return consecutive;
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

  function checkMetric(metric: 'temperature' | 'humidity') {
    const values = consecutive.map((point) => ({ timestamp: point.timestamp, value: point[metric] }));
    const slope = smoothedSlope(values);
    const change = values.at(-1)!.value! - values[0]!.value!;
    const rateThreshold = metric === 'temperature' ? CFG.temperatureRapidSlope : CFG.humidityRapidSlope;
    const amplitudeThreshold = metric === 'temperature' ? CFG.temperatureChangeAmplitude : CFG.humidityChangeAmplitude;
    if (slope === null || Math.abs(slope) < rateThreshold || Math.abs(change) < amplitudeThreshold ||
      Math.sign(slope) !== Math.sign(change)) return;

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
    result.notices.push({
      level: 'watch',
      title: `${label} ${increasing ? 'tăng' : 'giảm'} liên tục`,
      detail: `Tốc độ ${Math.abs(slope).toFixed(2)} ${unit}/phút, tổng thay đổi ${Math.abs(change).toFixed(2)} ${unit} trong ${consecutive.length - 1} phút. ${advice}`,
    });
  }
  checkMetric('temperature');
  checkMetric('humidity');
  result.status = result.notices.length > 0 ? 'watch' : 'normal';
  return result;
}

/** Backward-compatible entry point used by legacy Forecast-only tests. */
export function evaluateDhtChange(points: readonly MinuteReading[], nowMs: number): DhtNotice[] {
  return evaluateDhtAssessment(points, nowMs).notices;
}
