import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CircleCheck,
  CircleHelp,
  Clock3,
  DoorOpen,
  Map,
  Radio,
  TriangleAlert,
  Wind,
} from "lucide-react";
import { Link } from "react-router";
import type { DeviceView, SpacesView } from "@iot/contracts";
import { LoadState, PageTitle } from "../components/FeatureUI.js";
import { api } from "../lib/api.js";
import {
  conditions,
  fetchOpenIncidents,
  historyPath,
  incidentPath,
  overviewStatus,
  stationStatuses,
  tones,
  type OverviewAlert,
  type Tone,
} from "../lib/overview-status.js";
import "./overview.css";

export type { OverviewAlert } from "../lib/overview-status.js";

type Status = ReturnType<typeof overviewStatus>;
type Room = Status["rooms"][number];
type Incident = Status["incidents"][number];

const statusIcons = {
  danger: TriangleAlert,
  warning: TriangleAlert,
  unknown: CircleHelp,
  normal: CircleCheck,
};

function StatusMark({ tone, children }: { tone: Tone; children?: ReactNode }) {
  const Icon = statusIcons[tone];
  return (
    <span className="overview-status" data-tone={tone}>
      <Icon aria-hidden="true" />
      {children ?? tones[tone]}
    </span>
  );
}

function IncidentName({ incident }: { incident: Incident }) {
  const { station, condition } = incident;
  return (
    <>
      {conditions[condition]} · {station.location}
      {station.device.source_kind === "simulator" && " · Mô phỏng"}
    </>
  );
}

function Coverage({ rooms, showArea }: { rooms: Room[]; showArea: boolean }) {
  if (!rooms.length) return null;
  const complete = rooms.filter((room) => room.complete).length;
  return (
    <div className="overview-coverage">
      <div className="overview-coverage-heading">
        <h3>Số đo theo phòng</h3>
        <strong>
          {complete}/{rooms.length} phòng có đủ số đo
        </strong>
      </div>
      <p className="overview-note">
        Một phòng đủ số đo khi có cả Gas/khói và CO còn mới.
      </p>
      <ul className="overview-coverage-list">
        {rooms.map((room) => (
          <li key={room.room.id}>
            <a href={`#overview-room-${room.room.id}`}>
              {room.room.name}
              {showArea && <small>{room.areaName}</small>}
              <StatusMark tone={room.complete ? "normal" : "unknown"}>
                {room.complete
                  ? "Đủ số đo"
                  : room.members.length
                    ? "Thiếu số đo"
                    : "Chưa gán thiết bị"}
              </StatusMark>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoomCard({ room }: { room: Room }) {
  const { members, tone } = room;
  const status = !room.incident && room.rank > 0 ? room.label : tones[tone];
  return (
    <article
      id={`overview-room-${room.room.id}`}
      tabIndex={-1}
      className="panel overview-room"
      data-tone={room.tone}
    >
      <div className="overview-room-heading">
        <span className="overview-room-icon">
          <DoorOpen aria-hidden="true" />
        </span>
        <div>
          <h3>{room.room.name}</h3>
          <p className="overview-note">
            {room.areaName}
            {room.simulated && " · Mô phỏng"}
          </p>
        </div>
      </div>
      {tone === "danger" || tone === "warning" ? (
        <Link
          className="overview-room-status overview-room-map-link"
          to={`/app/spaces/${room.room.area_id}#ag-map-room-${room.room.id}`}
          aria-label={`${status} · Xem sơ đồ phòng ${room.room.name}`}
        >
          <StatusMark tone={tone}>{status}</StatusMark>
          <ArrowUpRight aria-hidden="true" />
        </Link>
      ) : (
        <span className="overview-room-status">
          <StatusMark tone={tone}>{status}</StatusMark>
        </span>
      )}
      <dl className="overview-signals">
        {room.signals.map((reading) => (
          <div key={reading.name}>
            <dt>{reading.name}</dt>
            <dd>
              <StatusMark
                tone={
                  reading.rank === null
                    ? "unknown"
                    : reading.rank === 0
                      ? "normal"
                      : reading.rank === 3
                        ? "danger"
                        : "warning"
                }
              >
                {reading.rank === null ? "Chưa có số đo" : reading.label}
              </StatusMark>
            </dd>
          </div>
        ))}
      </dl>
      {members.length > 0 ? (
        <details className="overview-devices">
          <summary>
            <Radio aria-hidden="true" />
            <span className="overview-device-show">
              Xem {members.length} thiết bị
            </span>
            <span className="overview-device-hide">
              Thu gọn {members.length} thiết bị
            </span>
          </summary>
          <ul>
            {members.map(({ device }) => {
              const status = stationStatuses[device.status];
              return (
                <li key={device.id}>
                  <Link to={`/app/monitoring/${device.id}`}>
                    <span>{device.name}</span>
                    <StatusMark tone={status.tone}>{status.label}</StatusMark>
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
      ) : (
        <p className="overview-note">Chưa gán thiết bị</p>
      )}
    </article>
  );
}

function Attention({
  incidents,
  stations,
  checking,
}: {
  incidents: Status["incidents"];
  stations: Status["stations"];
  checking: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = [
    ...incidents.map((incident) => ({
      key:
        incident.incident_id ?? `${incident.device_id}-${incident.condition}`,
      device: incident.station.device,
      label:
        incident.condition === "flame"
          ? conditions.flame
          : `Cảnh báo ${conditions[incident.condition]}`,
      location: incident.station.location,
      tone: (incident.severity === "critical" ? "danger" : "warning") as Tone,
      path: incidentPath(incident),
    })),
    ...stations.flatMap(({ device, issue, location }) =>
      issue
        ? [
            {
              key: device.id,
              device,
              label: issue,
              location,
              tone:
                stationStatuses[device.status].tone === "normal"
                  ? ("unknown" as const)
                  : stationStatuses[device.status].tone,
              path: `/app/monitoring/${device.id}`,
            },
          ]
        : [],
    ),
  ];
  return (
    <aside
      className="panel overview-attention"
      aria-labelledby="overview-attention-title"
    >
      <h2 id="overview-attention-title">
        <Activity aria-hidden="true" /> Cần chú ý
      </h2>
      {items.length ? (
        <>
          <ul>
            {(expanded ? items : items.slice(0, 3)).map((item) => (
              <li key={item.key}>
                <Link to={item.path}>
                  <div className="overview-attention-copy">
                    <strong>{item.device.name}</strong>
                    <StatusMark tone={item.tone}>{item.label}</StatusMark>
                    <small>
                      {item.location}
                      {item.device.source_kind === "simulator" && " · Mô phỏng"}
                    </small>
                  </div>
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {items.length > 3 && (
            <button
              type="button"
              className="overview-more"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Thu gọn" : `Xem thêm ${items.length - 3} mục`}
            </button>
          )}
        </>
      ) : (
        <p className="overview-note">
          {checking
            ? "Đang kiểm tra trạng thái sự cố."
            : stations.length
              ? "Chưa ghi nhận sự cố đang mở hoặc thiết bị cần kiểm tra."
              : "Chưa có thiết bị"}
        </p>
      )}
    </aside>
  );
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
  const [areaId, setAreaId] = useState<string>();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const spaces = useQuery({
    queryKey: ["monitoring-spaces"],
    queryFn: () => api<SpacesView>("/spaces"),
    refetchInterval: 10000,
  });
  const open = useQuery({
    queryKey: ["incidents", "overview-open"],
    queryFn: ({ signal }) => fetchOpenIncidents(signal),
    refetchInterval: 10000,
  });
  const daily = useQuery({
    queryKey: ["incidents", "overview-day"],
    queryFn: () =>
      api<{ opened: number; ended: number }>("/alerts/overview-day"),
    refetchInterval: 60000,
  });
  if (!spaces.data || spaces.isError)
    return (
      <LoadState
        pending={spaces.isPending}
        error={spaces.error}
        retry={() => void spaces.refetch()}
      />
    );

  const checking = !open.isSuccess && alerts === undefined;
  const incidents = open.isSuccess
    ? open.data
    : (alerts ?? []).map((alert) => ({ ...alert, severity: null }));
  const status = overviewStatus(spaces.data, devices, incidents, now);
  const area = status.groups.find((group) => group.id === areaId);
  const rooms = status.rooms.filter(
    (room) => !area || area.id === room.room.area_id,
  );
  const scopedIncidents = status.incidents.filter(
    (incident) => !area || area.id === incident.station.room?.area_id,
  );
  const stations = status.stations.filter(
    (station) => !area || area.id === station.room?.area_id,
  );
  const outside = area
    ? status.groups.filter(
        (group) =>
          group.id !== area.id &&
          (group.tone === "danger" || group.tone === "warning"),
      )
    : [];
  const unassigned = status.incidents.filter(
    (incident) => !incident.station.room,
  );
  const showOutside = area && (outside.length > 0 || unassigned.length > 0);
  const tone = area?.tone ?? status.totalTone;
  const needsAttentionRoom = [...rooms]
    .sort((a, b) => b.rank - a.rank)
    .find((room) => room.rank > 0);
  const leadIncident = scopedIncidents[0];
  const roomsComplete = rooms.filter((room) => room.complete).length;
  const headline =
    tone === "danger"
      ? "Có dấu hiệu nguy hiểm"
      : tone === "warning"
        ? "Có nơi cần chú ý"
        : !rooms.length
          ? "Chưa có phòng để theo dõi"
          : roomsComplete < rooms.length
            ? roomsComplete
              ? "Một số phòng còn thiếu số đo"
              : "Chưa đủ số đo để đánh giá"
            : checking
              ? "Đang kiểm tra trạng thái sự cố"
              : "Tín hiệu khí trong ngưỡng bình thường";
  const mapPath = area ? `/app/spaces/${area.id}` : "/app/spaces";
  const scopeLabel = area?.name ?? "Tất cả khu vực";

  return (
    <div className="overview-dashboard">
      {status.groups.length > 0 && (
        <div className="overview-areas" role="group" aria-label="Chọn khu vực">
          <button
            type="button"
            className="overview-area"
            aria-pressed={!area}
            onClick={() => setAreaId(undefined)}
          >
            <span>
              <Building2 aria-hidden="true" /> Tất cả khu vực
            </span>
            <StatusMark
              tone={
                checking && status.totalTone === "normal"
                  ? "unknown"
                  : status.totalTone
              }
            >
              {checking && status.totalTone === "normal"
                ? "Đang kiểm tra"
                : undefined}
            </StatusMark>
          </button>
          {status.groups.map((group) => (
            <button
              type="button"
              key={group.id}
              className="overview-area"
              aria-pressed={area?.id === group.id}
              onClick={() => setAreaId(group.id)}
            >
              <span>{group.name}</span>
              <StatusMark
                tone={
                  checking && group.tone === "normal" ? "unknown" : group.tone
                }
              >
                {checking && group.tone === "normal"
                  ? "Đang kiểm tra"
                  : undefined}
              </StatusMark>
            </button>
          ))}
        </div>
      )}
      {showOutside && (
        <div
          className="overview-outside"
          data-tone={
            outside.some((group) => group.tone === "danger") ||
            unassigned.some((incident) => incident.severity === "critical")
              ? "danger"
              : "warning"
          }
          role="status"
        >
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>Cần chú ý ngoài khu vực đang xem</strong>
            <p>
              {[
                ...outside.map((group) => group.name),
                unassigned.length > 0 &&
                  `${unassigned.length} sự cố ở thiết bị chưa gán phòng`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button type="button" onClick={() => setAreaId(undefined)}>
            Xem tất cả khu vực
          </button>
        </div>
      )}
      <div className="overview-top">
        <section
          className="panel overview-main"
          data-tone={checking && tone === "normal" ? "unknown" : tone}
          aria-labelledby="overview-status-title"
        >
          <div className="overview-headline">
            <span className="overview-hero-icon">
              <Wind aria-hidden="true" />
            </span>
            <div>
              <p className="overview-note">
                {scopeLabel}
                {rooms.length > 0 &&
                  rooms.every((room) => room.simulated) &&
                  " · Mô phỏng"}
              </p>
              <h2 id="overview-status-title">{headline}</h2>
              {leadIncident && (
                <p>
                  <IncidentName incident={leadIncident} />
                </p>
              )}
              {needsAttentionRoom && (
                <p>
                  {needsAttentionRoom.areaName} / {needsAttentionRoom.room.name}{" "}
                  ·{" "}
                  {needsAttentionRoom.signals
                    .filter((signal) => signal.rank === needsAttentionRoom.rank)
                    .map((signal) => signal.name)
                    .join(" và ")}{" "}
                  · {needsAttentionRoom.label}
                  {needsAttentionRoom.simulated && " · Mô phỏng"}
                </p>
              )}
              <div className="overview-actions">
                <Link className="overview-action" to={mapPath}>
                  <Map aria-hidden="true" />
                  {area ? "Xem sơ đồ khu vực" : "Xem khu vực và phòng"}
                </Link>
              </div>
            </div>
          </div>
          <Coverage
            rooms={rooms}
            showArea={!area && status.groups.length > 1}
          />
          {open.isError && (
            <p className="overview-note">
              Chưa tải được mức độ sự cố.{" "}
              <button type="button" onClick={() => void open.refetch()}>
                Thử lại
              </button>
            </p>
          )}
        </section>
        <Attention
          key={area?.id ?? "all"}
          incidents={scopedIncidents}
          stations={stations}
          checking={checking}
        />
      </div>
      <section
        className="overview-rooms"
        aria-labelledby="overview-rooms-title"
      >
        <h2 id="overview-rooms-title">Không khí theo phòng</h2>
        {rooms.length ? (
          <div className="overview-room-grid">
            {rooms.map((room) => (
              <RoomCard key={room.room.id} room={room} />
            ))}
          </div>
        ) : (
          <p className="overview-note">
            Thêm phòng và gán thiết bị trong Khu vực &amp; phòng để xem số đo.
          </p>
        )}
      </section>
      <section
        className="panel overview-history"
        aria-labelledby="overview-history-title"
      >
        <header className="overview-history-header">
          <span className="overview-room-icon">
            <Clock3 aria-hidden="true" />
          </span>
          <div>
            <h2 id="overview-history-title">Diễn biến 24 giờ qua</h2>
            <p className="overview-note">Toàn hệ thống</p>
          </div>
          <Link className="overview-action" to={historyPath(now)}>
            Xem chi tiết <ArrowRight aria-hidden="true" />
          </Link>
        </header>
        <LoadState
          pending={daily.isPending}
          error={daily.error}
          retry={() => void daily.refetch()}
        />
        {daily.isSuccess && (
          <dl className="overview-counts">
            <div className="overview-count-opened">
              <dt>
                <ArrowUpRight aria-hidden="true" /> Sự cố phát sinh
              </dt>
              <dd>{daily.data.opened}</dd>
            </div>
            <div className="overview-count-ended">
              <dt>
                <ArrowDownRight aria-hidden="true" /> Sự cố đã kết thúc
              </dt>
              <dd>{daily.data.ended}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
