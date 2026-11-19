import type { AnalyticsView, Stats } from "@iot/contracts";
import type { Bucket, Metric, RangeInput } from "./types.js";
import {
  formatSensorValue,
  type DisplayMetric,
} from "../../lib/sensor-display.js";

const BUCKET_MS: Record<Bucket, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export function localDateTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function defaultRange(hours = 24): RangeInput {
  const to = new Date();
  return {
    from: localDateTime(new Date(to.getTime() - hours * 3_600_000)),
    to: localDateTime(to),
    bucket: "hour",
  };
}

export function previousRange(range: RangeInput): RangeInput {
  const duration = Date.parse(range.to) - Date.parse(range.from);
  return {
    from: localDateTime(new Date(Date.parse(range.from) - duration)),
    to: localDateTime(new Date(Date.parse(range.from))),
    bucket: range.bucket,
  };
}

export function rangeParams(range: RangeInput, metric: Metric) {
  const from = new Date(range.from);
  const to = new Date(range.to);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from >= to
  )
    throw new Error("Khoảng thời gian không hợp lệ.");
  if (to.getTime() - from.getTime() > 90 * 86_400_000)
    throw new Error("Khoảng thời gian tối đa là 90 ngày.");
  if (
    Math.ceil((to.getTime() - from.getTime()) / BUCKET_MS[range.bucket]) > 1999
  )
    throw new Error(
      "Hãy chọn độ phân giải lớn hơn để không vượt quá 1.999 điểm.",
    );
  return new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    metric,
    bucket: range.bucket,
    time_basis: "received",
  });
}

export function expectedBuckets(range: RangeInput) {
  return Math.max(
    0,
    Math.ceil(
      (Date.parse(range.to) - Date.parse(range.from)) / BUCKET_MS[range.bucket],
    ),
  );
}

export function coverage(data: AnalyticsView | undefined, range: RangeInput) {
  const expected = expectedBuckets(range);
  const present =
    data?.series.filter((point) => point.valid_count > 0).length ?? 0;
  return {
    expected,
    present,
    missing: Math.max(0, expected - present),
    percent: expected ? (present / expected) * 100 : null,
  };
}

export function alignSeries(items: { id: string; data?: AnalyticsView }[]) {
  const rows = new Map<string, Record<string, string | number | null>>();
  for (const { id, data } of items) {
    for (const point of data?.series ?? []) {
      const row = rows.get(point.bucket_start) ?? {
        bucket_start: point.bucket_start,
      };
      row[id] = point.valid_count > 0 ? point.average : null;
      rows.set(point.bucket_start, row);
    }
  }
  const ids = items.map((item) => item.id);
  return [...rows.values()]
    .map((row) => ({
      ...Object.fromEntries(ids.map((id) => [id, null])),
      ...row,
    }))
    .sort((a, b) =>
      String(a.bucket_start).localeCompare(String(b.bucket_start)),
    );
}

export function adcCompatibility(
  metric: Metric,
  items: (AnalyticsView | undefined)[],
) {
  if (!metric.endsWith("_adc")) return null;
  const profiles = [
    ...new Set(
      items
        .map((item) => item?.adc_bits)
        .filter(
          (value): value is number => value !== null && value !== undefined,
        ),
    ),
  ];
  return profiles.length > 1
    ? `Không thể so sánh trực tiếp tín hiệu ADC ${profiles.join(", ")} bit vì chưa có phép chuẩn hóa hợp lệ.`
    : null;
}

export function delta(a: Stats, b: Stats) {
  if (a.average === null || b.average === null)
    return { absolute: null, percent: null };
  const absolute = b.average - a.average;
  return {
    absolute,
    percent: a.average === 0 ? null : (absolute / Math.abs(a.average)) * 100,
  };
}

export function friendlyConclusion(
  label: string,
  first: Stats,
  second: Stats,
  firstName = "giai đoạn A",
  secondName = "giai đoạn B",
) {
  const change = delta(first, second).absolute;
  if (change === null)
    return `Chưa đủ dữ liệu hợp lệ để nhận xét ${label.toLowerCase()}.`;
  if (Math.abs(change) < 0.01)
    return `${label} gần như không đổi giữa ${firstName} và ${secondName}.`;
  return `${label} trung bình ở ${secondName} ${change > 0 ? "cao hơn" : "thấp hơn"} ${firstName} khoảng ${Math.abs(change).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}. Đây là mô tả dữ liệu, không khẳng định nguyên nhân.`;
}

export function formatValue(value: number | null, unit = "") {
  if (value === null) return "Chưa có dữ liệu";
  const metric =
    unit === "°C"
      ? "temperature_c"
      : unit === "%RH" || unit === "%"
        ? "humidity_pct"
        : unit === "ADC"
          ? "mq2_adc"
          : null;
  const formatted = metric
    ? formatSensorValue(metric as DisplayMetric, value)
    : value.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  return `${formatted} ${unit}`.trim();
}

export function formatTime(value: string) {
  return new Date(value).toLocaleString("vi-VN");
}
