import { describe, expect, it } from "vitest";
import type { AnalyticsView, DeviceView, IncidentView } from "@iot/contracts";
import { buildSummary, dataReliability } from "./summary.js";
import type { Metric, ReportData } from "./types.js";

const range = {
  from: "2026-11-01T00:00",
  to: "2026-11-01T10:00",
  bucket: "hour" as const,
};
const hours = 10;

function analytics(
  metric: Metric,
  average: number | null,
  min: number | null,
  max: number | null,
  presentBuckets = hours,
  adcBits: number | null = null,
): AnalyticsView {
  const unit = {
    temperature_c: "°C",
    humidity_pct: "%RH",
    mq2_adc: "ADC",
    mq7_adc: "ADC",
  }[metric];
  const series = Array.from({ length: hours }, (_, i) => ({
    bucket_start: new Date(Date.UTC(2026, 10, 1, i)).toISOString(),
    total_count: i < presentBuckets ? 1 : 0,
    valid_count: i < presentBuckets ? 1 : 0,
    invalid_count: 0,
    average: i < presentBuckets ? average : null,
    min,
    max,
  }));
  const valid = average === null ? 0 : presentBuckets;
  return {
    from: "",
    to: "",
    metric,
    unit,
    time_basis: "received",
    adc_bits: adcBits,
    source_kind: "device",
    previous: null,
    summary: {
      total_count: valid,
      valid_count: valid,
      invalid_count: 0,
      average,
      min,
      max,
    },
    series,
  } as AnalyticsView;
}

const incident = (
  severity: "warning" | "critical",
  status: "active" | "ended",
) =>
  ({
    id: Math.random().toString(),
    condition: "gas",
    severity,
    status,
    first_observed_at: "2026-11-01T01:00:00.000Z",
    started_at: null,
  }) as unknown as IncidentView;

function report(
  overrides: Partial<ReportData["analytics"]> = {},
  incidents: IncidentView[] = [],
  complete = true,
): ReportData {
  return {
    generatedAt: "2026-11-01T10:00:00.000Z",
    device: { id: "d", name: "Phòng khách" } as DeviceView,
    range,
    analytics: {
      temperature_c: analytics("temperature_c", 25, 23, 27),
      humidity_pct: analytics("humidity_pct", 55, 50, 60),
      mq2_adc: analytics("mq2_adc", 500, 400, 700, hours, 12),
      mq7_adc: analytics("mq7_adc", 500, 400, 700, hours, 12),
      ...overrides,
    },
    incidents,
    incidentsComplete: complete,
  };
}

describe("buildSummary", () => {
  it("ngày bình thường: kết luận ổn và dùng lời thường", () => {
    const result = buildSummary(report());
    expect(result.tone).toBe("good");
    expect(result.headline).toContain("chưa thấy dấu hiệu bất thường");
    expect(result.items.find((i) => i.id === "temperature_c")!.text).toContain(
      "dễ chịu",
    );
    expect(result.items.find((i) => i.id === "incidents")!.text).toContain(
      "không ghi nhận sự cố",
    );
    expect(result.advice[0]).toContain("Chưa có gợi ý đặc biệt");
  });

  it("không có dữ liệu: nói chưa đủ dữ liệu, không bịa nhận xét", () => {
    const empty = report({
      temperature_c: analytics("temperature_c", null, null, null),
      humidity_pct: analytics("humidity_pct", null, null, null),
      mq2_adc: analytics("mq2_adc", null, null, null, hours, 12),
      mq7_adc: analytics("mq7_adc", null, null, null, hours, 12),
    });
    const result = buildSummary(empty);
    expect(result.tone).toBe("unknown");
    expect(result.headline).toContain("Chưa đủ dữ liệu");
    expect(dataReliability(empty.analytics, range).level).toBe("none");
  });

  it("nóng và ẩm: đánh dấu theo dõi và gợi ý hành động", () => {
    const result = buildSummary(
      report({
        temperature_c: analytics("temperature_c", 30, 28, 33),
        humidity_pct: analytics("humidity_pct", 75, 70, 80),
      }),
    );
    expect(result.tone).toBe("watch");
    expect(result.advice.join(" ")).toContain("Nhiệt độ khá cao");
    expect(result.advice.join(" ")).toContain("Độ ẩm cao");
  });

  it("tín hiệu khí chạm mức nguy hiểm: cảnh báo và có lời khuyên hệ thống", () => {
    const result = buildSummary(
      report({ mq2_adc: analytics("mq2_adc", 900, 400, 3500, hours, 12) }),
    );
    expect(result.tone).toBe("alert");
    expect(result.headline).toContain("Cần chú ý");
    expect(result.items.find((i) => i.id === "mq2_adc")!.tone).toBe("alert");
    expect(result.advice.join(" ")).toContain("Rời khỏi khu vực");
  });

  it("sự cố nghiêm trọng đang diễn ra", () => {
    const result = buildSummary(
      report(
        {},
        [incident("critical", "active"), incident("warning", "ended")],
        false,
      ),
    );
    expect(result.tone).toBe("alert");
    const text = result.items.find((i) => i.id === "incidents")!.text;
    expect(text).toContain("2+ sự cố");
    expect(text).toContain("1 sự cố mức nghiêm trọng");
    expect(text).toContain("đang diễn ra");
  });

  it("dữ liệu thiếu nhiều: nói rõ chỉ mang tính tham khảo", () => {
    const result = buildSummary(
      report({
        temperature_c: analytics("temperature_c", 25, 23, 27, 3),
        humidity_pct: analytics("humidity_pct", 55, 50, 60, 3),
        mq2_adc: analytics("mq2_adc", 500, 400, 700, 3, 12),
        mq7_adc: analytics("mq7_adc", 500, 400, 700, 3, 12),
      }),
    );
    expect(result.tone).toBe("watch");
    expect(result.headline).toContain("thiếu nhiều");
    expect(result.advice.join(" ")).toContain("kiểm tra nguồn điện");
  });

  it("không nêu nguyên nhân hay khẳng định an toàn", () => {
    const text = JSON.stringify(buildSummary(report()));
    expect(text).not.toMatch(
      /nguyên nhân do|an toàn tuyệt đối|chắc chắn an toàn/,
    );
  });
});
