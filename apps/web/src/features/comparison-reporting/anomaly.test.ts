import { describe, expect, it } from "vitest";
import type { AnalyticsView } from "@iot/contracts";
import { detectAnomalies } from "./anomaly.js";

const series = (values: (number | null)[]): AnalyticsView["series"] =>
  values.map((value, index) => ({
    bucket_start: new Date(Date.UTC(2026, 10, 1, index)).toISOString(),
    total_count: value === null ? 0 : 1,
    valid_count: value === null ? 0 : 1,
    invalid_count: 0,
    average: value,
    min: value,
    max: value,
  })) as AnalyticsView["series"];

describe("detectAnomalies", () => {
  it("đánh dấu điểm lệch xa và bỏ qua dữ liệu thiếu", () => {
    const result = detectAnomalies(
      series([25, 25.2, 24.8, null, 25.1, 24.9, 25, 25.3, 40, 25.1]),
    );
    expect(result.status).toBe("ok");
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ value: 40, direction: "high" });
    expect(result.validPoints).toBe(9);
  });

  it("nhận diện điểm thấp bất thường", () => {
    const result = detectAnomalies(
      series([50, 51, 49, 50, 52, 48, 50, 51, 5, 50]),
    );
    expect(result.points.map((p) => p.direction)).toEqual(["low"]);
  });

  it("báo thiếu dữ liệu khi dưới 8 điểm hợp lệ", () => {
    expect(detectAnomalies(series([1, 2, 3, null, 4])).status).toBe(
      "insufficient",
    );
    expect(detectAnomalies(undefined).status).toBe("insufficient");
  });

  it("chuỗi phẳng không có điểm bất thường", () => {
    const result = detectAnomalies(series(Array(10).fill(30)));
    expect(result.status).toBe("flat");
    expect(result.points).toHaveLength(0);
  });

  it("vẫn phát hiện khi MAD bằng 0 nhưng có điểm vọt", () => {
    const result = detectAnomalies(
      series([30, 30, 30, 30, 30, 30, 30, 30, 90]),
    );
    expect(result.points).toHaveLength(1);
  });

  it("ngưỡng chặt hơn đánh dấu ít điểm hơn", () => {
    const data = series([10, 11, 9, 10, 12, 8, 10, 11, 9, 16]);
    expect(detectAnomalies(data, 3).points.length).toBeGreaterThanOrEqual(
      detectAnomalies(data, 5).points.length,
    );
  });
});
