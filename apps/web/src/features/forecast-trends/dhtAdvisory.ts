// Forecast-only assessment of recent valid DHT11 minute buckets.
// The four overall states are mutually exclusive. "watch" covers either a
// confirmed short-window change or a sustained trend; neither means fire.
import { FORECAST_CONFIG as CFG } from './config.js';
import { fitLine } from './timeseries.js';
import type { Measure, MinuteReading, TrendResult } from './types.js';

export type DhtAssessmentStatus = 'stale' | 'insufficient' | 'normal' | 'checking' | 'watch';
export interface DhtNotice { title: string; detail: string; level: 'watch' }
export interface DhtAssessment {
  status: DhtAssessmentStatus;
  validMinutes: number;
  requiredMinutes: number;
  notices: DhtNotice[];
  pendingMetrics: Measure[]; // large latest jump, not yet confirmed by another reading
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

/**
 * Detect a recent step/ramp with three REAL consecutive minute buckets.
 * The middle bucket must already move toward the new value; a single last
 * outlier is not yet a confirmed change. A large reversal is rejected too.
 * This only assesses measured DHT11 values, not fire/smoke/gas sensors.
 */
function suddenMetricNotice(consecutive: readonly MinuteReading[], metric: Measure): DhtNotice | null {
  if (consecutive.length < 3) return null;
  const last = consecutive.slice(-3);
  const first = last[0]![metric];
  const middle = last[1]![metric];
  const final = last[2]![metric];
  if (first === null || middle === null || final === null) return null;
  const change = final - first;
  const threshold = metric === 'temperature' ? CFG.temperatureSuddenAmplitude : CFG.humiditySuddenAmplitude;
  if (Math.abs(change) < threshold) return null;
  const direction = Math.sign(change);
  const middleProgress = (middle - first) * direction;
  const finalProgress = (final - middle) * direction;
  if (middleProgress < Math.abs(change) / 4 || finalProgress < -Math.abs(change) / 4) return null;
  const label = metric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm';
  const unit = metric === 'temperature' ? '°C' : 'điểm %RH';
  const increasing = change > 0;
  const action = metric === 'temperature'
    ? increasing ? 'Kiểm tra nguồn nhiệt, thiết bị và thông gió.' : 'Kiểm tra luồng khí mát, điều hòa và vị trí cảm biến.'
    : increasing ? 'Kiểm tra nguồn hơi ẩm, nước và thông gió.' : 'Kiểm tra nguồn ẩm và hệ thống hút ẩm.';
  return {
    level: 'watch',
    title: `${label} ${increasing ? 'tăng' : 'giảm'} nhanh`,
    detail: `Thay đổi ${Math.abs(change).toFixed(1)} ${unit} trong 2 phút, có mẫu xác nhận. ${action}`,
  };
}

/** Flag an unconfirmed one-minute jump as 'checking', not as normal or a verified alert.
 * This is deliberately not a watch notice: a single bad sensor sample can cause it.
 */
function pendingJump(consecutive: readonly MinuteReading[], metric: Measure): boolean {
  if (consecutive.length < 2) return false;
  const prev = consecutive.at(-2)![metric];
  const last = consecutive.at(-1)![metric];
  const threshold = metric === 'temperature' ? CFG.temperatureSuddenAmplitude : CFG.humiditySuddenAmplitude;
  return typeof prev === 'number' && Number.isFinite(prev) &&
    typeof last === 'number' && Number.isFinite(last) && Math.abs(last - prev) >= threshold;
}

/** Long-window change requires both slope and full-window amplitude. */
function sustainedMetricNotice(consecutive: readonly MinuteReading[], metric: Measure): DhtNotice | null {
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

/** Keep a recently CONFIRMED rapid change visible for a few further samples.
 * A spike-and-plateau should not immediately revert to 'normal' next minute.
 * The 6–7-minute rolling window automatically retires old observations.
 */
function metricNotice(consecutive: readonly MinuteReading[], metric: Measure): DhtNotice | null {
  const sustained = sustainedMetricNotice(consecutive, metric);
  if (sustained) return sustained;
  for (let end = consecutive.length; end >= 3; end--) {
    const triple = consecutive.slice(end - 3, end);
    const confirmed = suddenMetricNotice(triple, metric);
    if (!confirmed) continue;
    // Reject a 'return to baseline' after a single extreme sample. E.g.
    // 25, 25, 30, 25, 25 is one transient spike, not a rapid cooling event.
    if (end >= 4) {
      const before = consecutive[end - 4]![metric];
      const first = triple[0]![metric];
      const last = triple[2]![metric];
      const threshold = metric === 'temperature' ? CFG.temperatureSuddenAmplitude : CFG.humiditySuddenAmplitude;
      if (before !== null && first !== null && last !== null &&
        Math.abs(first - before) >= threshold && Math.abs(last - before) <= threshold / 4) continue;
    }
    return confirmed;
  }
  return null;
}

/**
 * Used by the automatic forecaster. Each metric is checked independently,
 * using the same rapid (3-minute-sample) and sustained (6–7-minute) rules.
 */
export function evaluateDhtMetricStatus(
  points: readonly MinuteReading[], metric: Measure, nowMs: number, latestSampleAt?: number | null,
): DhtAssessmentStatus {
  const latest = [...points].reverse().find((point) => point[metric] !== null && Number.isFinite(point[metric]));
  const actualLastAt = latestSampleAt ?? latest?.timestamp ?? null;
  if (actualLastAt !== null && nowMs - actualLastAt > CFG.staleAfterMs) return 'stale';
  const consecutive = latestContinuousMinutes(points, metric);
  if (metricNotice(consecutive, metric)) return 'watch';
  if (pendingJump(consecutive, metric)) return 'checking';
  return consecutive.length < CFG.dhtChangeMinMinutes ? 'insufficient' : 'normal';
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
    pendingMetrics: [],
  };
  if (actualLastAt !== null && nowMs - actualLastAt > CFG.staleAfterMs) {
    return { ...result, status: 'stale' };
  }
  // Evaluate each metric independently, even if the other DHT11 field is missing.
  // A single fresh outlier is only a provisional observation until confirmed.
  for (const metric of ['temperature', 'humidity'] as const) {
    const metricMinutes = latestContinuousMinutes(points, metric);
    const notice = metricNotice(metricMinutes, metric);
    if (notice) result.notices.push(notice);
    else if (pendingJump(metricMinutes, metric)) result.pendingMetrics.push(metric);
  }
  result.status = result.notices.length > 0 ? 'watch'
    : result.pendingMetrics.length > 0 ? 'checking'
    : consecutive.length < CFG.dhtChangeMinMinutes ? 'insufficient' : 'normal';
  return result;
}

/** Backward-compatible entry point used by legacy Forecast-only tests. */
export function evaluateDhtChange(points: readonly MinuteReading[], nowMs: number): DhtNotice[] {
  return evaluateDhtAssessment(points, nowMs).notices;
}

/** Short, factual guidance. A 30-minute trend is descriptive; rapid and
 * sustained notices are independent observations from the recent minutes. */
export function describeDhtTrend(
  metric: Measure, trend: TrendResult, assessment: DhtAssessment,
): string {
  const label = metric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm';
  if (assessment.status === 'stale' || trend.status === 'stale')
    return `${label}: dữ liệu đã cũ; kiểm tra kết nối và chờ mẫu mới.`;
  const alert = assessment.notices.find((notice) => notice.title.startsWith(label));
  if (alert) {
    const increasing = alert.title.includes('tăng');
    const action = metric === 'temperature'
      ? increasing ? 'kiểm tra nguồn nhiệt và thông gió' : 'kiểm tra điều hòa và luồng khí mát'
      : increasing ? 'kiểm tra nguồn ẩm và thông gió' : 'kiểm tra nguồn ẩm và hệ thống hút ẩm';
    return `${alert.title} vượt ngưỡng; ${action}.`;
  }
  if (assessment.pendingMetrics.includes(metric))
    return `${label} vừa thay đổi mạnh ở mẫu mới nhất; đang chờ số đo tiếp theo để xác nhận. Kiểm tra cảm biến nếu bất thường kéo dài.`;
  if (trend.status === 'insufficient')
    return `${label}: chưa đủ mẫu liên tục để kết luận xu hướng 30 phút; kiểm tra dữ liệu cảm biến.`;
  if (trend.status === 'increasing' || trend.status === 'decreasing') {
    const up = trend.status === 'increasing';
    const action = metric === 'temperature'
      ? up ? 'kiểm tra nguồn nhiệt và thông gió' : 'kiểm tra điều hòa và luồng khí mát'
      : up ? 'kiểm tra nguồn hơi ẩm và thông gió' : 'kiểm tra hệ thống thông gió và nguồn ẩm';
    return `${label} có xu hướng ${up ? 'tăng' : 'giảm'} trong 30 phút; ${action}. Chưa ghi nhận biến động liên tục vượt ngưỡng.`;
  }
  const slightSlope = trend.slopePerMinute;
  const noiseFloor = (metric === 'temperature' ? CFG.temperatureStableSlope : CFG.humidityStableSlope) / 4;
  if (slightSlope !== null && Math.abs(slightSlope) >= noiseFloor) {
    const increasing = slightSlope > 0;
    const action = metric === 'temperature'
      ? increasing ? 'kiểm tra nguồn nhiệt nếu xu hướng kéo dài' : 'kiểm tra điều hòa nếu tiếp tục giảm'
      : increasing ? 'kiểm tra nguồn ẩm nếu tiếp tục tăng' : 'kiểm tra thông gió nếu tiếp tục giảm';
    return `${label} biến thiên nhẹ theo hướng ${increasing ? 'tăng' : 'giảm'} (chưa vượt ngưỡng xu hướng); ${action}.`;
  }
  return `${label} chưa có xu hướng tăng/giảm rõ trong 30 phút; tiếp tục theo dõi số đo.`;
}
