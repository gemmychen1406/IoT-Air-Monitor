import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { GitCompareArrows } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AnalyticsView, DeviceView } from '@iot/contracts';
import { api } from '../../lib/api.js';
import { METRICS, METRIC_LABEL, type Metric } from './types.js';
import { analyticsHasData, defaultRange, formatTime, rangeParams } from './utils.js';
import { RangeControls } from './RangeControls.js';

const COLORS = ['#17b897', '#6c8cff', '#f59e0b', '#ec4899'];

export default function ComparisonPage({ devices }: { devices: DeviceView[] }) {
  const [selected, setSelected] = useState<string[]>(() => devices.slice(0, 2).map((item) => item.id));
  const [metric, setMetric] = useState<Metric>('temperature_c');
  const [range, setRange] = useState(defaultRange);
  const [submitted, setSubmitted] = useState(() => ({ selected, metric, range }));
  const queries = useQueries({
    queries: submitted.selected.map((id) => ({
      queryKey: ['extension-comparison', id, submitted.metric, submitted.range],
      queryFn: () => api<AnalyticsView>(`/devices/${id}/analytics?${rangeParams(submitted.range, submitted.metric)}`),
      retry: false,
    })),
  });
  const rows = useMemo(() => {
    const buckets = new Map<string, Record<string, string | number | null>>();
    queries.forEach((query, index) => query.data?.series.forEach((point) => {
      const row = buckets.get(point.bucket_start) ?? { bucket_start: point.bucket_start };
      row[submitted.selected[index]!] = point.average;
      buckets.set(point.bucket_start, row);
    }));
    return [...buckets.values()].sort((a, b) => String(a.bucket_start).localeCompare(String(b.bucket_start)));
  }, [queries, submitted]);

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 4 ? [...current, id] : current);
  }

  const selectionError = selected.length < 2 ? 'Chọn ít nhất 2 thiết bị.' : selected.length > 4 ? 'Chỉ được chọn tối đa 4 thiết bị.' : '';
  const queryError = queries.find((query) => query.error)?.error;
  return (
    <section className="extension-section">
      <div className="extension-heading"><div><h2>So sánh nhiều thiết bị</h2><p>So sánh 2–4 thiết bị theo dữ liệu ADC gốc; không quy đổi ppm hoặc AQI.</p></div><GitCompareArrows /></div>
      <div className="panel extension-controls">
        <fieldset><legend>Thiết bị ({selected.length}/4)</legend><div className="extension-checks">{devices.map((device) => <label key={device.id}><input type="checkbox" checked={selected.includes(device.id)} disabled={!selected.includes(device.id) && selected.length === 4} onChange={() => toggle(device.id)} /> {device.name}</label>)}</div></fieldset>
        <label>Chỉ số<select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>{METRICS.map((item) => <option key={item} value={item}>{METRIC_LABEL[item]}</option>)}</select></label>
        <RangeControls value={range} onChange={setRange} />
        <button className="primary" disabled={!!selectionError} onClick={() => setSubmitted({ selected: [...selected], metric, range: { ...range } })}>So sánh</button>
      </div>
      {selectionError ? <p className="notice error">{selectionError}</p> : null}
      {queries.some((query) => query.isPending) ? <div className="skeleton" role="status" aria-label="Đang tải dữ liệu so sánh" /> : null}
      {queryError ? <p className="notice error" role="alert">Không tải được dữ liệu: {queryError.message}</p> : null}
      {!queryError && !queries.some((query) => query.isPending) ? (
        <>
          <div className="comparison-status">{submitted.selected.map((id, index) => { const device = devices.find((item) => item.id === id); const data = queries[index]?.data; if (!device) return null; return <div className="panel" key={id}><span className={`status-dot ${device.status === 'online' ? 'online' : 'offline'}`} /><b>{device.name}</b><small>{device.status === 'online' ? 'Online' : device.status === 'never_seen' ? 'Chưa từng kết nối' : 'Offline'} · {analyticsHasData(data) ? `${data!.summary.valid_count} mẫu hợp lệ` : 'Không có dữ liệu trong khoảng chọn'} · Gần nhất: {formatTime(device.last_seen_at)}</small></div>; })}</div>
          {rows.length ? <div className="panel extension-chart"><ResponsiveContainer width="100%" height={420}><LineChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="bucket_start" tickFormatter={(value) => new Date(String(value)).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit' })} /><YAxis /><Tooltip labelFormatter={(value) => formatTime(String(value))} /><Legend />{submitted.selected.map((id, index) => <Line key={id} dataKey={id} name={devices.find((item) => item.id === id)?.name ?? id} stroke={COLORS[index]} dot={false} connectNulls={false} />)}</LineChart></ResponsiveContainer></div> : <div className="extension-empty"><GitCompareArrows /><p>Không có điểm dữ liệu để vẽ trong khoảng đã chọn.</p></div>}
        </>
      ) : null}
    </section>
  );
}

