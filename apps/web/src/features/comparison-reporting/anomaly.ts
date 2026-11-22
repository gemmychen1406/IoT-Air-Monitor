import type { AnalyticsView } from "@iot/contracts";

export const MIN_POINTS = 8;
export const SENSITIVITY_OPTIONS = [
  { value: 3, label: "Nhạy (nhiều điểm được đánh dấu)" },
  { value: 3.5, label: "Chuẩn" },
  { value: 5, label: "Chặt (chỉ điểm lệch rất xa)" },
] as const;

export type AnomalyPoint = {
  bucket_start: string;
  value: number;
  score: number;
  direction: "high" | "low";
};
export type AnomalyResult = {
  status: "ok" | "insufficient" | "flat";
  validPoints: number;
  median: number | null;
  points: AnomalyPoint[];
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Phát hiện điểm lệch bằng modified z-score (median + MAD), bền với chính các
 * điểm lệch. Chỉ dùng bucket có mẫu hợp lệ; bucket thiếu bị bỏ qua, không
 * được đổi thành 0. Kết quả chỉ mô tả thống kê, không suy ra nguyên nhân.
 */
export function detectAnomalies(
  series: AnalyticsView["series"] | undefined,
  threshold = 3.5,
): AnomalyResult {
  const valid = (series ?? []).filter(
    (point) =>
      point.valid_count > 0 &&
      point.average !== null &&
      Number.isFinite(point.average),
  ) as { bucket_start: string; average: number }[];
  if (valid.length < MIN_POINTS)
    return {
      status: "insufficient",
      validPoints: valid.length,
      median: null,
      points: [],
    };
  const values = valid.map((point) => point.average);
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  let scale: number;
  if (mad > 0) scale = mad / 0.6745;
  else {
    // MAD = 0 khi hơn nửa số điểm bằng nhau: dùng độ lệch tuyệt đối trung bình.
    const meanAbs =
      values.reduce((sum, value) => sum + Math.abs(value - center), 0) /
      values.length;
    if (meanAbs === 0)
      return {
        status: "flat",
        validPoints: valid.length,
        median: center,
        points: [],
      };
    scale = meanAbs * 1.2533;
  }
  const points: AnomalyPoint[] = [];
  for (const point of valid) {
    const score = (point.average - center) / scale;
    if (Math.abs(score) >= threshold)
      points.push({
        bucket_start: point.bucket_start,
        value: point.average,
        score,
        direction: score > 0 ? "high" : "low",
      });
  }
  return { status: "ok", validPoints: valid.length, median: center, points };
}
