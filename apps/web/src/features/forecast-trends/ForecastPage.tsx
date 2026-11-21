// [FORECAST - FILE MOI] Giao dien rieng cua module Phan tich xu huong & Du bao.
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, ChartNoAxesCombined, TrendingUp, House, Info, Radio, TriangleAlert, FlaskConical, Database, History, ChevronRight, Gauge } from 'lucide-react';
import { Link } from 'react-router';
import type { DeviceView, SpacesView } from '@iot/contracts';
import { api } from '../../lib/api.js';
import { latestDhtSnapshot } from './latestDht.js';
import { formatSensorValue } from '../../lib/sensor-display.js';
import { FORECAST_CONFIG as CFG } from './config.js';
import { fetchForecastHistory, type HistoryResponse } from './history.js';
import { ForecastValidationPanel } from './ForecastValidationPanel.js';
import { evaluateDhtChange } from './dhtAdvisory.js';
import { analyzeTrend } from './timeseries.js';
import { forecastBoth } from './forecasting.js';
import { evaluateAdvisory } from './advisory.js';
import { analyzeAllRoomPairs, lagCorrelationProfile } from './interRoom.js';
import { historicalReplay } from './replay.js';
import { buildDemoScenario, DEMO_ROOMS } from './demoScenario.js';
import type { DemoRoomId, DemoEffect } from './demoScenario.js';
import { DEFAULT_DOORS } from './microclimate.js';
import type { DoorStates } from './microclimate.js';
import { MicroclimateScenarioPanel, MoistureIndicators } from './MicroclimateScenarioPanel.js';
import { RoomImpactTimeline } from './RoomImpactTimeline.js';
import { CombinedTrendChart, LagCorrelationChart, PredictionChart, RoomComparisonChart } from './ForecastCharts.js';
import MonitoringChart from '../../pages/MonitoringChart.js';
import type { ForecastModel, Measure, MinuteReading, TrendResult } from './types.js';
import './forecast-trends.css';

const TABS = [
  { id: 'trend', label: 'Phân tích xu hướng', icon: ChartNoAxesCombined },
  { id: 'forecast', label: 'Dự báo 15–30 phút', icon: TrendingUp },
  { id: 'validation', label: 'Kiểm chứng dự báo', icon: Gauge },
  { id: 'rooms', label: 'Ảnh hưởng liên khu vực', icon: House },
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
const roomName = (device: DeviceView) => device.location?.trim() || device.name;
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
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [selectedId, setSelectedId] = useState('');
  const [roomSelection, setRoomSelection] = useState<string[] | null>(null);
  const [model, setModel] = useState<ForecastModel>('holt');
  const [horizon, setHorizon] = useState<15 | 30>(15);
  const [showAverage, setShowAverage] = useState(false);
  const [demoSource, setDemoSource] = useState<DemoRoomId>('demo-kitchen');
  const [demoEffect, setDemoEffect] = useState<DemoEffect>('temperature');
  const [demoDoors, setDemoDoors] = useState<DoorStates>({ ...DEFAULT_DOORS });
  const [roomMetric, setRoomMetric] = useState<Measure>('temperature');
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const demo = useMemo(() => buildDemoScenario(nowMs, demoSource, demoEffect, demoDoors), [nowMs, demoSource, demoEffect, demoDoors]);
  const activeDevices = mode === 'demo' ? demo.devices : devices.filter((device) => !device.archived_at);
  const spacesQuery = useQuery({ queryKey: ['monitoring-spaces'], queryFn: () => api<SpacesView>('/spaces'), enabled: mode === 'live', staleTime: 60_000 });
  const deviceRoomLabel = (device: DeviceView) => {
    if (mode === 'demo') return roomName(device);
    const assigned = spacesQuery.data?.devices.find((item) => item.id === device.id);
    const room = assigned?.room_id ? spacesQuery.data?.rooms.find((item) => item.id === assigned.room_id) : null;
    return room?.name ?? roomName(device);
  };
  const selected = activeDevices.find((device) => device.id === selectedId) ?? activeDevices[0];
  const roomIds = roomSelection === null
    ? activeDevices.slice(0, 4).map((device) => device.id)
    : roomSelection.filter((id) => activeDevices.some((device) => device.id === id));
  const queryIds = mode === 'demo' ? [] : tab === 'rooms'
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
  const dataFor = (id: string): HistoryResponse | null => mode === 'demo'
    ? demo.histories[id] ? { history: demo.histories[id]!, partial: false, historicalFallback: false, fetched: demo.histories[id]!.validSamples } : null
    : queryFor(id)?.data ?? null;
  const selectedQuery = mode === 'live' && selected ? queryFor(selected.id) : null;
  const selectedData = selected ? dataFor(selected.id) : null;
  const selectedHistory = selectedData?.history;
  const points = selectedHistory?.points ?? emptyPoints;
  const live = selected ? latestDhtSnapshot(selected, nowMs) : null;
  const latestSampleAt = selectedHistory?.latestSampleAt;
  const dataStale = latestSampleAt !== null && latestSampleAt !== undefined && nowMs - latestSampleAt > CFG.staleAfterMs;
  const temperatureTrend = useMemo(() => analyzeTrend(points, 'temperature', nowMs, latestSampleAt), [points, nowMs, latestSampleAt]);
  const humidityTrend = useMemo(() => analyzeTrend(points, 'humidity', nowMs, latestSampleAt), [points, nowMs, latestSampleAt]);
  const forecast = useMemo(() => forecastBoth(points, model, horizon, nowMs, latestSampleAt), [points, model, horizon, nowMs, latestSampleAt]);
  const replay = useMemo(() => historicalReplay(points, model, horizon), [points, model, horizon]);
  const useReplay = forecast.temperature.status !== 'eligible' && forecast.humidity.status !== 'eligible' && replay !== null;
  const shownForecast = useReplay ? replay.forecast : forecast;
  const advisory = useMemo(() => evaluateAdvisory(points, temperatureTrend, humidityTrend, forecast), [points, temperatureTrend, humidityTrend, forecast]);
  const dhtNotices = useMemo(() => evaluateDhtChange(points, nowMs), [points, nowMs]);
  // Historical chart is anchored at the last measurement, not the wall clock.
  const recent = useMemo(() => points.filter((p) => p.timestamp >= (latestSampleAt ?? nowMs) - CFG.chartMinutes * CFG.minuteMs), [points, nowMs, latestSampleAt]);
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
  const switchMode = (nextMode: 'live' | 'demo') => {
    setMode(nextMode); setSelectedId(''); setRoomSelection(null);
  };

  return <div className="ft-page">
    <div className="page-title ft-title">
      <div><h1>Phân tích xu hướng & Dự báo</h1><p>Theo dõi biến động, dự báo ngắn hạn và quan hệ nhiệt độ – độ ẩm giữa các khu vực.</p></div>
      {selected ? <label className="ft-device-select">Thiết bị / khu vực
        <select value={selected.id} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedId(event.target.value)}>
          {activeDevices.map((device) => <option value={device.id} key={device.id}>{deviceRoomLabel(device)}{deviceRoomLabel(device) === device.name ? '' : ` · ${device.name}`}{device.source_kind === 'simulator' ? ' (mô phỏng)' : ''}</option>)}
        </select>
      </label> : null}
    </div>

    <div className="ft-mode-bar" aria-label="Nguồn dữ liệu phân tích">
      <div className="ft-mode-heading"><strong>Nguồn dữ liệu</strong><span>Trang phân tích dùng chung API và danh sách thiết bị với Monitoring.</span></div>
      <div className="ft-mode-buttons">
        <button type="button" className={mode === 'live' ? 'ft-mode-active' : ''} onClick={() => switchMode('live')} aria-pressed={mode === 'live'}><Database size={16} /> Dữ liệu hệ thống ({devices.filter((d) => !d.archived_at).length})</button>
        <button type="button" className={mode === 'demo' ? 'ft-mode-active' : ''} onClick={() => switchMode('demo')} aria-pressed={mode === 'demo'}><FlaskConical size={16} /> Thử nghiệm 4 phòng</button>
      </div>
    </div>

    {mode === 'demo'
      ? <div className="ft-demo-banner" role="status"><FlaskConical size={19} /><div><strong>Chế độ mô phỏng thuật toán – 4 phòng</strong><p>Dữ liệu vi khí hậu được mô phỏng bằng cân bằng nhiệt và hơi ẩm giữa các phòng. Cửa và nguồn nhiệt/ẩm là giả định; không ghi vào API, không phải số đo thực.</p></div></div>
      : <div className="ft-info"><Info size={17} /> Đang dùng dữ liệu thiết bị và phòng từ hệ thống nhóm. Hiện có {activeDevices.length} thiết bị; cần ít nhất hai thiết bị có chuỗi dữ liệu cùng thời gian để phân tích liên phòng.</div>}

    {!selected ? <div className="panel ft-state">Chưa có thiết bị trong hệ thống. <Link to="/app/devices">Mở mục Thiết bị</Link> hoặc dùng chế độ thử nghiệm 4 phòng để xem chức năng.</div> : <>
      <nav className="ft-tabs" aria-label="Chức năng phân tích và dự báo">
        {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}
      </nav>
      {mode === 'live' && selected.source_kind === 'simulator' ? <div className="ft-note-inline"><Info size={15} /> Thiết bị đang chọn là Simulator của nhóm; số liệu được gửi qua API chung.</div> : null}
      {tab === 'validation' ? <section className="panel ft-controls"><label>Mô hình dự báo
          <select value={model} onChange={(e: ChangeEvent<HTMLSelectElement>) => setModel(e.target.value as ForecastModel)}>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label><label>Khoảng dự báo
          <select value={horizon} onChange={(e: ChangeEvent<HTMLSelectElement>) => setHorizon(Number(e.target.value) as 15 | 30)}><option value={15}>15 phút</option><option value={30}>30 phút</option></select>
        </label></section> : null}
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
            {dhtNotices.length ? <div className="ft-notice-list">{dhtNotices.map((notice, index) => <div key={`${notice.title}:${index}`} className={`ft-notice ft-notice-${notice.level}`}><strong>{notice.title}</strong><p>{notice.detail}</p></div>)}</div> : <p className="ft-muted">Chưa ghi nhận biến động đủ nhanh trên dữ liệu mới, hoặc chưa đủ mẫu để đánh giá.</p>}
            <p className="ft-muted">Nhận định được tính từ lịch sử nhiệt độ và độ ẩm; không xác nhận nguyên nhân biến động.</p>
          </section>
          <section className="panel ft-chart-panel ft-wide-panel">
            <div className="ft-section-bar"><div><h2>Nhiệt độ & độ ẩm</h2><p className="ft-muted">{mode === 'live' ? '120 mẫu gần nhất · dùng đúng biểu đồ Giám sát trực tiếp của nhóm' : '60 phút mô phỏng gần nhất · bắt đầu từ mẫu có dữ liệu đầu tiên'}</p></div>
              {mode === 'demo' ? <label className="ft-check"><input type="checkbox" checked={showAverage} onChange={(e: ChangeEvent<HTMLInputElement>) => setShowAverage(e.target.checked)} /> Đường làm mượt</label> : null}
            </div>
            {mode === 'live' ? <MonitoringChart deviceId={selected.id} /> : <CombinedTrendChart points={recent} showAverage={showAverage} />}
          </section>
          {dataStale ? <p className="ft-muted">Biểu đồ và tốc độ biến đổi ở trên phản ánh dữ liệu lịch sử trước khi thiết bị ngừng gửi, không phải trạng thái hiện tại.</p> : null}
        </> : null}
        {tab === 'validation' ? <ForecastValidationPanel history={points} horizon={horizon} model={model}/> : null}
        {tab === 'forecast' ? <>
          <section className="panel ft-controls"><label>Mô hình dự báo
            <select value={model} onChange={(e: ChangeEvent<HTMLSelectElement>) => setModel(e.target.value as ForecastModel)}>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          </label><label>Khoảng dự báo
            <select value={horizon} onChange={(e: ChangeEvent<HTMLSelectElement>) => setHorizon(Number(e.target.value) as 15 | 30)}><option value={15}>15 phút</option><option value={30}>30 phút</option></select>
          </label><div className="ft-controls-caption">Hồi quy/Holt cần tối thiểu 5 phút có dữ liệu; dự báo mới chỉ hoạt động khi cảm biến còn cập nhật.</div></section>
          {useReplay ? <div className="ft-demo-banner ft-replay-banner"><History size={19}/><div><strong>Đang xem dự báo hồi cứu – không phải dự báo thời gian thực</strong><p>Thiết bị đã ngừng gửi dữ liệu. Mô hình được chạy lại tại {fmtTime(replay.originTime)} để dự đoán tới {fmtTime(replay.targetTime)}, sau đó đối chiếu với số đo lịch sử đã ghi nhận.</p></div></div> : null}
          {!useReplay && forecast.temperature.status !== 'eligible' && forecast.humidity.status !== 'eligible' ? <div className="ft-info"><Info size={16}/> {forecast.temperature.reason ?? 'Chưa đủ lịch sử để dự báo.'} Chưa có đủ dữ liệu để trình bày hồi cứu tại khoảng thời gian đã chọn.</div> : null}
          <div className="ft-two-cards">
            {(['temperature', 'humidity'] as const).map((metric) => {
              const forecastItem = shownForecast[metric];
              const last = forecastItem.points.at(-1);
              const unit = metric === 'temperature' ? '°C' : '%RH';
              const observed = useReplay ? replay.actual[metric] : null;
              return <article key={metric} className="ft-metric"><div className="ft-metric-heading"><span>{metric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm'} {useReplay ? 'hồi cứu' : 'dự kiến'}</span><span className="ft-forecast-tag">{horizon} phút</span></div>
                <div className="ft-big-number">{fmt(last?.value)} <small>{unit}</small></div>
                {forecastItem.status === 'eligible'
                  ? <div className="ft-metric-bottom"><span>{useReplay ? `Đã đo: ${fmt(observed)} ${unit}` : `Thay đổi: ${last && forecastItem.current !== null ? `${last.value - forecastItem.current >= 0 ? '+' : ''}${fmt(last.value - forecastItem.current)} ${unit}` : '—'}`}</span>{useReplay && last && observed !== null ? <span>Độ lệch: {fmt(Math.abs(last.value - observed))} {unit}</span> : null}</div>
                  : <p className="ft-warning">{forecastItem.reason}</p>}
              </article>;
            })}
          </div>
          <section className="panel ft-chart-panel ft-wide-panel"><div className="ft-section-bar"><h2>{useReplay ? 'Đối chiếu dự báo với nhiệt độ đã đo' : 'Dự báo nhiệt độ'}</h2><span className="ft-muted">{useReplay ? 'Bắt đầu tại mốc dự báo lịch sử; các điểm sau là dự báo và số đo đối chiếu' : 'Bắt đầu từ mẫu hiện tại, tiếp theo là các mốc +5, +10, +15/30 phút'}</span></div>
            <PredictionChart points={points} metric="temperature" result={shownForecast} replay={useReplay} /></section>
          <section className="panel ft-chart-panel ft-wide-panel"><div className="ft-section-bar"><h2>{useReplay ? 'Đối chiếu dự báo với độ ẩm đã đo' : 'Dự báo độ ẩm'}</h2><span className="ft-muted">{useReplay ? 'Bắt đầu tại mốc dự báo lịch sử; các điểm sau là dự báo và số đo đối chiếu' : 'Bắt đầu từ mẫu hiện tại, tiếp theo là các mốc +5, +10, +15/30 phút'}</span></div>
            <PredictionChart points={points} metric="humidity" result={shownForecast} replay={useReplay} /></section>
          <section className={`panel ft-advisory ft-advisory-${advisory.level}`}><h3><TriangleAlert size={18} /> {useReplay ? 'Nhận định lịch sử' : advisory.title}</h3>
            {useReplay ? <p>Đây là kiểm tra sai số trên dữ liệu đã ghi nhận, không đánh giá tình trạng môi trường ở thời điểm hiện tại.</p>
              : advisory.details.length ? <ul>{advisory.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : <p>Chưa phát hiện biến động đáng chú ý từ dữ liệu hiện có.</p>}
            <p className="ft-muted">Nhận định và dự báo chỉ tham khảo xu hướng nhiệt độ, độ ẩm; không thay thế kiểm tra điều kiện môi trường thực tế.</p>
          </section>
          {dhtNotices.length && !useReplay ? <section className="panel ft-dht-notices"><h3>Biến động nhanh ghi nhận</h3><ul>{dhtNotices.map((notice,index) => <li key={`${notice.title}:${index}`}><strong>{notice.title}:</strong> {notice.detail}</li>)}</ul><p className="ft-muted">Nên kiểm tra cảm biến và điều kiện thông gió nếu biến động kéo dài.</p></section> : null}
        </> : null}
      </> : null}
      {tab === 'rooms' ? <>
        {mode === 'demo' ? <section className="panel ft-demo-settings"><div><h2>Kịch bản ảnh hưởng liên phòng</h2><p className="ft-muted">Chọn bất kỳ phòng nào làm nguồn biến động; tất cả tín hiệu đều là số liệu giả định.</p></div>
          <label>Phòng phát sinh thay đổi<select value={demoSource} onChange={(e: ChangeEvent<HTMLSelectElement>) => setDemoSource(e.target.value as DemoRoomId)}>{DEMO_ROOMS.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
          <label>Loại nguồn vi khí hậu<select value={demoEffect} onChange={(e: ChangeEvent<HTMLSelectElement>) => { const effect = e.target.value as DemoEffect; setDemoEffect(effect); setRoomMetric(effect === 'humidity' ? 'humidity' : 'temperature'); }}><option value="temperature">Nguồn làm nóng (bếp/nắng)</option><option value="humidity">Nguồn tạo hơi ẩm (tắm/nấu ăn)</option><option value="cooling">Làm mát (điều hòa giả định)</option></select></label>
        </section> : null}
        {mode === 'demo' ? <MicroclimateScenarioPanel demo={demo} doors={demoDoors} onDoorsChange={setDemoDoors} horizon={horizon} /> : null}
        <section className="panel ft-room-filter"><div className="ft-section-bar"><h2>Các khu vực theo dõi</h2><span className="ft-muted">Chọn từ 2 đến 4 thiết bị để phân tích độ trễ.</span></div>
          <div className="ft-room-options">{activeDevices.map((device) => {
            const chosen = roomIds.includes(device.id);
            return <label key={device.id} className="ft-check"><input type="checkbox" checked={chosen} disabled={!chosen && roomIds.length >= 4} onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const checked = event.target.checked;
              setRoomSelection((old) => { const base = old ?? activeDevices.slice(0, 4).map((item) => item.id); return checked ? [...base, device.id].slice(0, 4) : base.filter((id) => id !== device.id); });
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
            {mode === 'demo' && id === demoSource ? <span className="ft-source-badge">Nguồn biến động giả định</span> : null}
            {mode === 'live' && !data ? <span className="ft-warning">{queryFor(id)?.isPending ? 'Đang tải lịch sử…' : 'Chưa tải được lịch sử'}</span> : null}
            <span className="ft-muted">{mode === 'demo' ? 'Dữ liệu tạo trong trình duyệt' : last.freshness}</span>
          </button>;
        })}</div>
        {roomIds.length < 2 ? <section className="panel ft-empty-multi"><House size={30}/><h2>Hiện chưa đủ khu vực để phân tích ảnh hưởng</h2><p>Hệ thống mới có {activeDevices.length} thiết bị. Dữ liệu liên phòng cần ít nhất hai thiết bị, được ghi ở cùng mốc thời gian.</p>
          <div className="ft-empty-actions"><button onClick={() => switchMode('demo')}><FlaskConical size={17}/> Thử mô phỏng 4 phòng</button><Link to="/app/devices">Quản lý thiết bị <ArrowRight size={15}/></Link></div>
        </section> : <>
          <section className="panel ft-wide-panel ft-chart-panel"><div className="ft-section-bar"><div><h2>So sánh diễn biến giữa các phòng</h2><p className="ft-muted">Đường thời gian được đồng bộ; chọn chỉ số muốn xem.</p></div>
            <div className="ft-switch-metric"><button className={roomMetric === 'temperature' ? 'active' : ''} onClick={() => setRoomMetric('temperature')}>Nhiệt độ</button><button className={roomMetric === 'humidity' ? 'active' : ''} onClick={() => setRoomMetric('humidity')}>Độ ẩm</button></div>
          </div><RoomComparisonChart rooms={roomHistories} metric={roomMetric}/></section>
          <RoomImpactTimeline rooms={roomHistories} metric={roomMetric} sourceId={mode === 'demo' ? demoSource : undefined} demo={mode === 'demo'}/>
          <section className="panel ft-links"><div className="ft-section-bar"><h2>Quan hệ biến động có độ trễ</h2><Activity size={19}/></div>
            <p>Hệ thống đối chiếu biến động theo phút theo mọi hướng, từ 1 đến {CFG.lagMaxMinutes} phút. Có tương quan không đồng nghĩa là đã chứng minh nhiệt hoặc hơi ẩm lan truyền.</p>
            {mode === 'live' && historyQueries.some((query) => query.isPending) ? <p>Đang tải lịch sử các phòng…</p> : null}
            {matchingCandidates.length ? <div className="ft-link-list">{matchingCandidates.slice(0, 8).map((entry) => <article key={`${entry.sourceId}:${entry.targetId}:${entry.metric}`} className="ft-link-item">
              <strong>{nameFor(entry.sourceId)} <ArrowRight size={16}/> {nameFor(entry.targetId)}</strong>
              <span>Độ trễ khoảng {entry.lagMinutes} phút · tương quan {entry.correlation?.toFixed(2)} · {entry.samplePairs} cặp dữ liệu</span><small>{mode === 'demo' ? 'Tương quan trên dữ liệu mô hình vi khí hậu giả định' : 'Nghi vấn liên hệ thống kê, chưa xác nhận lan truyền'}</small>
            </article>)}</div> : <p className="ft-muted">{roomLag.length && roomLag.every((item) => item.status === 'insufficient') ? 'Chưa đủ dữ liệu đồng bộ để phát hiện độ trễ.' : 'Chưa phát hiện mối liên hệ trễ đủ rõ trên dữ liệu hiện tại.'}</p>}
            {bestPair ? <div className="ft-lag-chart-panel"><h3>Tương quan độ trễ 0–{CFG.lagMaxMinutes} phút</h3><p className="ft-muted">{nameFor(bestPair.sourceId)} → {nameFor(bestPair.targetId)} · {roomMetric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm'}</p><LagCorrelationChart points={profile}/><p className="ft-muted">{bestPair.detail}</p></div> : null}
            <div className="ft-info"><Info size={16}/>{mode === 'demo' ? 'Đây là mô hình trao đổi nhiệt và hơi ẩm đa phòng với các hệ số, cửa và nguồn phát giả định; không phải số liệu vật lý đã được hiệu chuẩn.' : 'Simulator của nhóm chạy độc lập, nên có thể không phát hiện độ trễ. Phát hiện tương quan không chứng minh truyền nhiệt hoặc trao đổi hơi ẩm.'}</div>
          </section>
        </>}
      </> : null}
    </>}
  </div>;
}
