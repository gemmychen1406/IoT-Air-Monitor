import { expect, it } from "vitest";
import { diagnosticOptionsSchema } from "@iot/contracts";
import type { Database } from "@iot/database";
import { buildPayload } from "../../../../../tools/device-simulator/src/payload.js";
import { diagnosticSummary } from "./summary.js";

it("evaluates live sensors even when a station exceeds the summary sample limit", async () => {
  const now = Date.now();
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const records = Array.from({ length: 1215 }, (_, i) => {
    const received_at = new Date(now - (1215 - i) * 2900);
    const packet = buildPayload({
      deviceId: id,
      bootId: id,
      bootCounter: "1",
      seq: String(i + 1),
      uptime: i * 2900,
      now: received_at,
    });
    return {
      id: BigInt(i + 1),
      device_id: id,
      received_at,
      payload: packet.readings[0]!,
    };
  });
  const device = {
    id,
    name: "Bếp",
    sourceKind: "simulator",
    reportingIntervalMs: 5000,
    lastSeenAt: records.at(-1)!.received_at,
    roomAssignment: null,
    rollups: [],
    configs: [{ version: 1, config: { reporting_interval_ms: 5000 } }],
    statuses: [],
  };
  const db = {
    device: { findMany: async () => [device] },
    $queryRaw: async (sql: TemplateStringsArray) => {
      const match = /LIMIT (\d+)/.exec(sql.join("?"));
      return records.slice(-Number(match![1]));
    },
  } as unknown as Database;
  const summary = async () =>
    (await diagnosticSummary(db, diagnosticOptionsSchema.parse({})))[0]!;
  expect((await summary()).notices).toEqual([]);
  for (const record of records.slice(-100))
    record.payload.sensors.dht11 = {
      quality: "invalid",
      temperature_c: null,
      humidity_pct: null,
      age_ms: 0,
    };
  expect((await summary()).notices.map((n) => n.id)).toContain("invalid-dht11");
});
