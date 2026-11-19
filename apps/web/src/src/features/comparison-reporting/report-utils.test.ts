import { describe, expect, it } from "vitest";
import type { AnalyticsView } from "@iot/contracts";
import {
  chartTickInterval,
  reportComment,
  reportHasData,
} from "./report-utils.js";

const range = {
  from: "2026-11-01T00:00",
  to: "2026-11-01T03:00",
  bucket: "hour" as const,
};
const data: AnalyticsView = {
  from: new Date(range.from).toISOString(),
  to: new Date(range.to).toISOString(),
  metric: "temperature_c",
  unit: "°C",
  time_basis: "received",
  adc_bits: null,
  source_kind: "physical",
  previous: null,
  summary: {
    total_count: 3,
    valid_count: 3,
    invalid_count: 0,
    min: 20,
    max: 30,
    average: 25,
  },
  series: [20, 25, 30].map((average, index) => ({
    bucket_start: `2026-11-01T0${index}:00:00.000Z`,
    total_count: 1,
    valid_count: 1,
    invalid_count: 0,
    min: average,
    max: average,
    average,
  })),
};

describe("PDF report analysis", () => {
  it("only states conclusions supported by returned data", () => {
    expect(reportComment("temperature_c", data, range)).toMatch(
      /trung bình.*25.*biến động/i,
    );
    expect(
      reportComment(
        "temperature_c",
        { ...data, summary: { ...data.summary, valid_count: 0 } },
        range,
      ),
    ).toMatch(/Chưa đủ/);
    expect(reportHasData([data])).toBe(true);
  });
  it("limits time labels for long reports", () => {
    expect(chartTickInterval(2)).toBe(0);
    expect(chartTickInterval(120)).toBe(19);
  });
});
