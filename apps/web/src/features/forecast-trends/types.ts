// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import type { DeviceView } from '@iot/contracts';

export type Measure = 'temperature' | 'humidity';
export type ForecastModel = 'naive' | 'linear' | 'holt';
export type TrendStatus = 'increasing' | 'decreasing' | 'stable' | 'insufficient' | 'stale';

export interface MinuteReading {
  timestamp: number;
  temperature: number | null;
  humidity: number | null;
  count: number;
  temperatureMa: number | null;
  humidityMa: number | null;
}

export interface NormalizedHistory {
  points: MinuteReading[];
  validSamples: number;
  rejectedSamples: number;
  duplicateTimestamps: number;
  latestSampleAt: number | null;
  latestReceivedAt: number | null;
}

export interface TrendResult {
  status: TrendStatus;
  slopePerMinute: number | null;
  current: number | null;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  sampleCount: number;
  lastSampleAt: number | null;
  ageMs: number | null;
}

export type ForecastStatus = 'eligible' | 'insufficient' | 'stale' | 'calculation_error';
export interface ForecastPoint {
  timestamp: number;
  value: number;
}
export interface MeasureForecast {
  status: ForecastStatus;
  reason: string | null;
  lastSampleAt: number | null;
  current: number | null;
  points: ForecastPoint[];
}
export type ForecastResult = Record<Measure, MeasureForecast>;

export interface Advisory {
  level: 'normal' | 'watch' | 'unusual' | 'unavailable';
  title: string;
  details: string[];
}

export interface RoomHistory {
  device: DeviceView;
  history: NormalizedHistory;
  partial: boolean;
  fetched: number;
}

export interface LagResult {
  sourceId: string;
  targetId: string;
  metric: Measure;
  lagMinutes: number | null;
  correlation: number | null;
  samplePairs: number;
  status: 'candidate' | 'not_detected' | 'insufficient';
  detail: string;
}

/** Pearson correlation of first differences at an observed offset, or null if unavailable. */
export interface LagCorrelationPoint {
  lagMinutes: number;
  correlation: number | null;
  samplePairs: number;
}
