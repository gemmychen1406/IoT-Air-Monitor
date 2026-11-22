import {
  ArrowDownRight,
  Flame,
  MapPin,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
  Wind,
} from 'lucide-react';
import type { RoomMapDevice, RoomMapView } from '@iot/contracts';

type MapRoom = RoomMapView['rooms'][number];
export type MapIncident = RoomMapDevice['open_incidents'][number];
export type LocatedIncident = {
  room: MapRoom;
  device: RoomMapDevice;
  incident: MapIncident;
};

export const incidentPriority = (incident: MapIncident) =>
  incident.severity === 'critical' ? 1 : 0;

export function incidentLabel(condition: string) {
  if (condition === 'flame') return 'Phát hiện lửa';
  if (condition === 'gas') return 'Cảnh báo khí gas';
  if (condition === 'co') return 'Cảnh báo khí CO';
  return condition;
}

function IncidentIcon({ condition }: { condition: string }) {
  if (condition === 'flame') return <Flame size={17} aria-hidden="true" />;
  if (condition === 'co') return <Wind size={17} aria-hidden="true" />;
  return <TriangleAlert size={17} aria-hidden="true" />;
}

export function AreaIncidentOverview({
  rooms,
  selectedIncident,
  onLocate,
  disabled,
}: {
  rooms: MapRoom[];
  selectedIncident: string | undefined;
  onLocate: (entry: LocatedIncident) => void;
  disabled: boolean;
}) {
  const incidents = rooms
    .flatMap((room) =>
      room.devices.flatMap((device) =>
        device.open_incidents.map((incident) => ({ room, device, incident })),
      ),
    )
    .sort(
      (a, b) => incidentPriority(b.incident) - incidentPriority(a.incident),
    );
  const critical = incidents.filter(
    ({ incident }) => incident.severity === 'critical',
  ).length;
  const offline = rooms.reduce(
    (count, room) =>
      count +
      room.devices.filter(
        (device) => !device.archived_at && device.status === 'offline',
      ).length,
    0,
  );
  return (
    <section className="ag-map-overview" aria-label="Tình trạng khu vực">
      <div className="ag-map-overview-heading">
        <span className="ag-map-overview-icon">
          <MapPin size={21} aria-hidden="true" />
        </span>
        <h3>Tình trạng khu vực</h3>
      </div>
      <dl
        className="ag-map-overview-stats"
        aria-live="polite"
        aria-atomic="true"
      >
        <div>
          <dt>Sự cố đang mở</dt>
          <dd>{incidents.length}</dd>
        </div>
        <div data-severity={critical ? 'critical' : undefined}>
          <dt>
            <TriangleAlert size={15} aria-hidden="true" /> Nghiêm trọng
          </dt>
          <dd>{critical}</dd>
        </div>
        <div>
          <dt>
            <WifiOff size={15} aria-hidden="true" /> Trạm mất kết nối
          </dt>
          <dd>{offline}</dd>
        </div>
      </dl>
      {incidents.length ? (
        <ul className="ag-map-incident-list" aria-label="Định vị sự cố đang mở">
          {incidents.map((entry) => {
            const { incident, room, device } = entry;
            const roomPrefix = `${room.name} · `;
            const location =
              device.name === room.name || device.name.startsWith(roomPrefix)
                ? device.name
                : roomPrefix + device.name;
            return (
              <li key={incident.id}>
                <button
                  type="button"
                  className="ag-map-incident-jump"
                  data-severity={incident.severity}
                  aria-pressed={selectedIncident === incident.id}
                  onClick={() => onLocate(entry)}
                  disabled={disabled}
                >
                  <span className="ag-map-incident-icon">
                    <IncidentIcon condition={incident.condition} />
                  </span>
                  <span className="ag-map-incident-copy">
                    <strong>{incidentLabel(incident.condition)}</strong>
                    <small>{location}</small>
                  </span>
                  <span className="ag-map-incident-jump-action">
                    Định vị <ArrowDownRight size={16} aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ag-map-overview-empty">
          <ShieldCheck size={17} aria-hidden="true" /> Hiện chưa có sự cố đang
          mở trong khu vực.
        </p>
      )}
    </section>
  );
}
