import { expect, it } from "vitest";
import { telemetrySchema, type RoomMapDevice } from "@iot/contracts";
import { samplePayload } from "../../../../../packages/contracts/tests/fixture.js";
import { roomMeasurements } from "./room-distribution.js";
const now = Date.now();
function station(i: number, x: number, y: number): RoomMapDevice {
  const payload = telemetrySchema.parse(samplePayload()).readings[0]!;
  payload.sampled_at = new Date(now).toISOString();
  payload.sensors.mq2.age_ms = 0;
  return {
    id: String(i),
    name: "Station " + i,
    status: "online",
    source_kind: "physical",
    latest: { id: "1", received_at: payload.sampled_at, payload },
    last_seen_at: payload.sampled_at,
    position: { x, y },
    open_incidents: [],
  };
}
it("retains every comparable station and skips only ineligible ones", () => {
  const all = Array.from({ length: 12 }, (_, i) =>
    station(i, (i % 4) / 4, Math.floor(i / 4) / 3),
  );
  all[0]!.position = null;
  all[1]!.latest!.payload.sensors.mq2.age_ms = 120000;
  all[2]!.latest!.payload.sensors.mq2.adc_bits = 10;
  const result = roomMeasurements(all, "mq2", now);
  expect(result.points.length).toBe(9);
  expect(result.surface).toBe(true);
  expect(result.excluded.length).toBe(3);
});
it("keeps points visible without painting a field for insufficient geometry", () => {
  for (const points of [
    [],
    [station(1, 0, 0)],
    [station(1, 0, 0), station(2, 1, 1)],
    [station(1, 0, 0), station(2, 0.5, 0.5), station(3, 1, 1)],
  ]) {
    const result = roomMeasurements(points, "mq2", now);
    expect(result.surface).toBe(false);
    expect(result.points.length).toBe(points.length);
  }
  const result = roomMeasurements(
    [station(1, 0, 0), station(2, 0, 0), station(3, 1, 1)],
    "mq2",
    now,
  );
  expect(result.anchors.length).toBe(2);
  expect(result.surface).toBe(false);
});
