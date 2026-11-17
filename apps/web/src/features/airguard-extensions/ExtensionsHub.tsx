import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HeartPulse, MapPinned, ShieldAlert } from 'lucide-react';
import type { DeviceView } from '@iot/contracts';
import { api } from '../../lib/api.js';
import DeviceHealthPage from './DeviceHealthPage.js';
import SensorMapPage from './SensorMapPage.js';
import SafetyGuidePage from './SafetyGuidePage.js';
import './styles.css';

const tabs = [
  ['health', 'Sức khỏe', HeartPulse],
  ['map', 'Sơ đồ', MapPinned],
  ['safety', 'Ứng phó', ShieldAlert],
] as const;
type Tab = (typeof tabs)[number][0];

export default function ExtensionsHub() {
  const [tab, setTab] = useState<Tab>('health');
  const devices = useQuery({ queryKey: ['devices', 'extensions'], queryFn: () => api<DeviceView[]>('/devices'), refetchInterval: 10000 });
  return (
    <div className="extensions-hub">
      <div className="page-title"><div><h1>Tiện ích AirGuard</h1><p>Phân tích sức khỏe thiết bị, sơ đồ và hướng dẫn ứng phó.</p></div></div>
      <nav className="extension-tabs" aria-label="Các tiện ích mở rộng">{tabs.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={17} /> {label}</button>)}</nav>
      {devices.isPending ? <div className="skeleton" role="status" aria-label="Đang tải thiết bị" /> : null}
      {devices.isError ? <p className="notice error" role="alert">Không tải được thiết bị: {devices.error.message}. <button onClick={() => void devices.refetch()}>Thử lại</button></p> : null}
      {!devices.isPending && !devices.isError ? <>{tab === 'health' ? <DeviceHealthPage devices={devices.data ?? []} /> : null}{tab === 'map' ? <SensorMapPage devices={devices.data ?? []} /> : null}{tab === 'safety' ? <SafetyGuidePage /> : null}</> : null}
    </div>
  );
}

