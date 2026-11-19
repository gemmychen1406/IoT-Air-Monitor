export type DisplayMetric =
  "temperature_c" | "humidity_pct" | "mq2_adc" | "mq7_adc";

export const DISPLAY_UNIT: Record<DisplayMetric, string> = {
  temperature_c: "°C",
  humidity_pct: "%RH",
  mq2_adc: "ADC",
  mq7_adc: "ADC",
};

export function formatSensorValue(
  metric: DisplayMetric,
  value: number | null | undefined,
) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  if (metric.endsWith("_adc")) return String(Math.round(value));
  const maximumFractionDigits = metric === "temperature_c" ? 1 : 0;
  return value.toLocaleString("vi-VN", { maximumFractionDigits });
}

export function validDisplayRange(metric: DisplayMetric, value: number | null) {
  if (value === null || !Number.isFinite(value)) return false;
  if (metric === "temperature_c") return value >= -40 && value <= 125;
  if (metric === "humidity_pct") return value >= 0 && value <= 100;
  return value >= 0;
}

export const RAW_ADC_NOTICE =
  "Tín hiệu ADC thô, chưa hiệu chuẩn; không phải ppm hoặc AQI.";
