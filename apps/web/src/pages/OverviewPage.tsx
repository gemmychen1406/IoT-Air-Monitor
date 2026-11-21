import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { DeviceView, IncidentView, SpacesView } from "@iot/contracts";
import { dateText, LoadState, PageTitle } from "../components/FeatureUI.js";
import { sensorFreshness } from "../lib/freshness.js";
import { roomAir } from "../lib/room-air.js";
import { api } from "../lib/api.js";

export type OverviewAlert = {
  device_id: string;
  unresolved: boolean;
  incident_id: string | null;
  condition: IncidentView["condition"];
  updated_at: string;
};

function dataIssue(device: DeviceView, now: number) {
  if (device.status === "never_seen") return "Chưa gửi dữ liệu lần nào";
  if (device.status === "offline") return "Mất kết nối";
  if (!device.latest) return "Chưa có số đo";
  const reading = device.latest;
  for (const [key, sensor] of Object.entries(reading.payload.sensors)) {
    const freshness = sensorFreshness(
      reading,
      sensor.age_ms,
      now,
      key === "mq7" ? 180000 : 15000,
    );
    if (freshness !== "Dữ liệu mới") return freshness;
  }
  return null;
}

export default function OverviewPage({
  devices,
  alerts,
}: {
  devices?: DeviceView[];
  alerts?: OverviewAlert[];
}) {
  return (
    <>
      <PageTitle title="Tổng quan hệ thống" />
      {devices && <HouseOverview devices={devices} alerts={alerts} />}
    </>
  );
}

function HouseOverview({
  devices,
  alerts,
}: {
  devices: DeviceView[];
  alerts?: OverviewAlert[];
}) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const spaces = useQuery({
    queryKey: ["monitoring-spaces"],
    queryFn: () => api<SpacesView>("/spaces"),
    refetchInterval: 10000,
  });
  const daily = useQuery({
    queryKey: ["incidents", "overview-day"],
    queryFn: () =>
      api<{ opened: number; ended: number }>("/alerts/overview-day"),
    refetchInterval: 60000,
  });
  const catalog = spaces.data;
  if (!catalog || spaces.isError)
    return (
      <LoadState
        pending={spaces.isPending}
        error={spaces.error}
        retry={() => void spaces.refetch()}
      />
    );
  const activeAreas = new Map(
    catalog.areas
      .filter((area) => !area.archived_at)
      .map((area) => [area.id, area.name]),
  );
  const activeRooms = catalog.rooms.filter(
    (room) => !room.archived_at && activeAreas.has(room.area_id),
  );
  const rooms = new Map(activeRooms.map((room) => [room.id, room.name]));
  const assignments = new Map(
    catalog.devices
      .filter((device) => !device.archived_at)
      .map((device) => [device.id, device.room_id]),
  );
  function station(device: DeviceView) {
    const room = rooms.get(assignments.get(device.id) ?? "");
    return [room, device.name, device.source_kind === "simulator" && "Mô phỏng"]
      .filter(Boolean)
      .join(" · ");
  }
  const stations = new Map(devices.map((device) => [device.id, device]));
  const incidents = (alerts ?? [])
    .filter((alert) => alert.unresolved && stations.has(alert.device_id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const issues = devices.flatMap((device) => {
    const reason = dataIssue(device, now);
    return reason ? [{ device, reason }] : [];
  });
  const members = new Map<string, DeviceView[]>();
  for (const device of devices) {
    const roomId = assignments.get(device.id);
    if (roomId && rooms.has(roomId)) {
      const assigned = members.get(roomId) ?? [];
      assigned.push(device);
      members.set(roomId, assigned);
    }
  }
  const readings = activeRooms
    .map((room) => {
      const assigned = members.get(room.id) ?? [];
      const physical = assigned.filter(
        (device) => device.source_kind === "physical",
      );
      const simulated = assigned.length > 0 && !physical.length;
      return {
        key: room.id,
        name: room.name,
        area: activeAreas.get(room.area_id),
        devices: assigned,
        simulated,
        ...roomAir(physical.length ? physical : assigned, now),
      };
    })
    .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, "vi"));
  const hasPhysical = readings.some(
    (room) => room.devices.length && !room.simulated,
  );
  const observed = readings.filter((room) => !hasPhysical || !room.simulated);
  const demoOnly = !hasPhysical && readings.some((room) => room.simulated);
  const highest = observed[0];
  const elevated = highest?.signals
    .filter((signal) => signal.rank === highest.rank)
    .map((signal) => signal.name)
    .join(" và ");
  const headline =
    highest && highest.rank > 0
      ? highest.name +
        " · " +
        elevated +
        " ở mức " +
        highest.label.toLocaleLowerCase("vi")
      : observed.some((room) => room.complete)
        ? "Tín hiệu khí trong ngưỡng bình thường tại các phòng đủ dữ liệu"
        : "Chưa đủ dữ liệu để đánh giá không khí";
  const rows = [
    ...incidents.map((alert) => ({
      key: alert.device_id + alert.condition,
      station: station(stations.get(alert.device_id)!),
      reason:
        "Cảnh báo " + { gas: "gas", co: "CO", flame: "lửa" }[alert.condition],
      time: "Cập nhật " + dateText(alert.updated_at),
      path: alert.incident_id
        ? "/app/alerts/" + alert.incident_id
        : "/app/alerts?device_id=" + alert.device_id,
      action: "Xem sự cố",
    })),
    ...issues.map(({ device, reason }) => ({
      key: device.id,
      station: station(device),
      reason,
      time: device.last_seen_at
        ? "Liên lạc gần nhất " + dateText(device.last_seen_at)
        : "",
      path: "/app/monitoring/" + device.id,
      action: "Kiểm tra trạm",
    })),
  ];
  return (
    <div className="overview-sections">
      {readings.length > 0 && (
        <section className="panel overview-summary">
          <p className="muted">
            Chất lượng không khí hiện tại{demoOnly && " · Mô phỏng"}
          </p>
          <h2>{headline}</h2>
          <p>
            {observed.filter((room) => room.complete).length}/{observed.length}{" "}
            khu vực có đủ tín hiệu gas/khói và CO. Mức hiển thị là ước tính từ
            hai cảm biến khí.
          </p>
        </section>
      )}
      <section className="panel overview-section">
        <h2>Không khí theo phòng</h2>
        {!readings.length && (
          <p>
            Chưa có phòng đang hoạt động.{" "}
            <Link to="/app/spaces">Quản lý khu vực và phòng</Link>
          </p>
        )}
        {!devices.length && <p>Chưa có thiết bị</p>}
        <div className="air-room-grid">
          {readings.map((room) => (
            <article className="air-room" key={room.key}>
              <div>
                <h3>{room.name}</h3>
                <small className="muted">{room.area} </small>
                {room.simulated && <small className="muted">Mô phỏng</small>}
              </div>
              <strong
                className={
                  "air-level air-level-" +
                  (room.label === "Chưa đủ dữ liệu" ? "unknown" : room.rank)
                }
              >
                {room.label}
              </strong>
              <dl>
                {room.signals.map((signal) => (
                  <div key={signal.name}>
                    <dt>{signal.name}</dt>
                    <dd>{signal.label}</dd>
                  </div>
                ))}
              </dl>
              {!room.devices.length && (
                <p className="muted">Chưa gán thiết bị</p>
              )}
              {room.devices.map((device) => (
                <Link key={device.id} to={"/app/monitoring/" + device.id}>
                  {room.devices.length === 1 ? "Xem số đo" : device.name}
                </Link>
              ))}
            </article>
          ))}
        </div>
      </section>
      <details className="panel overview-section">
        <summary>
          Sự cố và tình trạng thiết bị
          {incidents.length > 0 && " · " + incidents.length + " sự cố đang mở"}
        </summary>
        {rows.length ? (
          <ul>
            {(expanded ? rows : rows.slice(0, 5)).map((row) => (
              <li key={row.key}>
                <div>
                  <strong>{row.station}</strong>
                  <p>{row.reason}</p>
                  {row.time && <small className="muted">{row.time}</small>}
                </div>
                <Link to={row.path}>{row.action}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {!devices.length
              ? "Chưa có trạm để theo dõi."
              : alerts
                ? "Các trạm đều có dữ liệu mới và chưa ghi nhận sự cố đang mở."
                : "Các trạm đều có dữ liệu mới. Chưa xác định được trạng thái sự cố."}
          </p>
        )}
        {rows.length > 5 && (
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? "Thu gọn" : "Xem thêm " + (rows.length - 5) + " mục"}
          </button>
        )}
      </details>
      <section className="panel overview-section">
        <h2>Diễn biến 24 giờ qua</h2>
        <LoadState
          pending={daily.isPending}
          error={daily.error}
          retry={() => void daily.refetch()}
        />
        {daily.isSuccess && (
          <p>
            <strong>{daily.data.opened}</strong> sự cố phát sinh ·{" "}
            <strong>{daily.data.ended}</strong> sự cố đã kết thúc
          </p>
        )}
        <Link to="/app/alerts">Xem lịch sử sự cố</Link>
      </section>
    </div>
  );
}
