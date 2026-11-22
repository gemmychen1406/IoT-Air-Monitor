// Isolated Forecast-only filter for synchronized, valid raw DHT11 chart values.
import type { ReadingView } from '@iot/contracts';
import { parseSyncedTime } from './timeseries.js';

export interface ForecastChartPoint {
  timestamp: number;
  time: string;
  temperature: number | null;
  humidity: number | null;
}

/** Preserve positions as gaps rather than drawing or inventing invalid measurements. */
export function forecastChartPoints(readings: readonly ReadingView[], nowMs: number): ForecastChartPoint[] {
  return readings.flatMap((reading) => {
    if (reading.payload.time_quality !== 'synced') return [];
    const timestamp = parseSyncedTime(reading.payload.sampled_at);
    if (timestamp === null || timestamp > nowMs) return [];
    const dht = reading.payload.sensors.dht11;
    const valid = dht.quality === 'valid'
      && typeof dht.temperature_c === 'number' && Number.isFinite(dht.temperature_c)
      && typeof dht.humidity_pct === 'number' && Number.isFinite(dht.humidity_pct)
      && dht.temperature_c >= -40 && dht.temperature_c <= 125
      && dht.humidity_pct >= 0 && dht.humidity_pct <= 100;
    return [{
      timestamp,
      time: new Date(timestamp).toLocaleTimeString('vi-VN'),
      temperature: valid ? dht.temperature_c : null,
      humidity: valid ? dht.humidity_pct : null,
    }];
  }).sort((a, b) => a.timestamp - b.timestamp);
}

