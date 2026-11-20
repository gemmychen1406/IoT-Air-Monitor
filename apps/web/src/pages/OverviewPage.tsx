import { Cpu, Radio, Server, Bell, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import type { DeviceView } from '@iot/contracts';
import { SensorPanel } from '../components/SensorPanel.js';
import { dateText } from '../components/FeatureUI.js';
import { SensorMeaningGuide } from '../components/SensorMeaningGuide.js';

export default function OverviewPage({
  devices,
  selectedId,
  onSelect,
  activeIncidents,
}: {
  devices: DeviceView[];
  selectedId: string;
  onSelect: (id: string) => void;
  activeIncidents: number | null;
}) {
  const selected = devices.find((d) => d.id === selectedId) ?? devices[0];
  const online = devices.filter((d) => d.status === 'online').length;
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Tổng quan hệ thống</h1>
          <p>Tình trạng thiết bị và chất lượng không khí.</p>
        </div>
      </div>
      <div className="stats-grid">
        {[
          {
            title: 'Thiết bị',
            value: devices.length,
            icon: Cpu,
          },
          {
            title: 'Đang online',
            value: online,
            icon: Radio,
          },
          {
            title: 'Mất kết nối',
            value: devices.length - online,
            icon: Server,
          },
          {
            title: 'Sự cố đang mở',
            value: activeIncidents,
            icon: Bell,
          },
        ].map(({ title, value, icon: Icon }) => (
          <article className="panel stat-card" key={title}>
            <span>
              {title}
              <Icon size={18} />
            </span>
            <strong>{value ?? '—'}</strong>
          </article>
        ))}
      </div>
      <div className="section-heading">
        <div>
          <h2>Cảm biến</h2>
          <p className="muted">
            {selected
              ? `${selected.name} · cập nhật ${dateText(selected.last_seen_at)}`
              : 'Chọn một thiết bị để xem'}
          </p>
        </div>
        {selected ? (
          <label className="device-select">
            Thiết bị
            <select value={selected.id} onChange={(e) => onSelect(e.target.value)}>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.source_kind === 'simulator' ? ' · Mô phỏng' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {selected ? (
        <>
          <SensorPanel device={selected} />
          <SensorMeaningGuide device={selected} />
        </>
      ) : (
        <div className="panel empty">
          <Cpu size={34} />
          <h3>Chưa có thiết bị</h3>
          <p>Thêm thiết bị để bắt đầu nhận dữ liệu.</p>
          <Link className="primary" to="/app/devices">
            Thêm thiết bị
            <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
    </>
  );
}
