import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsView, DeviceView } from "@iot/contracts";
import { api } from "../../lib/api.js";
import { RAW_ADC_NOTICE } from "../../lib/sensor-display.js";
import { AdminAnalysisPanel } from "./AdminAnalysisPanel.js";
import { RangeFields } from "./RangeFields.js";
import { detectAnomalies, MIN_POINTS, SENSITIVITY_OPTIONS } from "./anomaly.js";
import {
  METRICS,
  METRIC_LABEL,
  type Metric,
  type RangeInput,
} from "./types.js";
import {
  coverage,
  defaultRange,
  formatTime,
  formatValue,
  rangeParams,
} from "./utils.js";

export function AnomalyDetection({
  devices,
  isAdmin,
}: {
  devices: DeviceView[];
  isAdmin: boolean;
}) {
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [metric, setMetric] = useState<Metric>("temperature_c");
  const [range, setRange] = useState<RangeInput>(() => defaultRange());
  const [threshold, setThreshold] = useState<number>(3.5);
  const [submitted, setSubmitted] = useState<{
    deviceId: string;
    metric: Metric;
    range: RangeInput;
  } | null>(null);
  const [formError, setFormError] = useState("");
  const query = useQuery({
    enabled: !!submitted,
    queryKey: ["comparison-reporting", "anomaly", submitted],
    queryFn: () =>
      api<AnalyticsView>(
        `/devices/${submitted!.deviceId}/analytics?${rangeParams(submitted!.range, submitted!.metric)}`,
      ),
    retry: false,
  });
  const data = query.data;
  const result = useMemo(
    () => detectAnomalies(data?.series, threshold),
    [data, threshold],
  );
  const rows = useMemo(() => {
    const flagged = new Map(
      result.points.map((p) => [p.bucket_start, p.value]),
    );
    return (data?.series ?? []).map((point) => ({
      bucket_start: point.bucket_start,
      value: point.valid_count > 0 ? point.average : null,
      anomaly: flagged.get(point.bucket_start) ?? null,
    }));
  }, [data, result]);
  function run() {
    try {
      rangeParams(range, metric);
      setFormError("");
      setSubmitted({ deviceId, metric, range: { ...range } });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Khoảng thời gian không hợp lệ.",
      );
    }
  }
  const quality = data && submitted ? coverage(data, submitted.range) : null;
  return (
    <section className="cr-section">
      <p className="notice">
        Tab này tìm các thời điểm <b>lệch xa mức thường thấy</b> của chính thiết
        bị. Khác với trang Cảnh báo &amp; sự cố (báo khi vượt ngưỡng an toàn),
        một điểm bất thường ở đây chưa chắc là nguy hiểm.
      </p>
      <div className="panel cr-controls">
        <label>
          1. Phòng/thiết bị
          <select
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          2. Chỉ số
          <select
            value={metric}
            onChange={(event) => setMetric(event.target.value as Metric)}
          >
            {METRICS.map((value) => (
              <option key={value} value={value}>
                {METRIC_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <RangeFields value={range} onChange={setRange} />
        <label>
          3. Độ nhạy
          <select
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          >
            {SENSITIVITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="cr-actions">
          <button
            className="primary"
            disabled={!deviceId || query.isFetching}
            onClick={run}
          >
            {query.isFetching ? "Đang phân tích…" : "Tìm điểm bất thường"}
          </button>
        </div>
      </div>
      {formError ? (
        <p className="notice error" role="alert">
          {formError}
        </p>
      ) : null}
      {query.isError ? (
        <p className="notice error" role="alert">
          Không tải được dữ liệu: {query.error.message}
        </p>
      ) : null}
      {query.isFetching && !data ? (
        <div className="skeleton" role="status" aria-label="Đang phân tích" />
      ) : null}
      {data && submitted && !query.isError ? (
        <>
          {result.status === "insufficient" ? (
            <p className="panel cr-empty">
              Chỉ có {result.validPoints} điểm dữ liệu hợp lệ; cần ít nhất{" "}
              {MIN_POINTS} điểm để đánh giá. Hãy mở rộng khoảng thời gian hoặc
              chọn độ chi tiết nhỏ hơn.
            </p>
          ) : (
            <>
              <div
                className="panel cr-chart"
                aria-label="Biểu đồ điểm bất thường"
              >
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="bucket_start"
                      minTickGap={24}
                      tickFormatter={(value) =>
                        new Date(String(value)).toLocaleString("vi-VN", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                        })
                      }
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(value) => formatTime(String(value))}
                    />
                    <Legend />
                    <Line
                      name={METRIC_LABEL[submitted.metric]}
                      dataKey="value"
                      stroke="#17b897"
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      name="Điểm bất thường"
                      dataKey="anomaly"
                      stroke="none"
                      dot={{ r: 5, fill: "#dc2626", stroke: "#dc2626" }}
                      activeDot={{ r: 7 }}
                      legendType="circle"
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="cr-summary-grid">
                <article className="panel">
                  <h3>Điểm bất thường</h3>
                  <strong>{result.points.length}</strong>
                  <p>trên {result.validPoints} điểm dữ liệu hợp lệ</p>
                </article>
                <article className="panel">
                  <h3>Mức thường thấy (trung vị)</h3>
                  <strong>{formatValue(result.median, data.unit)}</strong>
                  <p>dùng trung vị để ít bị ảnh hưởng bởi điểm lệch</p>
                </article>
                <article className="panel">
                  <h3>Độ phủ dữ liệu</h3>
                  <strong>
                    {quality?.percent == null
                      ? "Không xác định"
                      : `${quality.percent.toFixed(1)}%`}
                  </strong>
                  <p>
                    {quality && quality.percent !== null && quality.percent < 70
                      ? "Thấp: kết quả chỉ mang tính tham khảo."
                      : "Tỷ lệ bucket có mẫu hợp lệ."}
                  </p>
                </article>
              </div>
              <p className="notice">
                {result.status === "flat"
                  ? "Dữ liệu gần như không đổi trong khoảng này nên không có điểm bất thường."
                  : result.points.length
                    ? "Các điểm đỏ lệch xa mức thường thấy của chính chuỗi này. Đây là mô tả thống kê; chưa xác định nguyên nhân (có thể do hoạt động thực tế, cảm biến đang làm nóng hoặc nhiễu)."
                    : "Không có điểm nào lệch xa mức thường thấy ở độ nhạy đã chọn."}
                {submitted.metric.endsWith("_adc") ? ` ${RAW_ADC_NOTICE}` : ""}
              </p>
              {result.points.length ? (
                <div className="panel cr-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Thời điểm</th>
                        <th>Giá trị</th>
                        <th>Hướng lệch</th>
                        <th>Điểm lệch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.points.map((point) => (
                        <tr key={point.bucket_start}>
                          <td>{formatTime(point.bucket_start)}</td>
                          <td>{formatValue(point.value, data.unit)}</td>
                          <td>
                            {point.direction === "high"
                              ? "Cao hơn"
                              : "Thấp hơn"}
                          </td>
                          <td>{Math.abs(point.score).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
          {isAdmin ? (
            <AdminAnalysisPanel data={data} range={submitted.range} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
