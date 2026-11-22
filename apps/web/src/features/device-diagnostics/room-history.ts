import type { ReadingView } from "@iot/contracts";
import { apiPage } from "../../lib/api.js";
import { freshnessWindow, type GasMetric } from "./room-distribution.js";

// The API pages by insertion ID. Buffered readings may arrive out of sample order.
export async function readStationAt(
  id: string,
  metric: GasMetric,
  at: number,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    from: new Date(at - freshnessWindow[metric]).toISOString(),
    to: new Date(at + 1).toISOString(),
    time_basis: "sampled",
    limit: "200",
  });
  let latest: ReadingView | null = null;
  let latestTime = -Infinity;
  for (;;) {
    const page = await apiPage<ReadingView[]>(
      `/devices/${id}/readings?${params}`,
      { signal },
    );
    for (const reading of page.data) {
      const stamp = reading.payload.sampled_at;
      if (!stamp || reading.payload.time_quality !== "synced") continue;
      const time = Date.parse(stamp);
      if (time <= at && time > latestTime) {
        latestTime = time;
        latest = reading;
      }
    }
    if (!page.meta.next_cursor) return latest;
    params.set("cursor", page.meta.next_cursor);
  }
}
