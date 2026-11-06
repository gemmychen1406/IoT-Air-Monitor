import type { ReadingView } from '@iot/contracts';

export function sensorFreshness(
  reading: ReadingView,
  ageMs: number,
  now: number,
  ttlMs = 15000,
): string {
  if (reading.payload.time_quality !== 'synced' || !reading.payload.sampled_at)
    return 'Chưa rõ thời điểm đo';
  const age = now - Date.parse(reading.payload.sampled_at) + ageMs;
  if (age < -60000) return 'Chưa rõ thời điểm đo';
  return age > ttlMs ? 'Dữ liệu cũ' : 'Dữ liệu mới';
}
