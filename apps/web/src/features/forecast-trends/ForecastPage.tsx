// [FORECAST - FILE MOI] Giao dien rieng cua module Phan tich xu huong & Du bao.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, TrendingUp, House, Info, Radio, TriangleAlert, Waves, History } from 'lucide-react';
import { Link } from 'react-router';
import type { DeviceView, SpacesView } from '@iot/contracts';
import { api } from '../../lib/api.js';
import { latestDhtSnapshot } from './latestDht.js';
import { formatSensorValue } from '../../lib/sensor-display.js';
import { FORECAST_CONFIG as CFG } from './config.js';
import { fetchForecastHistory, type HistoryResponse } from './history.js';
import { evaluateDhtAssessment } from './dhtAdvisory.js';
import { analyzeTrend } from './timeseries.js';
import { forecastMeasure } from './forecasting.js';
import { MODEL_LABELS, selectForecastModel, type ForecastSelection } from './modelSelection.js';
import { evaluateAdvisory } from './advisory.js';
import { ForecastValidationPanel } from './ForecastValidationPanel.js';
import { MoistureIndicators } from './MicroclimateScenarioPanel.js';
import { PredictionChart } from './ForecastCharts.js';
import ForecastDhtChart from './ForecastDhtChart.js';
import type { MinuteReading, TrendResult } from './types.js';
import { stationDisplayName } from './stationDisplay.js';
import { SpreadScenarioPanel } from './SpreadScenarioPanel.js';
import { classifySpreadRoom } from './spreadForecast.js';
import './forecast-trends.css';

const TABS = [
  { id: 'trend', label: 'Giám sát biến động', icon: Waves },
  { id: 'forecast', label: 'Dự báo 15–30 phút', icon: TrendingUp },
  { id: 'rooms', label: 'Dự báo lan truyền', icon: House },
] as const;
type Tab = (typeof TABS)[number]['id'];
const trendNames = {
  increasing: 'Đang tăng', decreasing: 'Đang giảm', stable: 'Ổn định',
  insufficient: 'Chưa đủ dữ liệu', stale: 'Dữ liệu cũ',
};
const models: { id: ForecastSelection; label: string }[] = [
  { id: 'auto', label: 'Tự động (Khuyên dùng)' },
  { id: 'naive', label: 'Naive (đối chứng)' },
  { id: 'random_forest', label: MODEL_LABELS.random_forest },
  { id: 'holt_winters', label: MODEL_LABELS.holt_winters },
];
const fmt = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const fmtTime = (time: number | null | undefined) => time === null || time === undefined ? 'Chưa có' : new Date(time).toLocaleString('vi-VN');
const emptyPoints: MinuteReading[] = [];
// Chi hien muc chenh lech tren bieu do khi co du bao hop le.
function forecastDeltaText(item: ReturnType<typeof forecastMeasure>, unit: string, horizon: 15 | 30) {
  const last = item.points.at(-1);
  if (item.status !== 'eligible' || item.current === null || !last) return null;
  const delta = last.value - item.current;
  return `${delta >= 0 ? '+' : ''}${fmt(delta)} ${unit} sau ${horizon} phút`;
}


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
  const [roomSelection, setRoomSelection] = useState<string[]>([]);
  const [model, setModel] = useState<ForecastSelection>('auto');
  const [horizon, setHorizon] = useState<15 | 30>(15);
  const [showValidation, setShowValidation] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const queryClient = useQueryClient();
  const latestSignalRef = useRef<{ deviceId: string; latestId: string | null; refreshedAt: number } | null>(null);
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
  // No auto-selected stations: users may choose none, one, or any 2..9 devices.
  const roomIds = roomSelection.filter((id) => activeDevices.some((device) => device.id === id));
  const queryIds = selected ? [selected.id] : [];
  const historyQueries = useQueries({
    queries: queryIds.map((deviceId) => ({
      queryKey: ['forecast-history', deviceId],
      // Compute the rolling history window on EVERY request, not at page render.
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        const requestNow = Date.now();
        const fromMs = Math.floor(requestNow / CFG.minuteMs) * CFG.minuteMs - CFG.historyMinutes * CFG.minuteMs;
        const toMs = Math.ceil(requestNow / CFG.minuteMs) * CFG.minuteMs;
        return fetchForecastHistory(deviceId, fromMs, toMs, signal);
      },
      staleTime: 15_000,
      refetchInterval: 45_000,
    })),
  });
  // The device list can refresh approximately every 5 s. Invalidate Forecast
  // history on a NEW reading ID, but no more often than every 15 s per device.
  // The initial query for a new device starts automatically via useQueries.
  useEffect(() => {
    const deviceId = selected?.id;
    const latestId = selected?.latest?.id ?? null;
    if (!deviceId) { latestSignalRef.current = null; return; }
    const previous = latestSignalRef.current;
    if (!previous || previous.deviceId !== deviceId) {
      latestSignalRef.current = { deviceId, latestId, refreshedAt: Date.now() };
      return;
    }
    if (!latestId || latestId === previous.latestId) return;
    const currentTime = Date.now();
    latestSignalRef.current = { ...previous, latestId };
    if (currentTime - previous.refreshedAt < 15_000) return;
    latestSignalRef.current.refreshedAt = currentTime;
    void queryClient.invalidateQueries({ queryKey: ['forecast-history', deviceId], exact: true });
  }, [selected?.id, selected?.latest?.id, queryClient]);
  const queryFor = (id: string) => historyQueries[queryIds.indexOf(id)];
  const dataFor = (id: string): HistoryResponse | null => queryFor(id)?.data ?? null;
  const selectedQuery = selected ? queryFor(selected.id) : null;
  const selectedData = selected ? dataFor(selected.id) : null;
  const selectedHistory = selectedData?.history;
  const points = selectedHistory?.points ?? emptyPoints;
  const live = selected ? latestDhtSnapshot(selected, nowMs) : null;
  const latestSampleAt = selectedHistory?.latestSampleAt;
  const latestSample = selectedHistory?.latestSample;
  const dataStale = latestSampleAt !== null && latestSampleAt !== undefined && nowMs - latestSampleAt > CFG.staleAfterMs;
  const temperatureTrend = useMemo(() => analyzeTrend(points, 'temperature', nowMs, latestSampleAt), [points, nowMs, latestSampleAt]);
  const humidityTrend = useMemo(() => analyzeTrend(points, 'humidity', nowMs, latestSampleAt), [points, nowMs, latestSampleAt]);
  // Mỗi chỉ số có thể được chọn thuật toán khác nhau trên cùng mốc dự báo.
  const selection = useMemo(() => ({
    temperature: selectForecastModel(points, 'temperature', horizon, nowMs, latestSampleAt, model),
    humidity: selectForecastModel(points, 'humidity', horizon, nowMs, latestSampleAt, model),
  }), [points, model, horizon, nowMs, latestSampleAt]);
  const forecast = useMemo(() => ({
    temperature: forecastMeasure(points, 'temperature', selection.temperature.model, horizon, nowMs, latestSampleAt, latestSample?.temperature),
    humidity: forecastMeasure(points, 'humidity', selection.humidity.model, horizon, nowMs, latestSampleAt, latestSample?.humidity),
  }), [points, selection, horizon, nowMs, latestSampleAt, latestSample]);
  const advisory = useMemo(() => evaluateAdvisory(points, temperatureTrend, humidityTrend, forecast), [points, temperatureTrend, humidityTrend, forecast]);
  const dhtAssessment = useMemo(() => evaluateDhtAssessment(points, nowMs, latestSampleAt), [points, nowMs, latestSampleAt]);
  const spreadStations = roomIds.flatMap((id) => {
    const device = activeDevices.find((d) => d.id === id);
    if (!device) return [];
    const reading = device.latest;
    const snapshot = latestDhtSnapshot(device, nowMs);
    const stamp = reading?.payload.sampled_at ? Date.parse(reading.payload.sampled_at) : NaN;
    const recent = device.status === 'online' && reading?.payload.time_quality === 'synced'
      && Number.isFinite(stamp) && stamp <= nowMs + CFG.minuteMs
      && nowMs - stamp <= CFG.staleAfterMs;
    const roomId = spacesQuery.data?.devices.find(item => item.id === device.id)?.room_id;
    const roomName = spacesQuery.data?.rooms.find(room => room.id === roomId)?.name;
    return [{
      id: device.id,
      name: deviceRoomLabel(device),
      room: classifySpreadRoom(roomName || device.location || device.name),
      temperature: snapshot.temperature ?? 0,
      humidity: snapshot.humidity ?? 0,
      valid: Boolean(recent && snapshot.temperature !== null && snapshot.humidity !== null),
      reason: recent ? snapshot.freshness : 'Dữ liệu không đồng bộ hoặc đã cũ',
    }];
  });
  return <div className="ft-page">
    <div className="page-title ft-title">
      <div><h1>Giám sát & Dự báo</h1><p>Theo dõi nhiệt độ, độ ẩm và dự báo ảnh hưởng lan truyền giữa các trạm từ dữ liệu hệ thống.</p></div>
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
            <div role="status" className={`ft-dht-assessment ft-dht-assessment-${dhtAssessment.status}`}>
              <strong>{dhtAssessment.status === 'stale' ? 'Dữ liệu cũ'
                : dhtAssessment.status === 'insufficient' ? 'Chưa đủ mẫu'
                : dhtAssessment.status === 'normal' ? 'Không có biến động bất thường'
                : 'Có biến động liên tục cần theo dõi'}</strong>
              <p>{dhtAssessment.status === 'stale'
                ? 'Thiết bị đã ngừng gửi dữ liệu mới hơn 5 phút; tạm dừng đánh giá biến động hiện tại.'
                : dhtAssessment.status === 'insufficient'
                  ? `Chưa đủ dữ liệu liên tục (hiện có ${dhtAssessment.validMinutes}/${dhtAssessment.requiredMinutes} phút hợp lệ) để đánh giá biến động.`
                  : dhtAssessment.status === 'normal'
                    ? 'Không ghi nhận biến động bất thường: nhiệt độ và độ ẩm đang duy trì ổn định quanh mức nền.'
                    : 'Biến động được ghi nhận khi đồng thời vượt ngưỡng tốc độ và tổng mức thay đổi trong 6–7 phút liên tục.'}</p>
            </div>
            {dhtAssessment.status === 'watch' ? <div className="ft-notice-list">{dhtAssessment.notices.map((notice, index) => <div key={`${notice.title}:${index}`} className={`ft-notice ft-notice-${notice.level}`}><strong>{notice.title}</strong><p>{notice.detail}</p></div>)}</div> : null}
          </section>
          <section className="panel ft-chart-panel ft-wide-panel">
            <div className="ft-section-bar"><div><h2>Nhiệt độ & độ ẩm</h2></div>
            </div>
            <ForecastDhtChart deviceId={selected.id} />
          </section>
          {dataStale ? <p className="ft-muted">Biểu đồ và tốc độ biến đổi ở trên phản ánh dữ liệu lịch sử trước khi thiết bị ngừng gửi, không phải trạng thái hiện tại.</p> : null}
        </> : null}
        {tab === 'forecast' ? <>
          <section className="panel ft-controls"><label>Mô hình dự báo
            <select value={model} onChange={(e: ChangeEvent<HTMLSelectElement>) => setModel(e.target.value as ForecastSelection)}>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          </label><label>Khoảng dự báo
            <select value={horizon} onChange={(e: ChangeEvent<HTMLSelectElement>) => setHorizon(Number(e.target.value) as 15 | 30)}><option value={15}>15 phút</option><option value={30}>30 phút</option></select>
          </label><div className="ft-controls-caption">Mô hình học từ dữ liệu trung bình theo phút, sau đó neo dự báo vào mẫu DHT11 hợp lệ mới nhất. Random Forest/Holt-Winters chỉ dự báo khi đủ dữ liệu. Tự động chỉ chọn mô hình mới nếu MAE đa mốc tốt hơn mô hình cơ sở.</div></section>
          {forecast.temperature.status !== 'eligible' && forecast.humidity.status !== 'eligible'
            ? <div className="ft-info"><Info size={16}/> {forecast.temperature.reason ?? 'Chưa đủ dữ liệu mới để dự báo tương lai.'} Không sử dụng dự báo hồi cứu thay thế.</div> : null}
          <div className="ft-two-cards">
            {(['temperature', 'humidity'] as const).map((metric) => {
              const forecastItem = forecast[metric];
              const chosen = selection[metric];
              const last = forecastItem.points.at(-1);
              const unit = metric === 'temperature' ? '°C' : '%RH';
              return <article key={metric} className="ft-metric"><div className="ft-metric-heading"><span>{metric === 'temperature' ? 'Nhiệt độ' : 'Độ ẩm'} dự kiến</span><span className="ft-forecast-tag">Sau {horizon} phút</span></div>
                <div className="ft-big-number">{fmt(last?.value)} <small>{unit}</small></div>
                <p className="ft-model-caption"><strong>Đang dùng: {MODEL_LABELS[chosen.model]}</strong></p>
                <p className="ft-model-caption">{chosen.explanation}</p>
                {forecastItem.status === 'eligible' && last
                  ? <div className="ft-metric-bottom"><span>Thay đổi dự kiến: {forecastItem.current !== null ? `${last.value - forecastItem.current >= 0 ? '+' : ''}${fmt(last.value - forecastItem.current)} ${unit}` : '—'}</span><span>Mốc đo đầu: {fmtTime(forecastItem.lastSampleAt)}</span></div>
                  : <p className="ft-warning">{forecastItem.reason ?? 'Chưa đủ dữ liệu.'}</p>}
              </article>;
            })}
          </div>
          <section className="panel ft-chart-panel ft-wide-panel"><div className="ft-section-bar"><h2>Dự báo nhiệt độ</h2><span className="ft-muted">{forecastDeltaText(forecast.temperature, '°C', horizon) ?? `Chưa có dự báo hợp lệ +${horizon} phút`}</span></div>
            <PredictionChart points={points} metric="temperature" result={forecast} /></section>
          <section className="panel ft-chart-panel ft-wide-panel"><div className="ft-section-bar"><h2>Dự báo độ ẩm</h2><span className="ft-muted">{forecastDeltaText(forecast.humidity, '%RH', horizon) ?? `Chưa có dự báo hợp lệ +${horizon} phút`}</span></div>
            <PredictionChart points={points} metric="humidity" result={forecast} /></section>
          <section className="panel ft-validation-toggle">
            <button type="button" onClick={() => setShowValidation((open) => !open)}>
              {showValidation ? 'Ẩn kiểm chứng MAE' : 'Xem kiểm chứng MAE đa mốc'}
            </button>
            <p className="ft-muted">Kết quả chỉ phản ánh các mốc quá khứ đã có số đo để đối chiếu, không bảo đảm dự báo tương lai chính xác tuyệt đối.</p>
          </section>
          {showValidation ? <ForecastValidationPanel history={points} horizon={horizon} model={{
            temperature: selection.temperature.model, humidity: selection.humidity.model,
          }}/> : null}
          <section className={`panel ft-advisory ft-advisory-${advisory.level}`}><h3><TriangleAlert size={18} /> {advisory.title}</h3>
            {advisory.details.length ? <ul>{advisory.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : <p>Chưa phát hiện biến động đáng chú ý từ dữ liệu hiện có.</p>}
            <p className="ft-muted">Đây là ước tính thống kê, không phải số đo tương lai hay cảnh báo nguy hiểm đã xác nhận.</p>
          </section>
        </> : null}
      </> : null}
      {tab === 'rooms' ? <>
        <section className="panel ft-room-filter">
          <div className="ft-section-bar">
            <div><h2>Chọn các trạm để dự báo lan truyền</h2><p className="ft-muted">Chọn từ 2 đến {maxComparison} trạm. Không chọn thì không hiển thị dự báo; chọn 1 trạm thì cần thêm trạm khác.</p></div>
            <div className="ft-room-actions">
              <span className="ft-muted">Đã chọn {roomIds.length}/{maxComparison} trạm</span>
              <button type="button" onClick={() => setRoomSelection([])}>Bỏ chọn</button>
              <button type="button" onClick={() => setRoomSelection(activeDevices.slice(0, maxComparison).map(device => device.id))}>Chọn tất cả {maxComparison} trạm</button>
            </div>
          </div>
          <div className="ft-room-options">{activeDevices.map((device) => {
            const chosen = roomIds.includes(device.id);
            return <label key={device.id} className="ft-check"><input type="checkbox" checked={chosen}
              disabled={!chosen && roomIds.length >= maxComparison}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setRoomSelection(old => event.target.checked
                ? [...old.filter(id => activeDevices.some(d => d.id === id)), device.id].slice(0, maxComparison)
                : old.filter(id => id !== device.id))}/>{deviceRoomLabel(device)}</label>;
          })}</div>
        </section>
        {roomIds.length === 1 ? <section className="panel ft-spread-state" role="status"><House size={23}/><strong>Đã chọn 1 trạm</strong><p>Hãy chọn thêm ít nhất 1 trạm để xem nhiệt và hơi ẩm dự kiến ảnh hưởng tới vị trí khác như thế nào.</p></section> : null}
        {roomIds.length >= 2 ? <SpreadScenarioPanel stations={spreadStations}/> : null}
      </> : null}
    </>}
  </div>;
}
