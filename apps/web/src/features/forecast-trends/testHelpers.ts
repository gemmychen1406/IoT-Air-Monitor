// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import type { ReadingView } from '@iot/contracts';
import type { MinuteReading } from './types.js';

export const START = Date.parse('2026-01-01T09:00:00.000Z');
export const mins = (count: number) => count * 60_000;

/** Test fixtures only; never used in the production page. */
export function reading(minute: number, temp: number | null, humidity: number | null, options: {
  synced?: boolean;
  quality?: 'valid' | 'invalid' | 'warming_up';
  at?: number;
} = {}): ReadingView {
  const timestamp = options.at ?? START + mins(minute);
  return {
    id: String(minute),
    received_at: new Date(timestamp + 1000).toISOString(),
    payload: {
      time_quality: options.synced === false ? 'unsynced' : 'synced',
      sampled_at: options.synced === false ? null : new Date(timestamp).toISOString(),
      sensors: { dht11: { quality: options.quality ?? 'valid', temperature_c: temp, humidity_pct: humidity, age_ms: 0 } },
    },
  } as ReadingView;
}

export function series(values: number[], humidityValues?: number[], start = START): MinuteReading[] {
  return values.map((value, index) => ({
    timestamp: start + mins(index), temperature: value,
    humidity: humidityValues?.[index] ?? 60,
    temperatureMa: null, humidityMa: null, count: 1,
  }));
}
