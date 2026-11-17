import type { AnalyticsView, DeviceView, IncidentView } from "@iot/contracts";

export const METRICS = [
  "temperature_c",
  "humidity_pct",
  "mq2_adc",
  "mq7_adc",
] as const;
export type Metric = (typeof METRICS)[number];
export type Bucket = "minute" | "hour" | "day";
export type RangeInput = { from: string; to: string; bucket: Bucket };

export const METRIC_LABEL: Record<Metric, string> = {
  temperature_c: "Nhiệt độ",
  humidity_pct: "Độ ẩm tương đối",
  mq2_adc: "Tín hiệu cảm biến khí MQ-2",
  mq7_adc: "Tín hiệu cảm biến MQ-7",
};

export type SavedConfiguration = {
  id: string;
  name: string;
  kind: "devices" | "period" | "report";
  deviceIds: string[];
  metric: Metric;
  range: RangeInput;
  timeBasis: "received";
  createdAt: string;
};

export type ReportData = {
  generatedAt: string;
  device: DeviceView;
  range: RangeInput;
  analytics: Partial<Record<Metric, AnalyticsView>>;
  incidents: IncidentView[];
  incidentsMayBeTruncated: boolean;
};
