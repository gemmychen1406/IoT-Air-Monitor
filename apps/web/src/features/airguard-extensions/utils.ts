import type { AnalyticsView, DeviceView, StatusView } from '@iot/contracts';
import type { DeviceHealth, Metric, RangeInput } from './types.js';

export function defaultRange(): RangeInput {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const local = (date: Date) => {
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
  };
  return { from: local(from), to: local(to), bucket: 'hour' };
}

export function rangeParams(range: RangeInput, metric?: Metric) {
  const from = new Date(range.from);
  const to = new Date(range.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to)
    throw new Error('Khoảng thời gian không hợp lệ.');
  if (to.getTime() - from.getTime() > 90 * 86400000)
    throw new Error('Khoảng thời gian tối đa là 90 ngày.');
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    time_basis: 'received',
  });
  if (metric) {
    params.set('metric', metric);
    params.set('bucket', range.bucket);
  }
  return params;
}

export function formatNumber(value: number | null, unit = '') {
  return value === null ? 'Không có dữ liệu' : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)} ${unit}`.trim();
}

export function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('vi-VN') : 'Chưa từng gửi dữ liệu';
}

export function analyticsHasData(value: AnalyticsView | undefined) {
  return !!value && value.summary.valid_count > 0;
}

export function assessHealth(device: DeviceView, history: StatusView[], now = Date.now()): DeviceHealth {
  const lastSeen = device.last_seen_at ? Date.parse(device.last_seen_at) : NaN;
  const ageMs = Number.isFinite(lastSeen) ? Math.max(0, now - lastSeen) : null;
  const expected = Math.max(device.reporting_interval_ms ?? 5000, 1000);
  return {
    device,
    history,
    ageMs,
    missing: !device.latest || ageMs === null,
    stale: ageMs !== null && ageMs > expected * 3,
    offlineTransitions: history.filter((row) => row.new_status === 'offline').length,
  };
}

