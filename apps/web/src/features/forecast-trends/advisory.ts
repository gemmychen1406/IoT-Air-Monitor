// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import { FORECAST_CONFIG as CFG } from './config.js';
import { evaluateDhtMetricStatus } from './dhtAdvisory.js';
import type { Advisory, ForecastResult, MinuteReading, TrendResult } from './types.js';

/** Temperature/humidity trend advisory; not an incident classification system. */
export function evaluateAdvisory(
  points: readonly MinuteReading[], temperature: TrendResult, humidity: TrendResult, forecast: ForecastResult,
): Advisory {
  if (temperature.status === 'stale' || humidity.status === 'stale' ||
      temperature.status === 'insufficient' || humidity.status === 'insufficient') {
    return { level: 'unavailable', title: 'Chưa đủ dữ liệu mới', details: ['Không đưa ra nhận định khi dữ liệu cũ hoặc chưa đủ mẫu.'] };
  }
  const details: string[] = [];
  const tempWatch = evaluateDhtMetricStatus(points, 'temperature', temperature.lastSampleAt ?? 0, temperature.lastSampleAt);
  const humidityWatch = evaluateDhtMetricStatus(points, 'humidity', humidity.lastSampleAt ?? 0, humidity.lastSampleAt);
  if (tempWatch === 'watch') details.push('Nhiệt độ có biến động liên tục được ghi nhận trong 6–7 phút vừa qua (không phải kết quả dự báo).');
  if (humidityWatch === 'watch') details.push('Độ ẩm có biến động liên tục được ghi nhận trong 6–7 phút vừa qua (không phải kết quả dự báo).');
  if (temperature.current !== null && (temperature.current < CFG.referenceTemperature[0] || temperature.current > CFG.referenceTemperature[1])) {
    details.push(`Nhiệt độ hiện tại nằm ngoài vùng tham chiếu ${CFG.referenceTemperature.join('–')}°C.`);
  }
  if (humidity.current !== null && (humidity.current < CFG.referenceHumidity[0] || humidity.current > CFG.referenceHumidity[1])) {
    details.push(`Độ ẩm hiện tại nằm ngoài vùng tham chiếu ${CFG.referenceHumidity.join('–')}%RH.`);
  }
  for (const metric of ['temperature', 'humidity'] as const) {
    const prediction = forecast[metric];
    if (prediction.status !== 'eligible') continue;
    const range = metric === 'temperature' ? CFG.referenceTemperature : CFG.referenceHumidity;
    const crosses = prediction.points.find((point) => point.value < range[0] || point.value > range[1]);
    if (crosses) details.push(`${metric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm'} dự báo có thể vượt vùng tham chiếu trong ${Math.round((crosses.timestamp - prediction.lastSampleAt!) / CFG.minuteMs)} phút.`);
  }
  if (!details.length) return { level: 'normal', title: 'Chưa phát hiện biến động đáng chú ý', details: [] };
  return { level: 'watch', title: 'Biến động ghi nhận gần đây hoặc dự báo vượt vùng tham chiếu', details };
}
