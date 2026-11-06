import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { DeviceView } from '@iot/contracts';
import { SensorPanel } from '../components/SensorPanel.js';
const MonitoringChart = lazy(() => import('./MonitoringChart.js'));

export default function MonitoringPage({ devices }: { devices: DeviceView[] }) {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState('');
  const selected = devices.find((d) => d.id === (deviceId ?? selectedId)) ?? devices[0];
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">LIVE MONITORING</span>
          <h1>Giám sát trực tiếp</h1>
          <p>Tín hiệu cảm biến, chất lượng và thời điểm cập nhật.</p>
        </div>
        {selected ? (
          <label className="device-select">
            Thiết bị đang xem
            <select
              value={selected.id}
              onChange={(e) => {
                setSelectedId(e.target.value);
                if (deviceId) navigate(`/app/monitoring/${e.target.value}`);
              }}
            >
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
          <section className="panel chart-panel">
            <div className="section-heading">
              <h2>Nhiệt độ & độ ẩm</h2>
              <span className="badge">120 mẫu gần nhận nhất</span>
            </div>
            <Suspense fallback={<div className="skeleton" />}>
              <MonitoringChart deviceId={selected.id} />
            </Suspense>
          </section>
        </>
      ) : (
        <div className="empty">
          <h3>Chưa có thiết bị</h3>
          <Link to="/app/devices">Thêm thiết bị</Link>
        </div>
      )}
    </>
  );
}
