import type { MapThresholds, RoomMapDevice } from '@iot/contracts';
import { sensorFreshness } from '../../lib/freshness.js';

export const mapStatusLabels = {
  danger: 'Sự cố đang mở',
  attention: 'Cần chú ý',
  normal: 'Trong ngưỡng sơ đồ',
  unknown: 'Chưa đánh giá',
};

export const mapConnectionLabels = {
  online: 'Đang kết nối',
  offline: 'Mất kết nối',
  never_seen: 'Chưa từng kết nối',
};

export function mapStatus(
  device: RoomMapDevice,
  thresholds: MapThresholds,
  now: number,
): {
  tone: keyof typeof mapStatusLabels;
  reason: string;
} {
  if (device.open_incidents.length)
    return {
      tone: 'danger',
      reason: `Có ${device.open_incidents.length} sự cố chưa kết thúc. Trạng thái kết nối được hiển thị riêng.`,
    };
  if (device.archived_at)
    return { tone: 'unknown', reason: 'Thiết bị đã lưu trữ.' };
  if (device.status !== 'online')
    return {
      tone: 'unknown',
      reason: `${mapConnectionLabels[device.status]}.`,
    };
  const reading = device.latest;
  const sample = reading?.payload.sensors.dht11;
  if (
    !reading ||
    !sample ||
    sample.quality !== 'valid' ||
    sample.temperature_c === null ||
    sample.humidity_pct === null
  )
    return { tone: 'unknown', reason: 'Thiếu mẫu nhiệt độ và độ ẩm hợp lệ.' };
  const freshness = sensorFreshness(reading, sample.age_ms, now);
  if (freshness !== 'Dữ liệu mới')
    return { tone: 'unknown', reason: `${freshness}.` };
  const crossed = [];
  if (sample.temperature_c >= thresholds.temperature_c)
    crossed.push(`Nhiệt độ ≥ ${thresholds.temperature_c} °C`);
  if (sample.humidity_pct >= thresholds.humidity_pct)
    crossed.push(`Độ ẩm ≥ ${thresholds.humidity_pct} %RH`);
  return crossed.length
    ? {
        tone: 'attention',
        reason: `${crossed.join(' · ')} (ngưỡng hiển thị sơ đồ).`,
      }
    : {
        tone: 'normal',
        reason: 'Nhiệt độ và độ ẩm còn mới, dưới ngưỡng hiển thị sơ đồ.',
      };
}
