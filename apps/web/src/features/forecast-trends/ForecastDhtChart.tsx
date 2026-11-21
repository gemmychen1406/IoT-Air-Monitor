// Forecast-only version of the Monitoring chart: same 120 raw readings and look,
// but invalid/unsynchronized/out-of-range DHT11 samples can never be plotted.
// Shared pages/MonitoringChart.tsx is intentionally left unchanged.
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import type { ReadingView } from '@iot/contracts';
import { api } from '../../lib/api.js';
import { forecastChartPoints } from './forecastDhtReadings.js';

export default function ForecastDhtChart({ deviceId }: { deviceId: string }) {
  const history = useQuery({
    queryKey: ['readings', deviceId],
    queryFn: () => api<ReadingView[]>(`/devices/${encodeURIComponent(deviceId)}/readings?limit=120`),
    refetchInterval: 10_000,
  });
  if (history.isPending) return <div className="skeleton" aria-label="Đang tải biểu đồ" />;
  if (history.isError) return <p role="alert">Không tải được lịch sử. <button onClick={() => void history.refetch()}>Thử lại</button></p>;

  const data = forecastChartPoints(history.data, Date.now());
  if (!data.some(point => point.temperature !== null && point.humidity !== null)) {
    return <p className="muted">Chưa có mẫu DHT11 hợp lệ, đồng bộ thời gian để vẽ biểu đồ.</p>;
  }
  return <div className="chart" role="img" aria-label="Biểu đồ tối đa 120 mẫu DHT11 đồng bộ và hợp lệ; mẫu lỗi được để trống">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: -15 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={55} />
        <YAxis yAxisId="temperature" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="humidity" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10 }} />
        <Legend />
        <Line yAxisId="temperature" type="linear" dataKey="temperature" name="Nhiệt độ (°C)" stroke="#f59e0b" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
        <Line yAxisId="humidity" type="linear" dataKey="humidity" name="Độ ẩm (%RH)" stroke="#38bdf8" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
