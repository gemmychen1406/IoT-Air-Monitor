import { useEffect, useState, type MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertOctagon, Check, CircleHelp, MapPin, TriangleAlert } from 'lucide-react';
import {
  mapThresholdInput,
  type AreaView,
  type MapThresholds,
  type RoomMapDevice,
  type RoomMapView,
  type RoomPosition,
} from '@iot/contracts';
import { dateText, LoadState } from '../../components/FeatureUI.js';
import { api } from '../../lib/api.js';
import { sensorFreshness } from '../../lib/freshness.js';
import { mapConnectionLabels, mapStatus, mapStatusLabels } from './map-status.js';
import './room-map.css';

const statusIcons = {
  danger: AlertOctagon,
  attention: TriangleAlert,
  normal: Check,
  unknown: CircleHelp,
};
const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;
type MapRoom = RoomMapView['rooms'][number];
type Placement = {
  version: number;
  deviceId: string;
  roomId: string;
  point: RoomPosition | null;
};

function DeviceLabel({
  device,
  state,
}: {
  device: RoomMapDevice;
  state: ReturnType<typeof mapStatus>;
}) {
  const Icon = statusIcons[state.tone];
  return (
    <>
      <span className="ag-map-dot" data-tone={state.tone}>
        <Icon size={15} aria-hidden="true" />
      </span>
      <span className="ag-map-device-name">{device.name}</span>
    </>
  );
}

function RoomTile({
  room,
  now,
  thresholds,
  selected,
  placement,
  onSelect,
  onPoint,
  unassigned,
  onAssign,
  editable,
  onDrag,
}: {
  unassigned: { id: string; name: string }[];
  onAssign: (id: string, room: string) => Promise<unknown>;
  editable: boolean;
  onDrag: (id: string, point: RoomPosition, version: number) => void;
  room: MapRoom;
  now: number;
  thresholds: MapThresholds;
  selected: string | null;
  placement: Placement | null;
  onSelect: (id: string) => void;
  onPoint: (point: RoomPosition) => void;
}) {
  const [assigning, setAssigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const placing = placement?.roomId === room.id;
  function point(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) return onPoint({ x: 0.5, y: 0.5 });
    const rect = event.currentTarget.getBoundingClientRect();
    const unit = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
    onPoint({
      x: unit((event.clientX - rect.left) / rect.width),
      y: unit((event.clientY - rect.top) / rect.height),
    });
  }
  const unplaced = room.devices.filter((device) => !device.position);
  return (
    <article className="ag-map-room" aria-label={room.name} data-archived={!!room.archived_at}>
      <header>
        <h3>{room.name}</h3>
        <span>{room.devices.length} thiết bị</span>
        {room.archived_at ? <span className="badge">Đã lưu trữ</span> : null}
      </header>
      <p>
        {room.devices.filter((d) => d.status === 'online').length} đang kết nối ·{' '}
        {room.devices.filter((d) => d.open_incidents.length > 0).length} thiết bị có sự cố ·{' '}
        {room.devices.filter((d) => d.status === 'never_seen').length} chưa từng gửi
      </p>
      {editable && <button onClick={() => setAssigning(!assigning)}>Gán thiết bị</button>}
      {editable && assigning && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const id = String(new FormData(e.currentTarget).get('device'));
            setSaving(true);
            try {
              await onAssign(id, room.id);
              setAssigning(false);
              onSelect(id);
            } catch {
              /* parent displays API error */
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            Thiết bị chưa gán
            <select name="device" required>
              <option value="">Chọn thiết bị</option>
              {unassigned.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={saving || !unassigned.length}>Lưu</button>
        </form>
      )}
      <div
        className="ag-map-canvas"
        onDragOver={(e) => {
          if (editable) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('text/plain');
          if (!editable || !room.devices.some((d) => d.id === id && !d.archived_at)) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const clamp = (n: number) => Math.max(0, Math.min(1, n));
          const version = e.dataTransfer.getData('application/x-airguard-layout');
          if (!/^\d+$/.test(version)) return;
          onDrag(
            id,
            {
              x: clamp((e.clientX - rect.left) / rect.width),
              y: clamp((e.clientY - rect.top) / rect.height),
            },
            Number(version),
          );
        }}
      >
        {room.devices.map((device) => {
          const position = device.position;
          if (!position) return null;
          const state = mapStatus(device, thresholds, now);
          return (
            <button
              type="button"
              className="ag-map-pin"
              key={device.id}
              style={{ left: percent(position.x), top: percent(position.y) }}
              data-edge={position.x < 0.25 ? 'left' : position.x > 0.75 ? 'right' : 'center'}
              data-high={position.y > 0.76}
              draggable={editable && !device.archived_at}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', device.id);
                e.dataTransfer.setData(
                  'application/x-airguard-layout',
                  String(room.layout_version),
                );
              }}
              aria-pressed={selected === device.id}
              aria-label={`${device.name}: ${mapStatusLabels[state.tone]}, ${mapConnectionLabels[device.status]}`}
              disabled={placing}
              onClick={() => onSelect(device.id)}
            >
              <DeviceLabel device={device} state={state} />
            </button>
          );
        })}
        {placing ? (
          <button
            type="button"
            className="ag-map-surface"
            aria-label={`Chọn vị trí trong ${room.name}`}
            onClick={point}
          >
            <span>Bấm để chọn vị trí</span>
          </button>
        ) : null}
        {placing && placement.point ? (
          <span
            className="ag-map-preview"
            style={{
              left: percent(placement.point.x),
              top: percent(placement.point.y),
            }}
          >
            <MapPin size={22} aria-hidden="true" />
          </span>
        ) : null}
        {!placing && !room.devices.some((d) => d.position) ? <p>Chưa có điểm trên sơ đồ</p> : null}
      </div>
      {unplaced.length ? (
        <ul className="ag-map-unplaced">
          {unplaced.map((device) => {
            const state = mapStatus(device, thresholds, now);
            return (
              <li key={device.id}>
                <button
                  type="button"
                  draggable={editable && !device.archived_at}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', device.id);
                    e.dataTransfer.setData(
                      'application/x-airguard-layout',
                      String(room.layout_version),
                    );
                  }}
                  aria-pressed={selected === device.id}
                  onClick={() => onSelect(device.id)}
                >
                  <DeviceLabel device={device} state={state} />
                  <small>Chưa đặt vị trí · {mapStatusLabels[state.tone]}</small>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}

function incidentLink(incident: RoomMapDevice['open_incidents'][number]) {
  const name = { flame: 'lửa', gas: 'Gas', co: 'CO' }[incident.condition] ?? incident.condition;
  return (
    <Link
      key={incident.id}
      to={`/app/alerts/${incident.id}`}
      className="ag-incident-action"
      data-severity={incident.severity}
    >
      {incident.condition === 'flame' ? '🔥' : '⚠'} Xem sự cố {name} ·{' '}
      {incident.severity.toUpperCase()}
    </Link>
  );
}

function StatusDetails({
  device,
  room,
  now,
  thresholds,
  canEdit,
  placement,
  pending,
  onRemove,
  onStart,
  onCancel,
  onSave,
}: {
  device: RoomMapDevice;
  room: MapRoom;
  now: number;
  thresholds: MapThresholds;
  canEdit: boolean;
  placement: Placement | null;
  pending: boolean;
  onRemove?: () => void;
  onStart: () => void;
  onCancel: () => void;
  onSave: (point: RoomPosition) => void;
}) {
  const { tone, reason } = mapStatus(device, thresholds, now);
  const sensors = device.latest?.payload.sensors;
  const incidents = [...device.open_incidents].sort((a,b) => Number(b.severity === 'critical') - Number(a.severity === 'critical'));
  const severityFor = (condition: string) => incidents.find(i => i.condition === condition)?.severity;
  const freshness = device.latest ? sensorFreshness(device.latest, 0, now) : 'Chưa có mẫu';

  function measurement(value: number | null | undefined, unit: string) {
    return value === undefined || value === null ? '—' : `${value} ${unit}`;
  }
  return (
    <aside className="ag-map-detail" aria-label="Chi tiết điểm">
      <span className="eyebrow">{room.name}</span>
      <h3>{device.name}</h3>
      <div className="ag-map-details-status">
        {device.open_incidents.length === 1 ? (
          incidentLink(device.open_incidents[0]!)
        ) : device.open_incidents.length > 1 ? (
          <>
          {incidentLink(incidents[0]!)}
          <details>
            <summary
              className="ag-incident-action"
              data-severity={
                device.open_incidents.some((i) => i.severity === 'critical')
                  ? 'critical'
                  : 'warning'
              }
            >
              ⚠ Xem {device.open_incidents.length} sự cố ·{' '}
              {Array.from(new Set(device.open_incidents.map((i) => i.severity.toUpperCase()))).join(
                ' / ',
              )}
            </summary>
            {incidents.slice(1).map(incidentLink)}
          </details>
          </>
        ) : (
          <span className="ag-map-state" data-tone={tone}>
            {mapStatusLabels[tone]}
          </span>
        )}
        <span className="badge">{mapConnectionLabels[device.status]}</span>
      </div>
      {device.source_kind === 'simulator' ? <p className="caption">Dữ liệu mô phỏng</p> : null}
      <p>{incidents.length && device.status === 'offline' ? 'Sự cố chưa kết thúc · Thiết bị mất kết nối' : reason}</p>
      <strong>Số đo cuối cùng</strong>
      <p className="caption">{dateText(device.latest?.payload.sampled_at)} · {freshness}</p>
      <dl className="ag-map-readings">
        <dt>Nhiệt độ</dt>
        <dd>{measurement(sensors?.dht11.temperature_c, '°C')}</dd>
        <dt>Độ ẩm</dt>
        <dd>{measurement(sensors?.dht11.humidity_pct, '%RH')}</dd>
        <dt data-alert={severityFor('gas')}>MQ-2</dt>
        <dd>{measurement(sensors?.mq2.adc_raw, 'ADC')}</dd>
        <dt data-alert={severityFor('co')}>MQ-7</dt>
        <dd>{measurement(sensors?.mq7.adc_raw, 'ADC')}</dd>
        <dt data-alert={sensors?.flame.detected ? severityFor('flame') : undefined}>Cảm biến lửa</dt>
        <dd>
          {sensors?.flame.detected == null
            ? '—'
            : sensors.flame.detected
              ? 'Có tín hiệu'
              : 'Không phát hiện'}
        </dd>
        <dt>Server nhận</dt>
        <dd>{dateText(device.latest?.received_at)}</dd>
        <dt>Liên lạc cuối</dt>
        <dd>{dateText(device.last_seen_at)}</dd>
      </dl>
      {canEdit ? (
        placement ? (
          <div className="ag-map-actions">
            <p className="caption">
              {placement.point
                ? `Vị trí mới: X ${percent(placement.point.x)} · Y ${percent(placement.point.y)}`
                : 'Chọn điểm trong khung phòng.'}
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={!placement.point || pending}
                onClick={() => {
                  if (placement.point) onSave(placement.point);
                }}
              >
                Lưu vị trí
              </button>
              <button disabled={pending} onClick={onCancel}>
                Hủy
              </button>
            </div>
          </div>
        ) : (
          <button onClick={onStart} disabled={pending}>
            {device.position ? 'Đổi vị trí' : 'Đặt lên sơ đồ'}
          </button>
        )
      ) : null}
      {onRemove && (
        <button disabled={pending} onClick={onRemove}>
          Gỡ khỏi phòng
        </button>
      )}
      <div className="ag-map-links">
        <Link to={`/app/devices/${device.id}`}>Chi tiết thiết bị</Link>
      </div>
    </aside>
  );
}

export default function RoomMap({
  areas,
  area,
  onAreaChange,
  unassigned,
  onAssign,
  canEdit,
}: {
  unassigned: { id: string; name: string }[];
  onAssign: (id: string, room: string) => Promise<unknown>;
  areas: AreaView[];
  area: AreaView | undefined;
  onAreaChange: (id: string) => void;
  canEdit: boolean;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [thresholdError, setThresholdError] = useState(false);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const map = useQuery({
    queryKey: ['space-map', area?.id],
    queryFn: () => api<RoomMapView>(`/spaces/areas/${area!.id}/map`),
    enabled: !!area,
    refetchInterval: 5000,
  });
  const save = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) =>
      api(path, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await Promise.all(
        ['space-map', 'monitoring-spaces', 'area-summary', 'incident-support'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
      setPlacement(null);
    },
  });
  const chosenRoom = map.data?.rooms.find((room) =>
    room.devices.some((device) => device.id === selected),
  );
  const device = chosenRoom?.devices.find((device) => device.id === selected);
  const mayPlace =
    canEdit && !area?.archived_at && !chosenRoom?.archived_at && !device?.archived_at;
  const active =
    mayPlace &&
    placement &&
    placement.deviceId === device?.id &&
    placement.roomId === chosenRoom?.id
      ? placement
      : null;
  return (
    <section className="panel ag-room-map" aria-label="Sơ đồ khu vực">
      <header className="ag-map-header">
        <div>
          <h2>Sơ đồ khu vực</h2>
          {area ? (
            <p>
              {area.name}
              {area.archived_at ? ' · Đã lưu trữ' : ''}
            </p>
          ) : null}
        </div>
        {areas.length ? (
          <label>
            Khu vực trên sơ đồ
            <select value={area?.id ?? ''} onChange={(event) => onAreaChange(event.target.value)}>
              {areas.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.archived_at ? ' · Đã lưu trữ' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      {!area ? <p className="muted">Thêm khu vực và phòng để bắt đầu.</p> : null}
      {area ? (
        <LoadState pending={map.isPending} error={map.error} retry={() => void map.refetch()} />
      ) : null}
      <LoadState error={save.error} />
      {save.isError && (
        <button
          onClick={() => {
            setPlacement(null);
            save.reset();
            void map.refetch();
          }}
        >
          Tải bố trí mới
        </button>
      )}
      {save.isSuccess ? (
        <p className="notice" role="status">
          {save.variables.path.endsWith('/room') ? 'Đã gỡ thiết bị khỏi phòng.' : 'Đã lưu sơ đồ.'}
        </p>
      ) : null}
      {map.data && area ? (
        <>
          <ul className="ag-map-legend" aria-label="Chú giải trạng thái">
            {Object.entries(mapStatusLabels).map(([tone, label]) => (
              <li key={tone}>
                <span className="ag-map-dot" data-tone={tone} />
                {label}
              </li>
            ))}
          </ul>
          <div className="ag-map-workspace">
            <div className="ag-map-grid">
              {!map.data.rooms.length ? <p className="muted">Khu vực này chưa có phòng.</p> : null}
              {map.data.rooms.map((room) => (
                <RoomTile
                  key={room.id}
                  room={room}
                  editable={canEdit && !area.archived_at && !room.archived_at}
                  unassigned={unassigned}
                  onAssign={onAssign}
                  onDrag={(id, point, version) => {
                    setSelected(id);
                    setPlacement({ roomId: room.id, deviceId: id, version, point });
                    save.reset();
                  }}
                  now={clock}
                  thresholds={map.data.thresholds}
                  selected={selected}
                  placement={active}
                  onSelect={(id) => {
                    setSelected(id);
                    setPlacement(null);
                    save.reset();
                  }}
                  onPoint={(point) =>
                    setPlacement((current) => (current ? { ...current, point } : null))
                  }
                />
              ))}
            </div>
            {device && chosenRoom ? (
              <StatusDetails
                device={device}
                room={chosenRoom}
                now={clock}
                thresholds={map.data.thresholds}
                canEdit={mayPlace}
                placement={active}
                pending={save.isPending}
                onRemove={
                  canEdit
                    ? () => {
                        if (
                          window.confirm(
                            `Gỡ thiết bị “${device.name}” khỏi phòng “${chosenRoom.name}”?`,
                          )
                        )
                          save.mutate(
                            {
                              path: `/spaces/devices/${device.id}/room`,
                              body: { room_id: null, expected_room_id: chosenRoom.id },
                            },
                            {
                              onSuccess: () =>
                                setSelected((current) => (current === device.id ? null : current)),
                            },
                          );
                      }
                    : undefined
                }
                onStart={() => {
                  save.reset();
                  setPlacement({
                    version: chosenRoom.layout_version,
                    deviceId: device.id,
                    roomId: chosenRoom.id,
                    point: null,
                  });
                }}
                onCancel={() => {
                  save.reset();
                  setPlacement(null);
                }}
                onSave={(point) =>
                  save.mutate({
                    path: `/spaces/devices/${device.id}/position`,
                    body: { room_id: chosenRoom.id, layout_version: active?.version, ...point },
                  })
                }
              />
            ) : (
              <aside className="ag-map-detail ag-map-empty-detail">
                <MapPin size={21} />
                <p>Chọn một thiết bị để xem số đo và lý do đổi màu.</p>
              </aside>
            )}
          </div>
          <details className="ag-map-thresholds">
            <summary>Ngưỡng màu trên sơ đồ</summary>
            <p>
              Vàng khi nhiệt độ ≥ {map.data.thresholds.temperature_c} °C hoặc độ ẩm ≥{' '}
              {map.data.thresholds.humidity_pct} %RH. Ngưỡng này chỉ dùng để hiển thị sơ đồ.
            </p>
            {canEdit && !area.archived_at ? (
              <form
                className="ag-map-threshold-form"
                key={`${map.data.thresholds.temperature_c}:${map.data.thresholds.humidity_pct}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = new FormData(event.currentTarget);
                  const parsed = mapThresholdInput.safeParse({
                    temperature_c: Number(values.get('temperature')),
                    humidity_pct: Number(values.get('humidity')),
                  });
                  setThresholdError(!parsed.success);
                  if (parsed.success)
                    save.mutate({
                      path: `/spaces/areas/${area.id}/map-thresholds`,
                      body: parsed.data,
                    });
                }}
              >
                <label>
                  Nhiệt độ (°C)
                  <input
                    name="temperature"
                    type="number"
                    step="any"
                    min="-40"
                    max="125"
                    required
                    defaultValue={map.data.thresholds.temperature_c}
                  />
                </label>
                <label>
                  Độ ẩm (%RH)
                  <input
                    name="humidity"
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    required
                    defaultValue={map.data.thresholds.humidity_pct}
                  />
                </label>
                <button disabled={save.isPending}>Lưu ngưỡng</button>
              </form>
            ) : null}
            {thresholdError ? (
              <p className="notice error" role="alert">
                Kiểm tra lại giá trị ngưỡng.
              </p>
            ) : null}
          </details>
        </>
      ) : null}
    </section>
  );
}
