// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import type { DeviceView } from '@iot/contracts';
import { sensorFreshness } from '../../lib/freshness.js';
import { validDisplayRange } from '../../lib/sensor-display.js';

export interface LatestDhtSnapshot {
  temperature: number | null;
  humidity: number | null;
  freshness: string;
}

/**
 * Monitoring and this module receive the SAME DeviceView.latest from App's `devices` query.
 * This is the last RAW reading, not a minute average or a synthesized observation.
 * Invalid DHT measurements are hidden here; synchronized, valid history is handled separately.
 */
export function latestDhtSnapshot(device: DeviceView, nowMs: number): LatestDhtSnapshot {
  const reading = device.latest;
  if (!reading) return { temperature: null, humidity: null, freshness: 'Chưa có dữ liệu' };
  const dht = reading.payload.sensors.dht11;
  const valid = dht.quality === 'valid';
  const temperature = valid && validDisplayRange('temperature_c', dht.temperature_c)
    ? dht.temperature_c : null;
  const humidity = valid && validDisplayRange('humidity_pct', dht.humidity_pct)
    ? dht.humidity_pct : null;
  const freshness = device.status !== 'online'
    ? 'Thiết bị ngoại tuyến'
    : sensorFreshness(reading, dht.age_ms, nowMs);
  return {
    temperature,
    humidity,
    freshness: valid ? freshness : 'Cảm biến DHT11 không hợp lệ',
  };
}
