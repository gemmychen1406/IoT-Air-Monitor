import type { AnalyticsView, DeviceView, IncidentView, StatusView } from '@iot/contracts';

export type Metric = 'temperature_c' | 'humidity_pct' | 'mq2_adc' | 'mq7_adc';

export const METRICS: readonly Metric[] = [
  'temperature_c',
  'humidity_pct',
  'mq2_adc',
  'mq7_adc',
];

export const METRIC_LABEL: Record<Metric, string> = {
  temperature_c: 'Nhiệt độ',
  humidity_pct: 'Độ ẩm',
  mq2_adc: 'MQ-2',
  mq7_adc: 'MQ-7',
};

export type RangeInput = { from: string; to: string; bucket: 'minute' | 'hour' | 'day' };
export type AnalyticsByMetric = Partial<Record<Metric, AnalyticsView>>;
export type ReportData = {
  generatedAt: string;
  device: DeviceView;
  range: RangeInput;
  analytics: AnalyticsByMetric;
  incidents: IncidentView[];
};

export type DeviceHealth = {
  device: DeviceView;
  stale: boolean;
  missing: boolean;
  ageMs: number | null;
  offlineTransitions: number;
  history: StatusView[];
};

