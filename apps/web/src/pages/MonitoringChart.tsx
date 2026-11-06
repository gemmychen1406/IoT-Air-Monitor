import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import type { ReadingView } from '@iot/contracts';
import { api } from '../lib/api.js';

export default function MonitoringChart({ deviceId }: { deviceId: string }) {
  const history = useQuery({
    queryKey: ['readings', deviceId],
    queryFn: () => api<ReadingView[]>(`/devices/${deviceId}/readings?limit=120`),
    refetchInterval: 10000,
  });
  if (history.isPending) return <div className="skeleton" aria-label="Đang tải biểu đồ" />;
  if (history.isError)
    return (
      <p role="alert">
        Không tải được lịch sử. <button onClick={() => void history.refetch()}>Thử lại</button>
      </p>
    );
  if (!history.data.length) return <p className="muted">Chưa có mẫu để vẽ biểu đồ.</p>;
  const data = [...history.data]
    .sort(
      (a, b) =>
        Date.parse(a.payload.sampled_at ?? a.received_at) -
        Date.parse(b.payload.sampled_at ?? b.received_at),
    )
    .map((r) => ({
      time: new Date(r.payload.sampled_at ?? r.received_at).toLocaleTimeString('vi-VN'),
      temperature: r.payload.sensors.dht11.temperature_c,
      humidity: r.payload.sensors.dht11.humidity_pct,
    }));
  return (
    <>
      <div
        className="chart"
        role="img"
        aria-label="Biểu đồ nhiệt độ và độ ẩm từ tối đa 120 bản ghi gần nhận nhất"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: -15 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={55} />
            <YAxis yAxisId="temperature" tick={{ fontSize: 11 }} />
            <YAxis
              yAxisId="humidity"
              orientation="right"
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 10,
              }}
            />
            <Legend />
            <Line
              yAxisId="temperature"
              type="linear"
              dataKey="temperature"
              name="Nhiệt độ (°C)"
              stroke="#f59e0b"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              yAxisId="humidity"
              type="linear"
              dataKey="humidity"
              name="Độ ẩm (%RH)"
              stroke="#38bdf8"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="caption">
        Thời điểm đo nếu đã đồng bộ; mẫu chưa đồng bộ dùng thời điểm server nhận. Khoảng trống biểu
        thị dữ liệu thiếu.
      </p>
    </>
  );
}
