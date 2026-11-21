// [FORECAST - FILE MOI] Giao dien rieng cua module Phan tich xu huong & Du bao.
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { FORECAST_CONFIG as CFG } from './config.js';
import type { ForecastResult, LagCorrelationPoint, Measure, MinuteReading } from './types.js';
import { forecastTimeline, trimEmptyStart } from './chartTimeline.js';
import { predictionYAxisDomain } from './predictionAxis.js';

const colors = { temperature: '#f59e0b', humidity: '#38bdf8' };
const names = { temperature: 'Nhiệt độ', humidity: 'Độ ẩm' };
const units = { temperature: '°C', humidity: '%RH' };
const asTime = (time: number) => new Date(time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const tooltipLabel = (time: unknown) => typeof time === 'number' ? new Date(time).toLocaleString('vi-VN') : '';
const tooltipStyle = { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10 };
const axisColor = 'var(--muted)';
function EmptyChart({ description }: { description: string }) {
  return <div className="ft-empty" role="status">{description}</div>;
}

/** Match the shared Monitoring chart: both DHT11 metrics in one full-width chart with dual axes. */
export function CombinedTrendChart({ points, showAverage }: { points: readonly MinuteReading[]; showAverage: boolean }) {
  const visible = trimEmptyStart(points);
  if (!visible.length)
    return <EmptyChart description="Chưa có phép đo hợp lệ để hiển thị biến động." />;
  return (
    <div className="ft-chart ft-chart-large" role="img" aria-label="Biểu đồ nhiệt độ và độ ẩm đo được theo thời gian">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={visible} margin={{ top: 14, right: 8, bottom: 8, left: -12 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={asTime} tick={{ fontSize: 11 }} minTickGap={50} stroke={axisColor} />
          <YAxis yAxisId="temperature" domain={[0, 'auto']} tick={{ fontSize: 11 }} width={43} stroke={axisColor} />
          <YAxis yAxisId="humidity" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} width={43} stroke={axisColor} />
          <Tooltip labelFormatter={tooltipLabel} formatter={(value: unknown, name: unknown): [string, string] => [typeof value === 'number' ? value.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : '—', String(name)]} contentStyle={tooltipStyle} />
          <Legend />
          <Line yAxisId="temperature" dataKey="temperature" name="Nhiệt độ (°C)" type="linear" stroke={colors.temperature} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line yAxisId="humidity" dataKey="humidity" name="Độ ẩm (%RH)" type="linear" stroke={colors.humidity} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
          {showAverage ? <>
            <Line yAxisId="temperature" dataKey="temperatureMa" name="Nhiệt độ làm mượt" type="linear" stroke={colors.temperature} strokeDasharray="5 5" opacity={0.58} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line yAxisId="humidity" dataKey="humidityMa" name="Độ ẩm làm mượt" type="linear" stroke={colors.humidity} strokeDasharray="5 5" opacity={0.58} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
          </> : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Actual and forecast are separate series; in replay mode they deliberately overlap for evaluation. */
export function PredictionChart({ points, metric, result, replay = false }: {
  points: readonly MinuteReading[];
  metric: Measure;
  result: ForecastResult;
  replay?: boolean;
}) {
  const prediction = result[metric];
  if (prediction.status !== 'eligible' || !prediction.points.length)
    return <EmptyChart description={prediction.reason ?? 'Chưa có dự báo hợp lệ.'} />;
  // The first point is the forecast origin (the most recent valid measurement),
  // NOT 35 minutes of historical data. All remaining X-axis positions are future
  // +5, +10, +15 / +30 minutes. Replay compares against actual later samples.
  const timeline = forecastTimeline(points, metric, prediction, replay);
  if (!timeline) return <EmptyChart description="Chưa có mốc thời gian dự báo hợp lệ." />;
  const { origin, forecastEnd, ticks, data } = timeline;
  const domain = predictionYAxisDomain(data, metric);
  return (
    <div className="ft-chart ft-chart-prediction" role="img" aria-label={replay ? 'So sánh dự báo hồi cứu với phép đo đã ghi nhận' : 'So sánh số đo và dự báo tương lai'}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 15, right: 7, bottom: 10, left: -10 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="timestamp" type="number" domain={[origin, forecastEnd]} ticks={ticks} interval="preserveStartEnd" allowDataOverflow scale="time" tickFormatter={asTime} stroke={axisColor} tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis domain={domain} allowDataOverflow width={48} stroke={axisColor} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={tooltipLabel} formatter={(value: unknown, name: unknown): [string, string] => [typeof value === 'number' ? `${value.toFixed(2)} ${units[metric]}` : '—', String(name)]} contentStyle={tooltipStyle} />
          <Legend />
          <Line dataKey="actual" type="linear" name={replay ? `${names[metric]} đã đo` : `${names[metric]} hiện tại`} stroke={colors[metric]} strokeWidth={2.6} dot={replay ? false : { r: 4 }} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="predicted" type="linear" name={replay ? 'Dự báo hồi cứu' : 'Dự báo tương lai'} stroke={replay ? '#a78bfa' : '#34d399'} strokeWidth={2.6} strokeDasharray="7 4" dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const roomColors = ['#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#f472b6', '#22d3ee', '#c084fc', '#84cc16'];
/** Same minute timeline for up to nine stations, using only histories passed by caller. */
export function RoomComparisonChart({ rooms, metric }: {
  rooms: readonly { id: string; name: string; points: readonly MinuteReading[] }[];
  metric: Measure;
}) {
  if (rooms.length < 2) return <EmptyChart description="Cần ít nhất hai khu vực có lịch sử đo." />;
  const joined = new Map<number, Record<string, number | null>>();
  rooms.forEach((room, i) => {
    for (const point of room.points) {
      const record = joined.get(point.timestamp) ?? { timestamp: point.timestamp };
      record[`room${i}`] = point[metric];
      joined.set(point.timestamp, record);
    }
  });
  const all = [...joined.values()].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const tail = all.slice(-65);
  const validValues = tail.flatMap((row) => rooms.flatMap((_, i) => typeof row[`room${i}`] === 'number' ? [row[`room${i}`]!] : []));
  if (!validValues.length) return <EmptyChart description="Không có đủ số đo đồng bộ để vẽ các khu vực." />;
  const lo = Math.min(...validValues);
  const hi = Math.max(...validValues);
  const pad = metric === 'temperature' ? Math.max(2, (hi - lo) * 0.2) : Math.max(6, (hi - lo) * 0.2);
  const domain: [number, number] = [Math.max(metric === 'humidity' ? 0 : -40, Math.floor(lo - pad)), Math.min(metric === 'humidity' ? 100 : 125, Math.ceil(hi + pad))];
  return <div className={`ft-chart ft-chart-large ${rooms.length > 4 ? 'ft-chart-many' : ''}`} role="img" aria-label="Biểu đồ nhiều trạm theo cùng mốc thời gian">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={tail} margin={{ top: 12, right: 8, bottom: 6, left: -10 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
        <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={asTime} tick={{ fontSize: 11 }} stroke={axisColor} minTickGap={48} />
        <YAxis domain={domain} tick={{ fontSize: 11 }} stroke={axisColor} width={47} />
        <Tooltip labelFormatter={tooltipLabel} formatter={(value: unknown, name: unknown): [string, string] => [typeof value === 'number' ? `${value.toFixed(2)} ${units[metric]}` : '—', String(name)]} contentStyle={tooltipStyle} />
        <Legend />
        {rooms.map((room, index) => <Line key={room.id} dataKey={`room${index}`} type="linear" name={room.name} stroke={roomColors[index % roomColors.length]} strokeWidth={2.4} dot={false} connectNulls={false} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

/** Descriptive cross-correlation for a pair; never proof of physical spread. */
export function LagCorrelationChart({ points }: { points: readonly LagCorrelationPoint[] }) {
  if (!points.some((point) => point.correlation !== null)) return <EmptyChart description="Chưa đủ cặp biến động để vẽ tương quan độ trễ." />;
  return <div className="ft-chart ft-chart-lag" role="img" aria-label="Tương quan biến động theo độ trễ 0 đến 15 phút">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={[...points]} margin={{ top: 12, right: 16, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" opacity={0.5} />
        <XAxis type="number" dataKey="lagMinutes" domain={[0, CFG.lagMaxMinutes]} allowDecimals={false} tick={{ fontSize: 11 }} stroke={axisColor} label={{ value: 'Độ trễ (phút)', position: 'insideBottom', offset: -8, fill: axisColor }} />
        <YAxis domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} width={40} tick={{ fontSize: 11 }} stroke={axisColor} />
        <Tooltip labelFormatter={(value: unknown) => `Độ trễ ${String(value)} phút`} formatter={(value: unknown): [string, string] => [typeof value === 'number' ? value.toFixed(2) : '—', 'Tương quan']} contentStyle={tooltipStyle} />
        <ReferenceLine y={0} stroke={axisColor} strokeDasharray="3 4" />
        <Line dataKey="correlation" type="linear" name="Tương quan" stroke={colors.humidity} strokeWidth={2.4} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
