import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { SpacesView, RoomMapView, RoomMapDevice } from "@iot/contracts";
import { api } from "../../lib/api.js";
import { LoadState } from "../../components/FeatureUI.js";
import { DistributionMap } from "./DistributionMap.js";
import { roomMeasurements, type GasMetric } from "./room-distribution.js";

function readRoom(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
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
  const { points, anchors, surface, excluded } = roomMeasurements(
    available.filter((device) => device.source_kind === kind),
    metric,
    now,
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
          <p>
            <strong>
              {points.length}/
              {available.filter((d) => d.source_kind === kind).length} trạm có
              điểm đo
            </strong>
            {available.length > 0 &&
              (kind === "simulator" ? " · Mô phỏng" : " · Thiết bị thật")}
            {points.length > 0 &&
              " · Mẫu mới nhất " +
                new Date(
                  Math.max(...points.map((p) => Date.parse(p.sampledAt))),
                ).toLocaleTimeString("vi-VN")}
          </p>
          <p>
            {surface
              ? "Màu giữa các điểm là tín hiệu ước tính."
              : points.length
                ? "Chỉ hiển thị điểm đo. Cần ba vị trí đủ tách biệt để nội suy."
                : "Chưa có điểm đo hợp lệ trong phòng."}
          </p>
          {points.length > 0 && (
            <DistributionMap
              key={room.id + metric + kind}
              {...{ points, anchors, surface, onInspect }}
            />
          )}
          {excluded.length > 0 && (
            <details>
              <summary>{excluded.length} trạm chưa dùng được</summary>
              {excluded.map((d, i) => (
                <p key={i}>
                  {d.name} · {d.reason}
                </p>
              ))}
            </details>
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
