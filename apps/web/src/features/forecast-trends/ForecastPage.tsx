// [FORECAST - FILE MOI] Giao dien rieng cua module Phan tich xu huong & Du bao.
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, TrendingUp, House, Info, Radio, TriangleAlert, ChevronRight, Waves, History } from 'lucide-react';
import { Link } from 'react-router';
import type { DeviceView, SpacesView } from '@iot/contracts';
import { api } from '../../lib/api.js';
import { latestDhtSnapshot } from './latestDht.js';
import { formatSensorValue } from '../../lib/sensor-display.js';
import { FORECAST_CONFIG as CFG } from './config.js';
import { fetchForecastHistory, type HistoryResponse } from './history.js';
import { evaluateDhtChange } from './dhtAdvisory.js';
import { analyzeTrend } from './timeseries.js';
import { forecastBoth } from './forecasting.js';
import { evaluateAdvisory } from './advisory.js';
import { analyzeAllRoomPairs, lagCorrelationProfile } from './interRoom.js';
import { MoistureIndicators } from './MicroclimateScenarioPanel.js';
import { RoomImpactTimeline } from './RoomImpactTimeline.js';
import { LagCorrelationChart, PredictionChart, RoomComparisonChart } from './ForecastCharts.js';
import MonitoringChart from '../../pages/MonitoringChart.js';
import type { ForecastModel, Measure, MinuteReading, TrendResult } from './types.js';
import { stationDisplayName } from './stationDisplay.js';
import './forecast-trends.css';

const TABS = [
  { id: 'trend', label: 'Giám sát biến động', icon: Waves },
  { id: 'forecast', label: 'Dự báo 15–30 phút', icon: TrendingUp },
  { id: 'rooms', label: 'So sánh các trạm', icon: House },
] as const;
type Tab = (typeof TABS)[number]['id'];
const trendNames = {
  increasing: 'Đang tăng', decreasing: 'Đang giảm', stable: 'Ổn định',
  insufficient: 'Chưa đủ dữ liệu', stale: 'Dữ liệu cũ',
};
const models: { id: ForecastModel; label: string }[] = [
  { id: 'naive', label: 'Naive' }, { id: 'linear', label: 'Hồi quy tuyến tính' }, { id: 'holt', label: 'Holt' },
];
const fmt = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const fmtTime = (time: number | null | undefined) => time === null || time === undefined ? 'Chưa có' : new Date(time).toLocaleString('vi-VN');
const emptyPoints: MinuteReading[] = [];

function CurrentCard({ title, metric, unit, trend, latestValue, freshness, historical }: {
  title: string; metric: 'temperature_c' | 'humidity_pct'; unit: string;
  trend: TrendResult; latestValue: number | null; freshness: string; historical: boolean;
}) {
  return <article className="ft-metric">
    <div className="ft-metric-heading"><span>{title}</span><span className={`ft-trend ft-${trend.status}`}>{trendNames[trend.status]}</span></div>
    <div className="ft-big-number">{formatSensorValue(metric, latestValue)} <small>{unit}</small></div>
    <p className="ft-live-label">Mẫu cuối của thiết bị · {freshness}</p>
    <div className="ft-metric-bottom">
      <span>{trend.slopePerMinute === null ? 'Chưa đủ mẫu để tính xu hướng' : `${historical ? 'Xu hướng trước khi mất kết nối' : 'Tốc độ biến động'}: ${trend.slopePerMinute >= 0 ? '+' : ''}${fmt(trend.slopePerMinute, 3)} ${unit}/phút`}</span>
      <span>Trung bình cửa sổ 30 phút: {fmt(trend.average)} {unit}</span>
    </div>
  </article>;
}

export default function ForecastPage({ devices }: { devices: DeviceView[] }) {
  const [tab, setTab] = useState<Tab>('trend');
  const [selectedId, setSelectedId] = useState('');
  const [roomSelection, setRoomSelection] = useState<string[] | null>(null);
  const [model, setModel] = useState<ForecastModel>('holt');
  const [horizon, setHorizon] = useState<15 | 30>(15);
  const [roomMetric, setRoomMetric] = useState<Measure>('temperature');
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const activeDevices = devices.filter((device) => !device.archived_at);
  const maxComparison = Math.min(9, activeDevices.length);
  const spacesQuery = useQuery({ queryKey: ['monitoring-spaces'], queryFn: () => api<SpacesView>('/spaces'), staleTime: 60_000 });
  const deviceRoomLabel = (device: DeviceView) => {
    const assigned = spacesQuery.data?.devices.find((item) => item.id === device.id);
    const room = assigned?.room_id ? spacesQuery.data?.rooms.find((item) => item.id === assigned.room_id) : null;
    return stationDisplayName(device.name, room?.name ?? device.location ?? null);
  };
  const selected = activeDevices.find((device) => device.id === selectedId) ?? activeDevices[0];
  const roomIds = roomSelection === null
    ? activeDevices.slice(0, Math.min(4, maxComparison)).map((device) => device.id)
    : roomSelection.filter((id) => activeDevices.some((device) => device.id === id));
  const queryIds = tab === 'rooms'
    ? [...new Set([...roomIds, ...(selected ? [selected.id] : [])])]
    : selected ? [selected.id] : [];
  const fromMs = Math.floor(nowMs / CFG.minuteMs) * CFG.minuteMs - CFG.historyMinutes * CFG.minuteMs;
  const toMs = Math.ceil(nowMs / CFG.minuteMs) * CFG.minuteMs;
  const historyQueries = useQueries({
    queries: queryIds.map((deviceId) => ({
      queryKey: ['forecast-history', deviceId],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchForecastHistory(deviceId, fromMs, toMs, signal),
      staleTime: 30_000,
      refetchInterval: 45_000,
    })),
  });
  const queryFor = (id: string) => historyQueries[queryIds.indexOf(id)];
  const dataFor = (id: string): HistoryResponse | null => queryFor(id)?.data ?? null;
  const selectedQuery = selected ? queryFor(selected.id) : null;
  const selectedData = selected ? dataFor(selected.id) : null;
  const selectedHistory = selectedData?.history;
  const points = selectedHistory?.points ?? emptyPoints;
  const live = selected ? latestDhtSnapshot(selected, nowMs) : null;
  const latestSampleAt = selectedHistory?.latestSampleAt;
  const dataStale = latestSampleAt !== null && latestSampleAt !== undefined && nowMs - latestSampleAt > CFG.staleAfterMs;
  const temperatureTrend = useMemo(() => analyzeTrend(points, 'temperature', nowMs, latestSampleAt), [points, nowMs, latestSampleAt]);
  const humidityTrend = useMemo(() => analyzeTrend(points, 'humidity', nowMs, latestSampleAt), [points, nowMs, latestSampleAt]);
  const forecast = useMemo(() => forecastBoth(points, model, horizon, nowMs, latestSampleAt), [points, model, horizon, nowMs, latestSampleAt]);
  const advisory = useMemo(() => evaluateAdvisory(points, temperatureTrend, humidityTrend, forecast), [points, temperatureTrend, humidityTrend, forecast]);
  const dhtNotices = useMemo(() => evaluateDhtChange(points, nowMs), [points, nowMs]);
  const roomHistories = tab === 'rooms' ? roomIds.flatMap((id) => {
    const response = dataFor(id);
    return response ? [{ id, name: activeDevices.find((d) => d.id === id) ? deviceRoomLabel(activeDevices.find((d) => d.id === id)!) : 'Thiết bị', points: response.history.points }] : [];
  }) : [];
  const roomLag = tab === 'rooms' ? analyzeAllRoomPairs(roomHistories) : [];
  const candidates = roomLag.filter((item) => item.status === 'candidate').sort((a, b) => (b.correlation ?? 0) - (a.correlation ?? 0));
  const matchingCandidates = candidates.filter((item) => item.metric === roomMetric);
  const nameFor = (id: string) => {
    const device = activeDevices.find((d) => d.id === id);
    return device ? deviceRoomLabel(device) : 'Thiết bị không khả dụng';
  };
  const bestPair = matchingCandidates[0] ?? roomLag
    .filter((item) => item.metric === roomMetric)
    .sort((a, b) => b.samplePairs - a.samplePairs)[0];
  const sourceHistory = bestPair ? roomHistories.find((p) => p.id === bestPair.sourceId) : null;
  const targetHistory = bestPair ? roomHistories.find((p) => p.id === bestPair.targetId) : null;
  const profile = bestPair && sourceHistory && targetHistory
    ? lagCorrelationProfile(sourceHistory.points, targetHistory.points, bestPair.metric) : [];
  return <div className="ft-page">
    <div className="page-title ft-title">
      <div><h1>Giám sát & Dự báo</h1><p>Theo dõi nhiệt độ, độ ẩm, dự báo ngắn hạn và so sánh các trạm từ dữ liệu hệ thống.</p></div>
      {selected ? <label className="ft-device-select">Thiết bị / khu vực
        <select value={selected.id} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedId(event.target.value)}>
          {activeDevices.map((device) => <option value={device.id} key={device.id}>{deviceRoomLabel(device)}{device.source_kind === 'simulator' ? ' (mô phỏng)' : ''}</option>)}
        </select>
      </label> : null}
    </div>

    <div className="ft-mode-bar" aria-label="Nguồn dữ liệu phân tích">
      <div className="ft-mode-heading"><strong>Dữ liệu hệ thống ({activeDevices.length} thiết bị)</strong><span>Dùng chung API và danh sách trạm với Giám sát trực tiếp.</span></div>
    </div>

    {!selected ? <div className="panel ft-state">Chưa có thiết bị trong hệ thống. <Link to="/app/devices">Mở mục Thiết bị</Link>.</div> : <>
      <nav className="ft-tabs" aria-label="Chức năng phân tích và dự báo">
        {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}
      </nav>
      {selected.source_kind === 'simulator' ? <div className="ft-note-inline"><Info size={15} /> Thiết bị đang chọn là Simulator của nhóm; số liệu được gửi qua API chung.</div> : null}
      {selectedQuery?.isPending ? <div role="status" className="panel ft-state">Đang tải lịch sử của thiết bị…</div> : null}
      {selectedQuery?.isError ? <div role="alert" className="notice error ft-state">Không tải được lịch sử: {selectedQuery.error.message} <button onClick={() => void selectedQuery.refetch()}>Thử lại</button></div> : null}
      {selectedData ? <>
        {selectedData.partial ? <div className="ft-info"><Info size={16} /> Lịch sử mới tải được {selectedData.fetched} mẫu. Một phần phân tích có thể chưa đầy đủ.</div> : null}
        {selectedData.historicalFallback ? <div className="ft-info"><History size={16}/> Không có mẫu trong 3 giờ gần nhất; đang xem những bản ghi cuối đã lưu trong hệ thống để phân tích hồi cứu. Đây không phải dữ liệu trực tiếp.</div> : null}
        {selectedData.history.validSamples === 0 ? <div className="panel ft-state">Chưa có mẫu DHT11 hợp lệ, đồng bộ thời gian trong lịch sử vừa tải.</div> : null}
        <div className="ft-meta"><Radio size={15} /> Mẫu DHT11 hợp lệ cuối: {fmtTime(latestSampleAt)}{dataStale ? <span className="ft-stale"> · Thiết bị đã ngừng gửi dữ liệu mới – không dự báo thời gian thực</span> : null}</div>
        {tab === 'trend' ? <>
          <div className="ft-two-cards">
            <CurrentCard title="Nhiệt độ" metric="temperature_c" unit="°C" trend={temperatureTrend} latestValue={live?.temperature ?? null} freshness={live?.freshness ?? 'Chưa có mẫu'} historical={dataStale} />
            <CurrentCard title="Độ ẩm" metric="humidity_pct" unit="%RH" trend={humidityTrend} latestValue={live?.humidity ?? null} freshness={live?.freshness ?? 'Chưa có mẫu'} historical={dataStale} />
          </div>
          <MoistureIndicators temperature={live?.temperature ?? null} humidity={live?.humidity ?? null} />
          <section className="panel ft-dht-notices"><div className="ft-section-bar"><h2><Activity size={19}/> Nhận định biến động nhiệt độ và độ ẩm</h2></div>
            {dhtNotices.length ? <div className="ft-notice-list">{dhtNotices.map((notice, index) => <div key={`${notice.title}:${index}`} className={`ft-notice ft-notice-${notice.level}`}><strong>{notice.title.replace(' nhanh', ' liên tục')}</strong><p>{notice.detail}</p></div>)}</div> : <p className="ft-muted">Chưa ghi nhận biến động liên tục vượt mức theo dõi, hoặc chưa đủ mẫu để đánh giá.</p>}
            <p className="ft-muted">Nhận định được tính từ lịch sử nhiệt độ và độ ẩm; không xác nhận nguyên nhân biến động.</p>
          </section>
          <section className="panel ft-chart-panel ft-wide-panel">
            <div className="ft-section-bar"><div><h2>Nhiệt độ & độ ẩm</h2><p className="ft-muted">120 mẫu gần nhất · biểu đồ dùng chung với Giám sát trực tiếp</p></div>
            </div>
            <MonitoringChart deviceId={selected.id} />
          </section>
          {dataStale ? <p className="ft-muted">Biểu đồ và tốc độ biến đổi ở trên phản ánh dữ liệu lịch sử trước khi thiết bị ngừng gửi, không phải trạng thái hiện tại.</p> : null}
        </> : null}
        {tab === 'forecast' ? <>
          <section className="panel ft-controls"><label>Mô hình dự báo
            <select value={model} onChange={(e: ChangeEvent<HTMLSelectElement>) => setModel(e.target.value as ForecastModel)}>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          </label><label>Khoảng dự báo
            <select value={horizon} onChange={(e: ChangeEvent<HTMLSelectElement>) => setHorizon(Number(e.target.value) as 15 | 30)}><option value={15}>15 phút</option><option value={30}>30 phút</option></select>
          </label><div className="ft-controls-caption">Dự báo tính từ mẫu đo mới nhất khi thiết bị đang cập nhật. Mốc 15/30 phút được tính sau mẫu đó, không phải kết quả đã đo.</div></section>
          {forecast.temperature.status !== 'eligible' && forecast.humidity.status !== 'eligible'
            ? <div className="ft-info"><Info size={16}/> {forecast.temperature.reason ?? 'Chưa đủ dữ liệu mới để dự báo tương lai.'} Không sử dụng dự báo hồi cứu thay thế.</div> : null}
          <div className="ft-two-cards">
            {(['temperature', 'humidity'] as const).map((metric) => {
              const forecastItem = forecast[metric];
              const last = forecastItem.points.at(-1);
              const unit = metric === 'temperature' ? '°C' : '%RH';
              return <article key={metric} className="ft-metric"><div className="ft-metric-heading"><span>{metric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm'} dự kiến</span><span className="ft-forecast-tag">Sau {horizon} phút</span></div>
                <div className="ft-big-number">{fmt(last?.value)} <small>{unit}</small></div>
                {forecastItem.status === 'eligible' && last
                  ? <div className="ft-metric-bottom"><span>Thay đổi dự kiến: {forecastItem.current !== null ? `${last.value - forecastItem.current >= 0 ? '+' : ''}${fmt(last.value - forecastItem.current)} ${unit}` : '—'}</span><span>Mốc đo đầu: {fmtTime(forecastItem.lastSampleAt)}</span></div>
                  : <p className="ft-warning">{forecastItem.reason ?? 'Chưa đủ dữ liệu.'}</p>}
              </article>;
            })}
          </div>
          <section className="panel ft-chart-panel ft-wide-panel"><div className="ft-section-bar"><h2>Dự báo nhiệt độ</h2><span className="ft-muted">Từ mẫu mới nhất tới +{horizon} phút. Các điểm tương lai chưa có số đo thực tế.</span></div>
            <PredictionChart points={points} metric="temperature" result={forecast} /></section>
          <section className="panel ft-chart-panel ft-wide-panel"><div className="ft-section-bar"><h2>Dự báo độ ẩm</h2><span className="ft-muted">Từ mẫu mới nhất tới +{horizon} phút. Các điểm tương lai chưa có số đo thực tế.</span></div>
            <PredictionChart points={points} metric="humidity" result={forecast} /></section>
          <section className={`panel ft-advisory ft-advisory-${advisory.level}`}><h3><TriangleAlert size={18} /> {advisory.title}</h3>
            {advisory.details.length ? <ul>{advisory.details.map((detail) => <li key={detail}>{detail.replace('biến đổi nhanh', 'biến đổi liên tục')}</li>)}</ul> : <p>Chưa phát hiện biến động đáng chú ý từ dữ liệu hiện có.</p>}
            <p className="ft-muted">Đây là ước tính thống kê, không phải số đo tương lai hay cảnh báo nguy hiểm đã xác nhận.</p>
          </section>
        </> : null}
      </> : null}
      {tab === 'rooms' ? <>
        <section className="panel ft-room-filter"><div className="ft-section-bar"><h2>Các trạm cần so sánh</h2><div className="ft-room-actions"><span className="ft-muted">Đang chọn {roomIds.length}/{maxComparison} trạm (tối thiểu 2)</span><button type="button" onClick={() => setRoomSelection(activeDevices.slice(0, maxComparison).map((device) => device.id))}>Chọn tất cả {maxComparison} trạm</button></div></div>
          <div className="ft-room-options">{activeDevices.map((device) => {
            const chosen = roomIds.includes(device.id);
            return <label key={device.id} className="ft-check"><input type="checkbox" checked={chosen} disabled={(!chosen && roomIds.length >= maxComparison) || (chosen && roomIds.length <= 2)} onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const checked = event.target.checked;
              setRoomSelection((old) => { const base = old ?? activeDevices.slice(0, 4).map((item) => item.id); return checked ? [...base, device.id].slice(0, maxComparison) : base.filter((id) => id !== device.id); });
            }}/>{deviceRoomLabel(device)}</label>;
          })}</div>
        </section>
        <div className="ft-room-grid">{roomIds.map((id) => {
          const device = activeDevices.find((item) => item.id === id);
          if (!device) return null;
          const last = latestDhtSnapshot(device, nowMs);
          const data = dataFor(id);
          const values = data?.history.points ?? emptyPoints;
          const trendT = analyzeTrend(values, 'temperature', nowMs, data?.history.latestSampleAt);
          const trendH = analyzeTrend(values, 'humidity', nowMs, data?.history.latestSampleAt);
          const forecastRoom = forecastBoth(values, model, horizon, nowMs, data?.history.latestSampleAt);
          const note = evaluateAdvisory(values, trendT, trendH, forecastRoom);
          return <button key={id} type="button" className={`ft-room-card ft-room-${note.level} ${selected?.id === id ? 'selected' : ''}`} onClick={() => { setSelectedId(id); setTab('trend'); }}>
            <span className="ft-room-top"><strong>{deviceRoomLabel(device)}</strong><ChevronRight size={18}/></span>
            <span className="ft-room-values">{formatSensorValue('temperature_c', last.temperature)}<small>°C</small><span> / </span>{formatSensorValue('humidity_pct', last.humidity)}<small>%RH</small></span>
            <span className="ft-room-status">{note.title}</span>
            <span className="ft-muted">Nhiệt: {trendNames[trendT.status]} · Độ ẩm: {trendNames[trendH.status]}</span>
            {!data ? <span className="ft-warning">{queryFor(id)?.isPending ? 'Đang tải lịch sử…' : 'Chưa tải được lịch sử'}</span> : null}
            <span className="ft-muted">{last.freshness}</span>
          </button>;
        })}</div>
        {roomIds.length < 2 ? <section className="panel ft-empty-multi"><House size={30}/><h2>Chưa đủ trạm để so sánh</h2><p>Hệ thống mới có {activeDevices.length} thiết bị. Cần ít nhất hai trạm có số đo tại các mốc thời gian tương ứng.</p>
          <div className="ft-empty-actions"><Link to="/app/devices">Quản lý thiết bị <ArrowRight size={15}/></Link></div>
        </section> : <>
          <section className="panel ft-wide-panel ft-chart-panel"><div className="ft-section-bar"><div><h2>So sánh diễn biến giữa các trạm</h2><p className="ft-muted">So sánh trạm theo cùng mốc thời gian. Đường ngắt khi thiếu mẫu hợp lệ; hệ thống không tự tạo dữ liệu để nối khoảng trống.</p></div>
            <div className="ft-switch-metric"><button className={roomMetric === 'temperature' ? 'active' : ''} onClick={() => setRoomMetric('temperature')}>Nhiệt độ</button><button className={roomMetric === 'humidity' ? 'active' : ''} onClick={() => setRoomMetric('humidity')}>Độ ẩm</button></div>
          </div><RoomComparisonChart rooms={roomHistories} metric={roomMetric}/></section>
          <RoomImpactTimeline rooms={roomHistories} metric={roomMetric} demo={false}/>
          <section className="panel ft-links"><div className="ft-section-bar"><h2>Quan hệ biến động có độ trễ</h2><Activity size={19}/></div>
            <p>Hệ thống đối chiếu biến động theo phút theo mọi hướng, từ 1 đến {CFG.lagMaxMinutes} phút. Có tương quan không đồng nghĩa là đã chứng minh nhiệt hoặc hơi ẩm lan truyền.</p>
            {historyQueries.some((query) => query.isPending) ? <p>Đang tải lịch sử các phòng…</p> : null}
            {matchingCandidates.length ? <div className="ft-link-list">{matchingCandidates.slice(0, 8).map((entry) => <article key={`${entry.sourceId}:${entry.targetId}:${entry.metric}`} className="ft-link-item">
              <strong>{nameFor(entry.sourceId)} <ArrowRight size={16}/> {nameFor(entry.targetId)}</strong>
              <span>Độ trễ khoảng {entry.lagMinutes} phút · tương quan {entry.correlation?.toFixed(2)} · {entry.samplePairs} cặp dữ liệu</span><small>Nghi vấn liên hệ thống kê, chưa xác nhận lan truyền</small>
            </article>)}</div> : <p className="ft-muted">{roomLag.length && roomLag.every((item) => item.status === 'insufficient') ? 'Chưa đủ dữ liệu đồng bộ để phát hiện độ trễ.' : 'Chưa phát hiện mối liên hệ trễ đủ rõ trên dữ liệu hiện tại.'}</p>}
            {bestPair ? <div className="ft-lag-chart-panel"><h3>Tương quan độ trễ 0–{CFG.lagMaxMinutes} phút</h3><p className="ft-muted">{nameFor(bestPair.sourceId)} → {nameFor(bestPair.targetId)} · {roomMetric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm'}</p><LagCorrelationChart points={profile}/><p className="ft-muted">{bestPair.detail}</p></div> : null}
            <div className="ft-info"><Info size={16}/> Simulator của nhóm chạy độc lập, nên có thể không phát hiện độ trễ. Phát hiện tương quan không chứng minh sự truyền nhiệt hoặc trao đổi hơi ẩm.</div>
            <p className="ft-muted ft-door-note"><strong>Yếu tố cửa thông phòng:</strong> Cửa mở có thể giúp không khí trao đổi nhanh hơn; cửa đóng có thể làm trao đổi chậm hơn. DHT11 không đo trạng thái cửa, vì vậy hệ thống không tự khẳng định cửa đang mở/đóng hoặc điều chỉnh kết quả theo giả định.</p>
          </section>
        </>}
      </> : null}
    </>}
  </div>;
}
