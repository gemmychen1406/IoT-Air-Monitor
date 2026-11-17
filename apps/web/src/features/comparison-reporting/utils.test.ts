import { describe, expect, it } from "vitest";
import type { AnalyticsView } from "@iot/contracts";
import {
  adcCompatibility,
  alignSeries,
  coverage,
  delta,
  friendlyConclusion,
  rangeParams,
} from "./utils.js";

const range = {
  from: "2026-11-01T00:00",
  to: "2026-11-01T03:00",
  bucket: "hour" as const,
};
const analytics = (
  adcBits: number | null,
  points: (number | null)[],
): AnalyticsView => ({
  from: "2026-11-01T00:00:00.000Z",
  to: "2026-11-01T03:00:00.000Z",
  metric: "mq2_adc",
  unit: "ADC",
  time_basis: "received",
  adc_bits: adcBits,
  source_kind: "physical",
  previous: null,
  summary: {
    total_count: points.length,
    valid_count: points.filter((v) => v !== null).length,
    invalid_count: points.filter((v) => v === null).length,
    min: 10,
    max: 30,
    average: 20,
  },
  series: points.map((average, index) => ({
    bucket_start: `2026-11-01T0${index}:00:00.000Z`,
    total_count: 1,
    valid_count: average === null ? 0 : 1,
    invalid_count: average === null ? 1 : 0,
    min: average,
    max: average,
    average,
  })),
});

describe("comparison reporting calculations", () => {
  it("aligns asynchronous buckets and preserves missing data as null", () => {
    const rows = alignSeries([
      { id: "a", data: analytics(12, [10, null, 30]) },
      { id: "b", data: analytics(12, [20, 25]) },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ a: null, b: 25 });
    expect(rows[2]).toMatchObject({ a: 30, b: null });
  });
  it("separates bucket coverage from valid sample counts", () => {
    expect(coverage(analytics(12, [10, null, 30]), range)).toMatchObject({
      expected: 3,
      present: 2,
      missing: 1,
    });
  });
  it("blocks comparison of incompatible ADC profiles", () => {
    expect(
      adcCompatibility("mq2_adc", [analytics(10, [1]), analytics(12, [1])]),
    ).toMatch(/Không thể so sánh/);
    expect(
      adcCompatibility("temperature_c", [
        analytics(10, [1]),
        analytics(12, [1]),
      ]),
    ).toBeNull();
  });
  it("handles missing data and zero baselines without invented percentages", () => {
    const missing = {
      total_count: 0,
      valid_count: 0,
      invalid_count: 0,
      min: null,
      max: null,
      average: null,
    };
    const zero = {
      ...missing,
      total_count: 1,
      valid_count: 1,
      min: 0,
      max: 0,
      average: 0,
    };
    expect(delta(zero, { ...zero, average: 2 }).percent).toBeNull();
    expect(friendlyConclusion("Nhiệt độ", missing, zero)).toMatch(
      /Chưa đủ dữ liệu/,
    );
  });
  it("rejects invalid, overly long and overly detailed ranges", () => {
    expect(() =>
      rangeParams({ ...range, to: range.from }, "temperature_c"),
    ).toThrow(/không hợp lệ/);
    expect(() =>
      rangeParams(
        { from: "2026-01-01", to: "2026-05-01", bucket: "day" },
        "temperature_c",
      ),
    ).toThrow(/90 ngày/);
    expect(() =>
      rangeParams(
        { from: "2026-01-01", to: "2026-01-03", bucket: "minute" },
        "temperature_c",
      ),
    ).toThrow(/1.999/);
  });
});
