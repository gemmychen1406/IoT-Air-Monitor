import { gasLevel, type DeviceView } from "@iot/contracts";
import { sensorFreshness } from "./freshness.js";

export function roomAir(devices: DeviceView[], now: number) {
  const signals = (["mq2", "mq7"] as const).map((kind) => {
    let rank: number | null = null;
    let hasReading = false;
    let label = "Chưa đủ dữ liệu";
    for (const device of devices) {
      const reading = device.latest;
      if (!reading || device.status !== "online") continue;
      const sensor = reading.payload.sensors[kind];
      if (
        sensorFreshness(
          reading,
          sensor.age_ms,
          now,
          kind === "mq7" ? 180000 : 15000,
        ) !== "Dữ liệu mới"
      )
        continue;
      const level = gasLevel({
        kind,
        ...sensor,
        device_alert:
          reading.payload.alert_snapshot[kind === "mq2" ? "gas" : "co"],
      });
      if (
        level.ratio !== null &&
        (sensor.quality === "valid" || sensor.quality === "uncalibrated")
      )
        hasReading = true;
      if (level.rank !== null && (rank === null || level.rank > rank)) {
        rank = level.rank;
        label = level.label;
      }
    }
    return {
      name: kind === "mq2" ? "Gas/khói" : "CO",
      rank,
      label,
      hasReading,
    };
  });
  const strongest = signals.reduce((a, b) =>
    (b.rank ?? -1) > (a.rank ?? -1) ? b : a,
  );
  const complete = signals.every((signal) => signal.hasReading);
  const rank = strongest.rank ?? -1;
  const label =
    rank > 0 ? strongest.label : complete ? "Bình thường" : "Chưa đủ dữ liệu";
  return { signals, rank, label, complete };
}
