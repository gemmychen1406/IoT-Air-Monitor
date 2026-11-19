import { useState } from 'react';
import { BarChart3, FileDown, Printer } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AnalyticsView, DeviceView, IncidentView } from '@iot/contracts';
import { api } from '../../lib/api.js';
import { METRICS, METRIC_LABEL, type ReportData } from './types.js';
import { defaultRange, formatNumber, formatTime, rangeParams } from './utils.js';
import { RangeControls } from './RangeControls.js';

export default function ReportPage({ devices }: { devices: DeviceView[] }) {
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? '');
  const [range, setRange] = useState(defaultRange);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    const device = devices.find((item) => item.id === deviceId);
    if (!device) return setError('Vui lòng chọn thiết bị.');
    setLoading(true);
    setError('');
    try {
      const base = rangeParams(range);
      const [analyticsRows, incidents] = await Promise.all([
        Promise.all(METRICS.map((metric) => api<AnalyticsView>(`/devices/${device.id}/analytics?${rangeParams(range, metric)}`))),
        api<IncidentView[]>(`/alerts/incidents?device_id=${device.id}&from=${encodeURIComponent(base.get('from')!)}&to=${encodeURIComponent(base.get('to')!)}&limit=100`),
      ]);
      setReport({
        generatedAt: new Date().toISOString(),
        device,
        range,
        analytics: Object.fromEntries(METRICS.map((metric, index) => [metric, analyticsRows[index]])),
        incidents,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tạo được báo cáo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="extension-section">
      <div className="extension-heading">
        <div><h2>Xuất báo cáo PDF</h2><p>Dùng dữ liệu Analytics và lịch sử sự cố thật; trình duyệt sẽ lưu bản in thành PDF.</p></div>
        <FileDown aria-hidden="true" />
      </div>
      <div className="panel extension-controls no-print">
        <label>Thiết bị<select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Chọn thiết bị</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
        <RangeControls value={range} onChange={setRange} />
        <button className="primary" disabled={loading || !deviceId} onClick={() => void generate()}>{loading ? 'Đang tổng hợp…' : 'Tạo báo cáo'}</button>
      </div>
      {error ? <p className="notice error" role="alert">{error} <button onClick={() => void generate()}>Thử lại</button></p> : null}
      {!report && !loading ? <div className="extension-empty"><BarChart3 /><p>Chọn thiết bị và khoảng thời gian để tạo báo cáo. Không có dữ liệu giả được sử dụng.</p></div> : null}
      {report ? (
        <article className="report-sheet" aria-label="Báo cáo chất lượng không khí">
          <header><div><span>AIRGUARD</span><h1>BÁO CÁO GIÁM SÁT MÔI TRƯỜNG</h1></div><button className="primary no-print" onClick={() => window.print()}><Printer size={17} /> In / Lưu PDF</button></header>
          <div className="report-meta"><p><b>Thiết bị:</b> {report.device.name}</p><p><b>Vị trí:</b> {report.device.location || 'Chưa cấu hình'}</p><p><b>Khoảng:</b> {formatTime(new Date(report.range.from).toISOString())} – {formatTime(new Date(report.range.to).toISOString())}</p><p><b>Tạo lúc:</b> {formatTime(report.generatedAt)}</p></div>
          <div className="report-stats">{METRICS.map((metric) => { const data = report.analytics[metric]; return <div key={metric}><span>{METRIC_LABEL[metric]}</span><strong>{formatNumber(data?.summary.average ?? null, data?.unit)}</strong><small>Min {formatNumber(data?.summary.min ?? null)} · Max {formatNumber(data?.summary.max ?? null)} · {data?.summary.valid_count ?? 0} mẫu hợp lệ</small></div>; })}</div>
          <h3>Biểu đồ dữ liệu</h3>
          <div className="report-charts">{METRICS.map((metric) => { const data = report.analytics[metric]; return <section key={metric}><h4>{METRIC_LABEL[metric]} ({data?.unit})</h4>{data?.series.some((point) => point.average !== null) ? <ResponsiveContainer width="100%" height={190}><LineChart data={data.series}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="bucket_start" tickFormatter={(value) => new Date(String(value)).toLocaleDateString('vi-VN')} /><YAxis /><Tooltip labelFormatter={(value) => formatTime(String(value))} /><Line type="monotone" dataKey="average" connectNulls={false} dot={false} stroke="#17b897" /></LineChart></ResponsiveContainer> : <p>Không có dữ liệu hợp lệ trong khoảng đã chọn.</p>}</section>; })}</div>
          <h3>Lịch sử sự cố ({report.incidents.length}{report.incidents.length === 100 ? '+' : ''})</h3>
          {report.incidents.length ? <table><thead><tr><th>Loại</th><th>Mức độ</th><th>Bắt đầu</th><th>Trạng thái</th></tr></thead><tbody>{report.incidents.map((item) => <tr key={item.id}><td>{item.condition.toUpperCase()}</td><td>{item.severity === 'critical' ? 'Nghiêm trọng' : 'Cảnh báo'}</td><td>{formatTime(item.started_at ?? item.first_observed_at)}</td><td>{item.status === 'active' ? 'Đang diễn ra' : 'Đã kết thúc'}</td></tr>)}</tbody></table> : <p>Không ghi nhận sự cố trong khoảng thời gian này.</p>}
          <footer>Báo cáo hỗ trợ giám sát và nghiên cứu; không thay thế thiết bị cảnh báo an toàn chuyên dụng.</footer>
        </article>
      ) : null}
    </section>
  );
}

