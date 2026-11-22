import type { DeviceView, IncidentView, SpacesView } from "@iot/contracts";
import { apiPage } from "./api.js";
import { sensorFreshness } from "./freshness.js";
import { roomAir } from "./room-air.js";

export type OverviewAlert = {
  device_id: string;
  unresolved: boolean;
  incident_id: string | null;
  condition: IncidentView["condition"];
  updated_at: string;
};

export type OpenIncident = OverviewAlert & {
  severity: IncidentView["severity"] | null;
};
export type Tone = "danger" | "warning" | "unknown" | "normal";

export const tones: Record<Tone, string> = {
  danger: "Nguy hiểm",
  warning: "Cần chú ý",
  unknown: "Thiếu số đo",
  normal: "Bình thường",
};
export const conditions = { gas: "Gas/khói", co: "CO", flame: "Phát hiện lửa" };
export const stationStatuses = {
  online: { label: "Trực tuyến", tone: "normal" },
  offline: { label: "Mất kết nối", tone: "warning" },
  never_seen: { label: "Chưa gửi dữ liệu", tone: "unknown" },
} as const;

export async function fetchOpenIncidents(
  signal: AbortSignal,
): Promise<OpenIncident[]> {
  const incidents: OpenIncident[] = [];
  const params = new URLSearchParams({ status: "active", limit: "100" });
  do {
    const page = await apiPage<IncidentView[]>(`/alerts/incidents?${params}`, {
      signal,
    });
    for (const incident of page.data) {
      incidents.push({
        device_id: incident.device_id,
        incident_id: incident.id,
        unresolved: true,
        condition: incident.condition,
        severity: incident.severity,
        updated_at: incident.started_at ?? incident.first_observed_at,
      });
    }
    if (!page.meta?.next_cursor) break;
    params.set("cursor", page.meta.next_cursor);
  } while (true);
  return incidents;
}

export function dataIssue(device: DeviceView, now: number) {
  if (device.status !== "online") return stationStatuses[device.status].label;
  const reading = device.latest;
  if (!reading) return "Chưa có số đo";
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

export function incidentPath(incident: OpenIncident) {
  return incident.incident_id
    ? `/app/alerts/${incident.incident_id}`
    : `/app/alerts?device_id=${incident.device_id}`;
}

export function historyPath(now: number) {
  const params = new URLSearchParams({
    from: new Date(now - 24 * 3600000).toISOString(),
    to: new Date(now).toISOString(),
  });
  return `/app/alerts?${params}`;
}

function scopeTone(
  rooms: ReturnType<typeof roomAir>[],
  incidents: OpenIncident[],
): Tone {
  if (
    incidents.some((incident) => incident.severity === "critical") ||
    rooms.some((room) => room.rank === 3)
  )
    return "danger";
  if (incidents.length || rooms.some((room) => room.rank > 0)) return "warning";
  return rooms.length && rooms.every((room) => room.complete)
    ? "normal"
    : "unknown";
}

export function overviewStatus(
  catalog: SpacesView,
  devices: DeviceView[],
  incidents: OpenIncident[],
  now: number,
) {
  const areas = catalog.areas
    .filter((area) => !area.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const areaNames = new Map(areas.map((area) => [area.id, area.name]));
  const areaOrder = new Map(areas.map((area, index) => [area.id, index]));
  const roomCatalog = catalog.rooms.filter(
    (room) => !room.archived_at && areaNames.has(room.area_id),
  );
  const roomsById = new Map(roomCatalog.map((room) => [room.id, room]));
  const assignments = new Map(
    catalog.devices
      .filter((device) => !device.archived_at)
      .map((device) => [device.id, device.room_id]),
  );
  const stations = devices
    .filter((device) => !device.archived_at)
    .map((device) => {
      const room = roomsById.get(assignments.get(device.id) ?? "");
      return {
        device,
        room,
        location: room
          ? `${areaNames.get(room.area_id)} / ${room.name}`
          : "Chưa gán phòng",
        issue: dataIssue(device, now),
      };
    });
  const stationById = new Map(
    stations.map((station) => [station.device.id, station]),
  );
  const incidentsInSystem = incidents
    .flatMap((incident) => {
      const station = stationById.get(incident.device_id);
      return incident.unresolved && station ? [{ ...incident, station }] : [];
    })
    .sort(
      (a, b) =>
        Number(b.severity === "critical") - Number(a.severity === "critical") ||
        b.updated_at.localeCompare(a.updated_at),
    );
  const rooms = roomCatalog
    .map((room) => {
      const members = stations.filter(
        (station) => station.room?.id === room.id,
      );
      const physical = members.filter(
        (station) => station.device.source_kind === "physical",
      );
      const air = roomAir(
        (physical.length ? physical : members).map((station) => station.device),
        now,
      );
      const roomIncidents = incidentsInSystem.filter(
        (incident) => incident.station.room?.id === room.id,
      );
      return {
        room,
        areaName: areaNames.get(room.area_id) ?? "",
        members,
        incident: roomIncidents[0],
        ...air,
        tone: scopeTone([air], roomIncidents),
        simulated: members.length > 0 && !physical.length,
      };
    })
    .sort(
      (a, b) =>
        (areaOrder.get(a.room.area_id) ?? 0) -
          (areaOrder.get(b.room.area_id) ?? 0) ||
        a.room.name.localeCompare(b.room.name, "vi"),
    );
  const groups = areas.map((area) => {
    const areaRooms = rooms.filter((room) => room.room.area_id === area.id);
    return {
      ...area,
      tone: scopeTone(
        areaRooms,
        incidentsInSystem.filter(
          (incident) => incident.station.room?.area_id === area.id,
        ),
      ),
    };
  });
  return {
    groups,
    rooms,
    stations,
    incidents: incidentsInSystem,
    totalTone: scopeTone(rooms, incidentsInSystem),
  };
}
