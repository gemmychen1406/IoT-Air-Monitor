import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPinned, RotateCcw } from 'lucide-react';
import type { DeviceView } from '@iot/contracts';
import { api } from '../../lib/api.js';
import { formatTime } from './utils.js';

type Position = { x: number; y: number };
type AlertState = { device_id: string; condition: string; state: string; unresolved: boolean };
const STORAGE_KEY = 'airguard.sensor-map.v1';

function readPositions(): Record<string, Position> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Position>; } catch { return {}; }
}

export default function SensorMapPage({ devices }: { devices: DeviceView[] }) {
  const [positions, setPositions] = useState<Record<string, Position>>(readPositions);
  const [selectedId, setSelectedId] = useState(devices[0]?.id ?? '');
  const alerts = useQuery({ queryKey: ['extension-map-alerts'], queryFn: () => api<AlertState[]>('/alerts/states'), refetchInterval: 10000 });
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)), [positions]);
  const arranged = useMemo(() => devices.map((device, index) => ({ device, position: positions[device.id] ?? { x: 15 + (index % 4) * 22, y: 20 + Math.floor(index / 4) * 28 } })), [devices, positions]);
  const selected = devices.find((device) => device.id === selectedId);
  const selectedPosition = selected ? (positions[selected.id] ?? arranged.find((item) => item.device.id === selected.id)?.position) : undefined;
  function update(axis: keyof Position, value: number) { if (!selected || !selectedPosition) return; setPositions((current) => ({ ...current, [selected.id]: { ...selectedPosition, [axis]: Math.max(3, Math.min(97, value)) } })); }
  return (
    <section className="extension-section">
      <div className="extension-heading"><div><h2>Sơ đồ vị trí cảm biến</h2><p>Vị trí được lưu riêng trong trình duyệt này, không thay đổi database.</p></div><MapPinned /></div>
      <div className="map-layout">
        <div className="panel sensor-map" aria-label="Sơ đồ khu vực"><span className="room-label">KHU VỰC GIÁM SÁT</span><div className="room room-a">Phòng A</div><div className="room room-b">Phòng B</div>{arranged.map(({ device, position }) => { const danger = alerts.data?.some((alert) => alert.device_id === device.id && alert.unresolved); return <button key={device.id} className={`map-device ${danger ? 'danger' : device.status}`} style={{ left: `${position.x}%`, top: `${position.y}%` }} onClick={() => setSelectedId(device.id)} aria-label={`${device.name}, ${danger ? 'có cảnh báo' : device.status}`}><span /><b>{device.name}</b></button>; })}</div>
        <aside className="panel map-editor"><h3>Thông tin & vị trí</h3>{selected && selectedPosition ? <><label>Thiết bị<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><p><b>Trạng thái:</b> {selected.status}</p><p><b>Vị trí mô tả:</b> {selected.location || 'Chưa cấu hình'}</p><p><b>Dữ liệu cuối:</b> {formatTime(selected.last_seen_at)}</p><label>Ngang ({Math.round(selectedPosition.x)}%)<input type="range" min="3" max="97" value={selectedPosition.x} onChange={(event) => update('x', Number(event.target.value))} /></label><label>Dọc ({Math.round(selectedPosition.y)}%)<input type="range" min="3" max="97" value={selectedPosition.y} onChange={(event) => update('y', Number(event.target.value))} /></label><button onClick={() => setPositions((current) => { const next = { ...current }; delete next[selected.id]; return next; })}><RotateCcw size={16} /> Đặt lại vị trí</button></> : <p>Chưa có thiết bị.</p>}{alerts.isError ? <p className="notice error">Không tải được cảnh báo. <button onClick={() => void alerts.refetch()}>Thử lại</button></p> : null}</aside>
      </div>
    </section>
  );
}

