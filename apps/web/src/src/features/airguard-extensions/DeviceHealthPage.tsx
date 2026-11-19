import { useQueries } from '@tanstack/react-query';
import { HeartPulse, RefreshCw } from 'lucide-react';
import type { DeviceView, StatusView } from '@iot/contracts';
import { api } from '../../lib/api.js';
import { assessHealth, formatTime } from './utils.js';

export default function DeviceHealthPage({ devices }: { devices: DeviceView[] }) {
  const histories = useQueries({
    queries: devices.map((device) => ({
      queryKey: ['extension-status-history', device.id],
      queryFn: () => api<StatusView[]>(`/devices/${device.id}/status-history?limit=100`),
      refetchInterval: 30000,
      retry: false,
    })),
  });
  const health = devices.map((device, index) => assessHealth(device, histories[index]?.data ?? []));
  return (
    <section className="extension-section">
      <div className="extension-heading"><div><h2>Sức khỏe thiết bị</h2><p>Chỉ hiển thị trạng thái và lịch sử có căn cứ từ API; không tự tạo uptime hay điểm sức khỏe.</p></div><HeartPulse /></div>
      {histories.some((query) => query.isError) ? <p className="notice error">Một số lịch sử kết nối chưa tải được. Trạng thái hiện tại vẫn lấy từ danh sách thiết bị. <button onClick={() => histories.forEach((query) => void query.refetch())}><RefreshCw size={15} /> Thử lại</button></p> : null}
      {!devices.length ? <div className="extension-empty"><HeartPulse /><p>Chưa có thiết bị để kiểm tra.</p></div> : <div className="health-grid">{health.map((item, index) => <article className="panel health-card" key={item.device.id}><header><div><span className={`status-dot ${item.device.status === 'online' ? 'online' : 'offline'}`} /><h3>{item.device.name}</h3></div><span className={`badge ${item.device.status === 'online' ? 'success' : ''}`}>{item.device.status === 'online' ? 'Online' : item.device.status === 'never_seen' ? 'Chưa kết nối' : 'Offline'}</span></header><dl><div><dt>Dữ liệu cuối</dt><dd>{formatTime(item.device.last_seen_at)}</dd></div><div><dt>Độ mới</dt><dd>{item.ageMs === null ? 'Chưa xác định' : `${Math.floor(item.ageMs / 1000)} giây trước`}</dd></div><div><dt>Lần chuyển offline ghi nhận</dt><dd>{item.offlineTransitions}{item.history.length === 100 ? '+' : ''} <small>(trong tối đa 100 bản ghi gần nhất)</small></dd></div><div><dt>Kiểm tra dữ liệu</dt><dd>{item.missing ? 'Thiếu dữ liệu mới nhất' : item.stale ? 'Dữ liệu cũ hơn 3 chu kỳ gửi' : 'Có dữ liệu gần đây'}</dd></div></dl>{histories[index]?.isPending ? <small>Đang tải lịch sử kết nối…</small> : null}<p className="health-note">Chu kỳ báo cáo: {item.device.reporting_interval_ms ?? 5000} ms. Cờ “dữ liệu cũ” chỉ là phép kiểm tra độ mới, không phải chứng nhận tình trạng phần cứng.</p></article>)}</div>}
    </section>
  );
}

