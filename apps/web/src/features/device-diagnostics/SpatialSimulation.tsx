import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { SpacesView, RoomMapView, RoomMapDevice } from "@iot/contracts";
import { api } from "../../lib/api.js";
import { LoadState } from "../../components/FeatureUI.js";
import { DistributionMap } from "./DistributionMap.js";
import { readStationAt } from "./room-history.js";
import { roomMeasurements, type GasMetric } from "./room-distribution.js";

function readRoom(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function localMinute(time: number) {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export default function SpatialSimulation({
  userId,
  onInspect,
}: {
  userId: string;
  onInspect: (id: string) => void;
}) {
  const storage = "airguard.diagnostics.room." + userId;
  const [chosen, choose] = useState(() => readRoom(storage));
  const [metric, setMetric] = useState<GasMetric>("mq2");
  const [preferred, source] = useState<"physical" | "simulator">("physical");
  const [now, setNow] = useState(Date.now);
  const [at, setAt] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  function goTo(time: number) {
    const minute = Math.floor(time / 60000) * 60000;
    setAt(minute);
    setDraft(localMinute(minute));
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const catalog = useQuery({
    queryKey: ["monitoring-spaces"],
    queryFn: () => api<SpacesView>("/spaces"),
    refetchInterval: 30000,
  });
  const areas = catalog.data?.areas.filter((a) => !a.archived_at) ?? [];
  const maps = useQueries({
    queries: areas.map((a) => ({
      queryKey: ["space-map", a.id],
      queryFn: () => api<RoomMapView>("/spaces/areas/" + a.id + "/map"),
      refetchInterval: 5000,
    })),
  });
  const rooms = areas.flatMap((a, i) =>
    (maps[i]?.data?.rooms ?? [])
      .filter((r) => !r.archived_at)
      .map((r) => ({ ...r, area: a })),
  );
  function usable(devices: RoomMapDevice[]) {
    return devices.filter((d) => !d.archived_at);
  }
  const room =
    rooms.find((r) => r.id === chosen) ??
    rooms.find(
      (r) => roomMeasurements(usable(r.devices), metric, now).points.length > 0,
    ) ??
    rooms[0];
  if (room && room.id !== chosen && maps.every((q) => q.isSuccess))
    choose(room.id);
  const available = usable(room?.devices ?? []);
  const kind = available.some((d) => d.source_kind === preferred)
    ? preferred
    : (available[0]?.source_kind ?? preferred);
  const stations = available.filter((device) => device.source_kind === kind);
  const history = useQueries({
    queries:
      at === null
        ? []
        : stations.map((device) => ({
            queryKey: ["room-history", userId, device.id, metric, at],
            queryFn: ({ signal }: { signal: AbortSignal }) =>
              readStationAt(device.id, metric, at, signal),
            staleTime: 30000,
          })),
  });
  const loadingHistory = history.some((q) => q.isPending);
  const historyError = history.find((q) => q.isError)?.error;
  const { points, anchors, surface, excluded } = roomMeasurements(
    at === null
      ? stations
      : stations.map((device, i) => ({
          ...device,
          latest: history[i]?.data ?? null,
        })),
    metric,
    at ?? now,
    at !== null,
  );
  const error = maps.find((q) => q.isError);
  return (
    <section className="panel dd-room">
      <h2>Phân bố tín hiệu theo phòng</h2>
      <LoadState
        pending={catalog.isPending || maps.some((q) => q.isPending)}
        error={catalog.error ?? error?.error}
        retry={() => {
          void catalog.refetch();
          for (const q of maps) void q.refetch();
        }}
      />
      {room ? (
        <>
          <div className="dd-room-controls">
            <label>
              Phòng
              <select
                value={room.id}
                onChange={(e) => {
                  choose(e.target.value);
                  try {
                    localStorage.setItem(storage, e.target.value);
                  } catch {
                    /* optional */
                  }
                }}
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.area.name} / {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Chỉ số
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as GasMetric)}
              >
                <option value="mq2">Gas/khói (MQ-2)</option>
                <option value="mq7">CO (MQ-7)</option>
              </select>
            </label>
            {new Set(available.map((d) => d.source_kind)).size > 1 && (
              <label>
                Nguồn
                <select
                  value={kind}
                  onChange={(e) => source(e.target.value as typeof kind)}
                >
                  <option value="physical">Thiết bị thật</option>
                  <option value="simulator">Mô phỏng</option>
                </select>
              </label>
            )}
          </div>
          <div className="dd-history">
            <div
              className="dd-plan-switch"
              role="group"
              aria-label="Thời điểm bản đồ"
            >
              <button aria-pressed={at === null} onClick={() => setAt(null)}>
                Trực tiếp
              </button>
              <button
                aria-pressed={at !== null}
                onClick={() => {
                  if (at === null) goTo(Date.now() - 60000);
                }}
              >
                Xem lại
              </button>
            </div>
            {at !== null && (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    goTo(new Date(draft).getTime());
                  }}
                >
                  <label>
                    Thời điểm (giờ địa phương)
                    <input
                      type="datetime-local"
                      required
                      value={draft}
                      max={localMinute(now)}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  </label>
                  <button type="submit">Xem mốc này</button>
                </form>
                <div className="dd-time-step">
                  <button
                    onClick={() => goTo(at - 60000)}
                    aria-label="Lùi một phút"
                  >
                    −1 phút
                  </button>
                  <button
                    disabled={at + 60000 > Date.now()}
                    onClick={() => goTo(at + 60000)}
                    aria-label="Tiến một phút"
                  >
                    +1 phút
                  </button>
                </div>
                <p>
                  Đang xem{" "}
                  <strong>
                    {new Date(at).toLocaleString("vi-VN", { hour12: false })}
                  </strong>{" "}
                  · Dữ liệu cũ trên vị trí trạm đang đăng ký.
                </p>
              </>
            )}
          </div>
          <LoadState
            pending={loadingHistory}
            error={historyError}
            retry={() => {
              for (const q of history) if (q.isError) void q.refetch();
            }}
          />
          {!loadingHistory && !historyError && (
            <>
              <p>
                <strong>
                  {points.length}/
                  {available.filter((d) => d.source_kind === kind).length} trạm
                  có điểm đo
                </strong>
                {available.length > 0 &&
                  (kind === "simulator" ? " · Mô phỏng" : " · Thiết bị thật")}
                {points.length > 0 &&
                  " · Mẫu mới nhất " +
                    new Date(
                      Math.max(...points.map((p) => Date.parse(p.sampledAt))),
                    ).toLocaleTimeString("vi-VN")}
              </p>
              {!surface && (
                <p>
                  {points.length
                    ? "Chỉ hiển thị điểm đo. Cần ba vị trí đủ tách biệt để nội suy."
                    : at === null
                      ? "Chưa có điểm đo hợp lệ trong phòng."
                      : "Không có điểm đo hợp lệ tại mốc này. Hãy chọn thời điểm khác."}
                </p>
              )}
              {points.length > 0 && (
                <DistributionMap
                  key={room.id + metric + kind}
                  roomName={room.name}
                  {...{ points, anchors, surface, onInspect }}
                />
              )}
              {excluded.length > 0 && (
                <details className="dd-excluded">
                  <summary>{excluded.length} trạm chưa đưa vào bản đồ</summary>
                  {excluded.map((d, i) => (
                    <div key={i}>
                      <strong>{d.name}</strong>
                      <span>{d.reason}</span>
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
          <Link to={"/app/spaces/" + room.area.id}>
            Xem sơ đồ và vị trí trạm
          </Link>
        </>
      ) : (
        catalog.isSuccess &&
        !error &&
        maps.every((q) => q.isSuccess) && (
          <p>
            Chưa có phòng đang hoạt động.{" "}
            <Link to="/app/spaces">Mở quản lý khu vực và phòng</Link>
          </p>
        )
      )}
    </section>
  );
}
