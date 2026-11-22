import type { RoomMapDevice } from "@iot/contracts";
import { sensorFreshness } from "../../lib/freshness.js";
import type { Point } from "./simulation/engine.js";

export type GasMetric = "mq2" | "mq7";
export type Measurement = Point & { sampledAt: string; bits: number };
export function roomMeasurements(
  devices: RoomMapDevice[],
  metric: GasMetric,
  now: number,
) {
  const candidates: Measurement[] = [];
  const excluded: { name: string; reason: string }[] = [];
  for (const device of devices) {
    const r = device.latest;
    const sensor = r?.payload.sensors[metric];
    const reason = !device.position
      ? "Chưa đặt vị trí"
      : device.status !== "online"
        ? "Chưa kết nối"
        : !r ||
            !sensor ||
            sensor.adc_raw === null ||
            !["uncalibrated", "valid"].includes(sensor.quality)
          ? "Chưa có số đo hợp lệ"
          : sensorFreshness(
                r,
                sensor.age_ms,
                now,
                metric === "mq7" ? 180000 : 15000,
              ) !== "Dữ liệu mới"
            ? "Chưa có số đo mới"
            : null;
    if (reason) {
      excluded.push({ name: device.name, reason });
      continue;
    }
    candidates.push({
      id: device.id,
      name: device.name,
      ...device.position!,
      value: (sensor!.adc_raw! * 100) / (2 ** sensor!.adc_bits - 1),
      sampledAt: new Date(
        Date.parse(r!.payload.sampled_at!) - sensor!.age_ms,
      ).toISOString(),
      bits: sensor!.adc_bits,
    });
  }
  const counts = new Map<number, number>();
  for (const p of candidates) counts.set(p.bits, (counts.get(p.bits) ?? 0) + 1);
  const bits = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
  const points = candidates.filter((p) => p.bits === bits);
  for (const p of candidates)
    if (p.bits !== bits)
      excluded.push({ name: p.name, reason: "Khác độ phân giải ADC" });
  // Merge co-located measurements for the field, retain individual stations for inspection.
  const locations = new Map<string, { point: Point; count: number }>();
  for (const point of points) {
    const key = [point.x, point.y].join(",");
    const entry = locations.get(key);
    if (entry) {
      entry.count++;
      entry.point.value += (point.value - entry.point.value) / entry.count;
    } else locations.set(key, { point: { ...point }, count: 1 });
  }
  const anchors = [...locations.values()].map((v) => v.point);
  const a = anchors[0];
  // Use a long baseline; a perpendicular spread is required for a 2D field.
  const b =
    a &&
    anchors.reduce(
      (far, p) =>
        Math.hypot(p.x - a.x, p.y - a.y) > Math.hypot(far.x - a.x, far.y - a.y)
          ? p
          : far,
      a,
    );
  const surface =
    !!a &&
    !!b &&
    anchors.some(
      (p) =>
        Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= 0.02,
    );
  return { points, anchors, surface, excluded };
}
