import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
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
import type { AnalyticsView, DeviceView, ReadingView, Stats } from '@iot/contracts';
import { api, apiPage, downloadCsv } from '../lib/api.js';
import { plotSeries } from '../lib/analytics.js';
import { PageTitle, LoadState, dateText } from '../components/FeatureUI.js';

function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function initialRange() {
  const now = new Date();
  return {
    from: localInput(new Date(now.getTime() - 3600000)),
    to: localInput(new Date(now.getTime() + 60000)),
    metric: 'temperature_c',
    bucket: 'hour' as 'minute' | 'hour' | 'day',
    time_basis: 'sampled',
    compare: true,
    adc_bits: '',
  };
}
const numberText = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
function Summary({ stats, unit }: { stats: Stats; unit: string }) {
  return (
    <div className="stats-grid">
      {[
        ['Nhỏ nhất', stats.min],
        ['Lớn nhất', stats.max],
        ['Trung bình', stats.average],
        ['Mẫu hợp lệ', stats.valid_count],
      ].map(([title, value]) => (
        <article className="panel stat-card" key={String(title)}>
          <span>{title}</span>
          <strong>{numberText(value as number | null)}</strong>
          <small>
            {title === 'Mẫu hợp lệ'
              ? `${stats.invalid_count} mẫu lỗi/không đủ điều kiện · ${stats.total_count} tổng mẫu`
              : unit}
          </small>
        </article>
      ))}
    </div>
  );
}
export default function AnalyticsPage({ devices }: { devices: DeviceView[] }) {
  const [deviceId, setDeviceId] = useState('');
  const [draft, setDraft] = useState(initialRange);
  const [filters, setFilters] = useState(initialRange);
  const selected = devices.find((d) => d.id === deviceId) ?? devices[0];
  const range = new URLSearchParams({
    from: new Date(filters.from).toISOString(),
    to: new Date(filters.to).toISOString(),
    time_basis: filters.time_basis,
  });
  const analyticsParams = new URLSearchParams(range);
  analyticsParams.set('metric', filters.metric);
  analyticsParams.set('bucket', filters.bucket);
  if (filters.compare) analyticsParams.set('compare', 'previous');
  if (filters.adc_bits && filters.metric.endsWith('_adc'))
    analyticsParams.set('adc_bits', filters.adc_bits);
  const analytics = useQuery({
    queryKey: ['analytics', selected?.id, analyticsParams.toString()],
    queryFn: () => api<AnalyticsView>(`/devices/${selected!.id}/analytics?${analyticsParams}`),
    enabled: !!selected,
  });
  const history = useInfiniteQuery({
    queryKey: ['history', selected?.id, range.toString()],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<ReadingView[]>(
        `/devices/${selected!.id}/readings?${range}&limit=100${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    enabled: !!selected,
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
  });
  const csv = useMutation({
    mutationFn: () =>
      downloadCsv(
        `/devices/${selected!.id}/readings/export?${range}`,
        `readings-${selected!.id}.csv`,
      ),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft });
  }
  const result = analytics.data;
  return (
    <>
      <PageTitle eyebrow="HISTORICAL ANALYTICS" title="Analytics & lịch sử">
        <p>
          Thống kê mẫu đủ điều kiện, lọc thời gian và xuất dữ liệu thực tế. Khoảng thời gian [từ,
          đến) tối đa 90 ngày.
        </p>
      </PageTitle>
      {!selected ? (
        <div className="panel empty">Chưa có thiết bị để phân tích.</div>
      ) : (
        <>
          <form className="panel filter-grid" onSubmit={submit}>
            <label>
              Thiết bị
              <select value={selected.id} onChange={(e) => setDeviceId(e.target.value)}>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.source_kind === 'simulator' ? ' · Mô phỏng' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Từ thời điểm
              <input
                type="datetime-local"
                required
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </label>
            <label>
              Đến thời điểm
              <input
                type="datetime-local"
                required
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </label>
            <label>
              Cơ sở thời gian
              <select
                value={draft.time_basis}
                onChange={(e) => setDraft({ ...draft, time_basis: e.target.value })}
              >
                <option value="sampled">Thời điểm đo đã đồng bộ</option>
                <option value="received">Thời điểm server nhận</option>
              </select>
            </label>
            <label>
              Đại lượng
              <select
                value={draft.metric}
                onChange={(e) => setDraft({ ...draft, metric: e.target.value })}
              >
                <option value="temperature_c">Nhiệt độ (°C)</option>
                <option value="humidity_pct">Độ ẩm (%RH)</option>
                <option value="mq2_adc">MQ-2 ADC thô</option>
                <option value="mq7_adc">MQ-7 ADC thô</option>
              </select>
            </label>
            <label>
              Độ rộng bucket
              <select
                value={draft.bucket}
                onChange={(e) =>
                  setDraft({ ...draft, bucket: e.target.value as typeof draft.bucket })
                }
              >
                <option value="minute">1 phút</option>
                <option value="hour">1 giờ</option>
                <option value="day">1 ngày UTC</option>
              </select>
            </label>
            {draft.metric.endsWith('_adc') ? (
              <label>
                Lọc độ phân giải ADC (bit)
                <input
                  type="number"
                  min={8}
                  max={16}
                  value={draft.adc_bits}
                  placeholder="Tự kiểm tra tương thích"
                  onChange={(e) => setDraft({ ...draft, adc_bits: e.target.value })}
                />
              </label>
            ) : null}
            <label className="check-label">
              <input
                type="checkbox"
                checked={draft.compare}
                onChange={(e) => setDraft({ ...draft, compare: e.target.checked })}
              />
              So sánh kỳ trước cùng độ dài
            </label>
            <button className="primary">Áp dụng bộ lọc</button>
          </form>
          {selected.source_kind === 'simulator' ? (
            <div className="notice simulation">Dữ liệu mô phỏng — không phải số đo phần cứng.</div>
          ) : null}
          <div className="button-row">
            <button onClick={() => csv.mutate()} disabled={csv.isPending}>
              {csv.isPending ? 'Đang xuất…' : 'Xuất CSV'}
            </button>
            <button
              onClick={() => {
                void analytics.refetch();
                void history.refetch();
              }}
            >
              Tải lại dữ liệu
            </button>
          </div>
          <LoadState error={csv.error} />
          {csv.isSuccess ? (
            <p role="status" className="caption">
              Đã tạo file CSV.
            </p>
          ) : null}
          <LoadState
            pending={analytics.isPending}
            error={analytics.error}
            retry={() => void analytics.refetch()}
          />
          {result ? (
            <>
              {result.uses_rollups ? (
                <p className="notice" role="status">
                  Khoảng này kết hợp raw còn lưu và dữ liệu đã tổng hợp. CSV raw có thể không còn
                  đầy đủ; không thể khôi phục từng mẫu từ rollup.
                </p>
              ) : null}
              <div className="section-heading">
                <h2>Thống kê kỳ đang chọn</h2>
                <span className="badge">
                  {result.unit}
                  {result.adc_bits ? ` · ${result.adc_bits} bit` : ''}
                </span>
              </div>
              <Summary stats={result.summary} unit={result.unit} />
              {result.previous ? (
                <section className="panel feature-section">
                  <h2>So sánh kỳ trước</h2>
                  <p className="caption">
                    {dateText(result.previous.from)} → {dateText(result.previous.to)}
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Kỳ</th>
                          <th>Min</th>
                          <th>Max</th>
                          <th>Average ({result.unit})</th>
                          <th>Mẫu hợp lệ</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Đang chọn</td>
                          <td>{numberText(result.summary.min)}</td>
                          <td>{numberText(result.summary.max)}</td>
                          <td>{numberText(result.summary.average)}</td>
                          <td>{result.summary.valid_count}</td>
                        </tr>
                        <tr>
                          <td>Kỳ trước</td>
                          <td>{numberText(result.previous.summary.min)}</td>
                          <td>{numberText(result.previous.summary.max)}</td>
                          <td>{numberText(result.previous.summary.average)}</td>
                          <td>{result.previous.summary.valid_count}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
              <section className="panel chart-panel">
                <h2>Diễn biến theo bucket ({result.unit})</h2>
                <div
                  className="chart"
                  role="img"
                  aria-label="Biểu đồ analytics có khoảng trống khi thiếu dữ liệu"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={plotSeries(result, filters.bucket)}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="time" minTickGap={60} tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                        }}
                      />
                      <Legend />
                      <Line
                        dataKey="average"
                        name="Average"
                        type="linear"
                        stroke="#2dd4bf"
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="min"
                        name="Min"
                        type="linear"
                        stroke="#38bdf8"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="max"
                        name="Max"
                        type="linear"
                        stroke="#f59e0b"
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="caption">
                  Mẫu invalid/warming_up/heating không được tính vào thống kê. Khoảng không có mẫu
                  là gap, không phải giá trị 0. Bucket theo UTC.
                </p>
              </section>
            </>
          ) : null}
          <section className="panel feature-section">
            <h2>Lịch sử bản ghi</h2>
            <p className="caption">
              Thứ tự server nhận giảm dần; gồm cả mẫu lỗi để đối soát. CSV xuất tất cả sensor theo
              cùng bộ lọc thời gian, tối đa 100.000 dòng.
            </p>
            <LoadState
              pending={history.isPending}
              error={history.error}
              retry={() => void history.refetch()}
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Thời điểm đo</th>
                    <th>Server nhận</th>
                    <th>°C</th>
                    <th>%RH</th>
                    <th>DHT quality</th>
                    <th>MQ-2 ADC</th>
                    <th>MQ-7 ADC</th>
                    <th>Gas quality</th>
                    <th>Flame</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data?.pages
                    .flatMap((p) => p.data)
                    .map((r) => (
                      <tr key={r.id}>
                        <td>{dateText(r.payload.sampled_at)}</td>
                        <td>{dateText(r.received_at)}</td>
                        <td>{numberText(r.payload.sensors.dht11.temperature_c)}</td>
                        <td>{numberText(r.payload.sensors.dht11.humidity_pct)}</td>
                        <td>{r.payload.sensors.dht11.quality}</td>
                        <td>{numberText(r.payload.sensors.mq2.adc_raw)}</td>
                        <td>{numberText(r.payload.sensors.mq7.adc_raw)}</td>
                        <td>
                          {r.payload.sensors.mq2.quality} / {r.payload.sensors.mq7.quality}
                        </td>
                        <td>
                          {r.payload.sensors.flame.detected === null
                            ? '—'
                            : r.payload.sensors.flame.detected
                              ? 'Phát hiện'
                              : 'Không phát hiện'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {history.data?.pages.every((p) => !p.data.length) ? (
              <div className="empty">Không có bản ghi trong khoảng đã chọn.</div>
            ) : null}
            {history.hasNextPage ? (
              <button
                className="load-more"
                onClick={() => void history.fetchNextPage()}
                disabled={history.isFetchingNextPage}
              >
                Tải thêm bản ghi
              </button>
            ) : null}
          </section>
          <p className="notice">
            MQ-2/MQ-7 chỉ thống kê tín hiệu ADC; không phải PPM/AQI. Lọc adc_bits chỉ áp dụng thống
            kê ADC. Mẫu chưa đồng bộ giờ không xuất hiện khi lọc theo thời điểm đo.
          </p>
        </>
      )}
    </>
  );
}
