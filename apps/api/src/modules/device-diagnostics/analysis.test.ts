import { describe, expect, it } from "vitest";
import {
  diagnosticQuerySchema,
  readingSchema,
  type DiagnosticInput,
  type ReadingView,
} from "@iot/contracts";
import { samplePayload } from "../../../../../packages/contracts/tests/fixture.js";
import { analyzeDiagnostics } from "./analysis.js";
const start = Date.parse("2026-11-20T10:00:00Z");
const query = (minutes = 60) =>
  diagnosticQuerySchema.parse({
    from: new Date(start).toISOString(),
    to: new Date(start + minutes * 60000).toISOString(),
  });
function row(
  seq: number,
  offset: number,
  options: {
    boot?: string;
    counter?: string;
    received?: number;
    temp?: number;
  } = {},
): ReadingView {
  const payload = readingSchema.parse(samplePayload().readings[0]!);
  Object.assign(payload, {
    seq: String(seq),
    uptime_ms: String(offset),
    sampled_at: new Date(start + offset).toISOString(),
    ...(options.boot ? { boot_id: options.boot } : {}),
    ...(options.counter ? { boot_counter: options.counter } : {}),
  });
  if (options.temp !== undefined)
    payload.sensors.dht11.temperature_c = options.temp;
  return {
    id: String(seq),
    received_at: new Date(
      start + (options.received ?? offset) + 100,
    ).toISOString(),
    payload,
  };
}
const input = (readings: ReadingView[]): DiagnosticInput => ({
  readings,
  statuses: [],
  baseline: null,
  intervals: { 1: 5000 },
  interval_ms: 5000,
});
describe("device diagnostics evidence and household reminders", () => {
  it("detects receipt gaps across reboot boundaries without interpreting them as spikes", () => {
    const a = row(1, 5000),
      b = row(1, 1000, {
        boot: "00000000-0000-4000-8000-000000000002",
        counter: "2",
        received: 90000,
        temp: 50,
      });
    const report = analyzeDiagnostics(input([a, b]), query());
    expect(
      report.events.some((e) => e.detail.includes("Server không nhận mẫu")),
    ).toBe(true);
    expect(report.events.some((e) => e.kind === "jump")).toBe(false);
  });
  it("does not treat a stale but valid cached sensor sample as fresh signal evidence", () => {
    const a = row(1, 5000, { temp: 20 }),
      b = row(2, 10000, { temp: 40 });
    b.payload.sensors.dht11.age_ms = 60000;
    const report = analyzeDiagnostics(input([a, b]), query());
    expect(report.events.some((e) => e.kind === "jump")).toBe(false);
    expect(report.quality.find((q) => q.sensor === "dht11")?.stale).toBe(1);
  });
  it("separates uncalibrated ADC, warming and invalid without losing categories", () => {
    const a = row(1, 5000),
      b = row(2, 10000),
      c = row(3, 15000);
    a.payload.sensors.mq2.quality = "uncalibrated";
    b.payload.sensors.mq2.quality = "heating";
    c.payload.sensors.mq2.quality = "invalid";
    const report = analyzeDiagnostics(input([a, b, c]), query());
    expect(
      report.quality.find((x) => x.sensor === "mq2")?.counts,
    ).toMatchObject({ uncalibrated: 1, heating: 1, invalid: 1, valid: 0 });
  });
  it("clips offline intervals to the selected window and keeps unknown time separate", () => {
    const source = input([]);
    source.baseline = {
      effective_at: new Date(start - 60000).toISOString(),
      status: "offline",
    };
    source.statuses = [
      {
        effective_at: new Date(start + 600000).toISOString(),
        status: "online",
      },
      {
        effective_at: new Date(start + 3000000).toISOString(),
        status: "offline",
      },
    ];
    expect(analyzeDiagnostics(source, query()).connection).toMatchObject({
      offline_ms: 1200000,
      unknown_ms: 0,
      disconnects: 1,
    });
    expect(analyzeDiagnostics(input([]), query()).connection.unknown_ms).toBe(
      3600000,
    );
  });
  it("sorts delayed packets by sequence instead of treating arrival order as a clock problem", () => {
    const a = row(1, 5000, { received: 20000 }),
      b = row(2, 10000, { received: 15000 });
    expect(analyzeDiagnostics(input([b, a]), query()).clock.backwards).toBe(0);
    b.payload.sampled_at = new Date(start).toISOString();
    expect(analyzeDiagnostics(input([b, a]), query()).clock.backwards).toBe(1);
  });
  it("does not compare uptime across reboots or count the first observed session as a reboot", () => {
    const a = row(1, 50000),
      b = row(1, 1000, {
        boot: "00000000-0000-4000-8000-000000000002",
        counter: "2",
        temp: 50,
      });
    const report = analyzeDiagnostics(input([a, b]), query());
    expect(report.reboots_observed).toBe(1);
    expect(report.events.filter((e) => e.kind === "jump")).toHaveLength(0);
  });
  it("uses historical config intervals and never bridges a gap to infer a jump or a flat signal", () => {
    const source = input([
      row(1, 5000, { temp: 20 }),
      row(2, 65000, { temp: 40 }),
    ]);
    source.intervals = { 1: 60000 };
    expect(
      analyzeDiagnostics(source, query()).events.filter(
        (e) => e.kind === "gap" && e.detail.includes("Hai mẫu"),
      ),
    ).toHaveLength(0);
    source.intervals = { 1: 5000 };
    const events = analyzeDiagnostics(source, query()).events;
    expect(
      events.some((e) => e.kind === "gap" && e.detail.includes("Hai mẫu")),
    ).toBe(true);
    expect(events.some((e) => e.kind === "jump")).toBe(false);
  });
  it("does not label slow cumulative changes as flat data", () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      row(i + 1, (i + 1) * 5000, { temp: 20 + i * 0.04 }),
    );
    const report = analyzeDiagnostics(input(rows), {
      ...query(),
      flat_minutes: 5,
    });
    expect(
      report.events.filter(
        (e) => e.kind === "flat" && e.sensor === "temperature",
      ),
    ).toHaveLength(0);
  });
  it("suppresses an invalid-sensor reminder after recovery and explains persistent faults", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row(i + 1, 3600000 - (5 - i) * 5000),
    );
    for (const r of rows)
      r.payload.sensors.dht11 = {
        temperature_c: null,
        humidity_pct: null,
        quality: "invalid",
        age_ms: 0,
      };
    expect(
      analyzeDiagnostics(input(rows), query()).notices.some(
        (n) => n.id === "invalid-dht11",
      ),
    ).toBe(true);
    rows.push(row(6, 3599000));
    expect(
      analyzeDiagnostics(input(rows), query()).notices.some(
        (n) => n.id === "invalid-dht11",
      ),
    ).toBe(false);
  });
  it("excludes unsynced samples and negative clock differences from delay statistics", () => {
    const a = row(1, 1000),
      b = row(2, 2000),
      c = row(3, 3000, { received: 2500 });
    a.payload.time_quality = "unsynced";
    a.payload.sampled_at = null;
    const report = analyzeDiagnostics(input([a, b, c]), query());
    expect(report.connection.delay_count).toBe(1);
    expect(report.clock.future).toBe(1);
    expect(report.clock.unsynced).toBe(1);
  });
  it("does not interpret ADC profile changes or warming samples as jumps", () => {
    const a = row(1, 5000),
      b = row(2, 10000);
    a.payload.sensors.mq2.adc_raw = 100;
    b.payload.sensors.mq2.adc_raw = 200;
    b.payload.sensors.mq2.adc_bits = 8;
    b.payload.sensors.dht11.quality = "warming_up";
    b.payload.sensors.dht11.temperature_c = null;
    b.payload.sensors.dht11.humidity_pct = null;
    expect(
      analyzeDiagnostics(input([a, b]), query()).events.filter(
        (e) => e.kind === "jump",
      ),
    ).toHaveLength(0);
  });
});
