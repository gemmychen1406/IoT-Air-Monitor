// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import { FORECAST_CONFIG as CFG } from './config.js';
import { fitLine } from './timeseries.js';
import type { MinuteReading } from './types.js';

export interface DhtNotice { title: string; detail: string; level: 'watch' }

/** Robust smoothed rate from 6–7 continuous minutes; 3-point median removes isolated spikes. */
export function smoothedSlope(points: readonly { timestamp: number; value: number | null }[]): number | null {
  const last = points.slice(-7);
  if (last.length < 6 || last.some((point) => point.value === null)) return null;
  if (last.some((point, index) => index > 0 && point.timestamp - last[index - 1]!.timestamp !== CFG.minuteMs)) return null;
  const averaged = last.slice(2).map((point, index) => {
    const sorted = [last[index]!.value!, last[index + 1]!.value!, last[index + 2]!.value!].sort((a, b) => a - b);
    return { timestamp: point.timestamp, value: sorted[1]! };
  });
  return fitLine(averaged)?.slope ?? null;
}

/** Temperature and humidity observations only. No incident creation or cause attribution. */
export function evaluateDhtChange(points: readonly MinuteReading[], nowMs: number): DhtNotice[] {
  const latest = points.findLast((point) => point.temperature !== null && point.humidity !== null);
  if (!latest || nowMs - latest.timestamp > CFG.staleAfterMs + CFG.minuteMs) return [];

  const notices: DhtNotice[] = [];
  const temp = smoothedSlope(points.map((point) => ({ timestamp: point.timestamp, value: point.temperature })));
  const humidity = smoothedSlope(points.map((point) => ({ timestamp: point.timestamp, value: point.humidity })));
  if (temp !== null && Math.abs(temp) >= CFG.temperatureRapidSlope) {
    notices.push({ title: `Nhiệt độ ${temp > 0 ? 'tăng' : 'giảm'} nhanh`,
      detail: `${Math.abs(temp).toFixed(2)} °C/phút trong nhiều phút liên tiếp. Nên kiểm tra nguồn nhiệt hoặc thông gió tại khu vực.`, level: 'watch' });
  }
  if (humidity !== null && Math.abs(humidity) >= CFG.humidityRapidSlope) {
    notices.push({ title: `Độ ẩm ${humidity > 0 ? 'tăng' : 'giảm'} nhanh`,
      detail: `${Math.abs(humidity).toFixed(2)} điểm %RH/phút trong nhiều phút liên tiếp. Nên kiểm tra nhiệt độ và nguồn hơi ẩm tại khu vực.`, level: 'watch' });
  }
  return notices;
}
