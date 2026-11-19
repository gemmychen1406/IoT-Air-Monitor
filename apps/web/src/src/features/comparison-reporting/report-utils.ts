import type { AnalyticsView } from "@iot/contracts";
import type { Metric, RangeInput } from "./types.js";
import { coverage, formatValue } from "./utils.js";

export function reportComment(
  metric: Metric,
  data: AnalyticsView | undefined,
  range: RangeInput,
) {
  if (!data?.summary.valid_count)
    return "Chưa đủ dữ liệu hợp lệ để đánh giá khoảng thời gian này.";
  const label =
    metric === "temperature_c"
      ? "Nhiệt độ"
      : metric === "humidity_pct"
        ? "Độ ẩm"
        : metric === "mq2_adc"
          ? "Tín hiệu MQ-2"
          : "Tín hiệu MQ-7";
  const average = formatValue(data.summary.average, data.unit);
  const quality = coverage(data, range);
  const prefix = `${label} trung bình trong kỳ là ${average}.`;
  if (quality.percent !== null && quality.percent < 70)
    return `${prefix} Độ phủ chỉ ${quality.percent.toFixed(1)}%; chưa đủ để đánh giá toàn bộ khoảng thời gian.`;
  const values = data.series
    .map((point) => point.average)
    .filter((value): value is number => value !== null);
  if (values.length < 2)
    return `${prefix} Chưa đủ điểm dữ liệu để nhận xét xu hướng.`;
  const span = Math.max(...values) - Math.min(...values);
  if (span <= Math.max(Math.abs(data.summary.average ?? 0) * 0.02, 0.1))
    return `${prefix} Các điểm dữ liệu ghi nhận biến động nhỏ trong kỳ.`;
  return `${prefix} Các điểm dữ liệu biến động từ ${formatValue(Math.min(...values), data.unit)} đến ${formatValue(Math.max(...values), data.unit)}; báo cáo không suy luận nguyên nhân.`;
}

export function reportHasData(rows: (AnalyticsView | undefined)[]) {
  return rows.some((row) => (row?.summary.valid_count ?? 0) > 0);
}

export function chartTickInterval(pointCount: number) {
  return Math.max(0, Math.ceil(pointCount / 6) - 1);
}
