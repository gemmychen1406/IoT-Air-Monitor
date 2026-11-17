import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FileDown, Printer } from "lucide-react";
import type { AnalyticsView, DeviceView, IncidentView } from "@iot/contracts";
import { api } from "../../lib/api.js";
import { AdminAnalysisPanel } from "./AdminAnalysisPanel.js";
import { RangeFields } from "./RangeFields.js";
import {
  METRICS,
  METRIC_LABEL,
  type ReportData,
  type RangeInput,
  type SavedConfiguration,
} from "./types.js";
import {
  coverage,
  defaultRange,
  formatTime,
  formatValue,
  rangeParams,
} from "./utils.js";

function reportComment(data: AnalyticsView | undefined, range: RangeInput) {
  if (!data || !data.summary.valid_count)
    return "Chưa đủ dữ liệu hợp lệ để đánh giá khoảng thời gian này.";
  const quality = coverage(data, range);
  if (quality.percent !== null && quality.percent < 70)
    return "Dữ liệu chưa phủ đủ phần lớn khoảng đã chọn; kết luận chỉ mang tính tham khảo.";
  const values = data.series
    .map((point) => point.average)
    .filter((value): value is number => value !== null);
  if (values.length < 2) return "Chưa đủ điểm dữ liệu để nhận xét xu hướng.";
  const change = values.at(-1)! - values[0]!;
  if (Math.abs(change) < 0.01)
    return "Chỉ số nhìn chung ổn định trong các điểm dữ liệu đã ghi nhận.";
  return `Chỉ số có xu hướng ${change > 0 ? "tăng" : "giảm"} trong các điểm dữ liệu đã ghi nhận.`;
}

export function ReportBuilder({
  devices,
  isAdmin,
  initial,
  onSave,
}: {
  devices: DeviceView[];
  isAdmin: boolean;
  initial?: SavedConfiguration | null;
  onSave: (
    value: Omit<SavedConfiguration, "id" | "name" | "createdAt">,
  ) => void;
}) {
  const [deviceId, setDeviceId] = useState(() =>
    initial?.kind === "report" &&
    devices.some((device) => device.id === initial.deviceIds[0])
      ? initial.deviceIds[0]!
      : (devices[0]?.id ?? ""),
  );
  const [range, setRange] = useState<RangeInput>(() =>
    initial?.kind === "report" ? initial.range : defaultRange(),
  );
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    const device = devices.find((value) => value.id === deviceId);
    if (!device) return;
    setLoading(true);
    setError("");
    try {
      const params = rangeParams(range, "temperature_c");
      const [analytics, incidents] = await Promise.all([
        Promise.all(
          METRICS.map((metric) =>
            api<AnalyticsView>(
              `/devices/${deviceId}/analytics?${rangeParams(range, metric)}`,
            ),
          ),
        ),
        api<IncidentView[]>(
          `/alerts/incidents?device_id=${deviceId}&from=${encodeURIComponent(params.get("from")!)}&to=${encodeURIComponent(params.get("to")!)}&limit=100`,
        ),
      ]);
      setReport({
        generatedAt: new Date().toISOString(),
        device,
        range: { ...range },
        analytics: Object.fromEntries(
          METRICS.map((metric, index) => [metric, analytics[index]]),
        ),
        incidents,
        incidentsMayBeTruncated: incidents.length === 100,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không tạo được báo cáo.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="cr-section">
      <div className="panel cr-controls no-print">
        <label>
          Phòng/thiết bị
          <select
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            <option value="">Chọn thiết bị</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        <RangeFields value={range} onChange={setRange} />
        <div className="cr-actions">
          <button
            className="primary"
            disabled={!deviceId || loading}
            onClick={() => void generate()}
          >
            {loading ? "Đang tổng hợp…" : "Tạo báo cáo"}
          </button>
          <button
            disabled={!deviceId}
            onClick={() =>
              onSave({
                kind: "report",
                deviceIds: [deviceId],
                metric: "temperature_c",
                range,
                timeBasis: "received",
              })
            }
          >
            Lưu lựa chọn
          </button>
        </div>
      </div>
      {error ? (
        <p className="notice error" role="alert">
          {error} <button onClick={() => void generate()}>Thử lại</button>
        </p>
      ) : null}
      {!report && !loading ? (
        <p className="panel cr-empty">
          <FileDown /> Chọn thiết bị và khoảng thời gian để tạo báo cáo từ dữ
          liệu thật.
        </p>
      ) : null}
      {report ? (
        <article className="cr-report" aria-label="Báo cáo môi trường">
          <header>
            <div>
              <span>AIRGUARD</span>
              <h1>Báo cáo giám sát môi trường</h1>
            </div>
            <button className="primary no-print" onClick={() => window.print()}>
              <Printer size={17} /> Tải báo cáo PDF
            </button>
          </header>
          <div className="cr-report-meta">
            <p>
              <b>Thiết bị:</b> {report.device.name}
            </p>
            <p>
              <b>Vị trí:</b> {report.device.location || "Chưa cấu hình"}
            </p>
            <p>
              <b>Thời gian:</b>{" "}
              {formatTime(new Date(report.range.from).toISOString())} –{" "}
              {formatTime(new Date(report.range.to).toISOString())}
            </p>
            <p>
              <b>Tạo lúc:</b> {formatTime(report.generatedAt)} ·{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
            <p>
              <b>Nguồn:</b>{" "}
              {report.device.source_kind === "simulator"
                ? "Dữ liệu mô phỏng"
                : "Thiết bị thật"}
            </p>
          </div>
          <div className="cr-report-stats">
            {METRICS.map((metric) => {
              const data = report.analytics[metric];
              return (
                <section key={metric}>
                  <h3>{METRIC_LABEL[metric]}</h3>
                  <strong>
                    {formatValue(data?.summary.average ?? null, data?.unit)}
                  </strong>
                  <small>
                    Min {formatValue(data?.summary.min ?? null, data?.unit)} ·
                    Max {formatValue(data?.summary.max ?? null, data?.unit)}
                  </small>
                  <p>{reportComment(data, report.range)}</p>
                </section>
              );
            })}
          </div>
          <h2>Biểu đồ</h2>
          <div className="cr-report-charts">
            {METRICS.map((metric) => {
              const data = report.analytics[metric];
              return (
                <section key={metric}>
                  <h3>{METRIC_LABEL[metric]}</h3>
                  {data?.series.some((point) => point.average !== null) ? (
                    <ResponsiveContainer width="100%" height={190}>
                      <LineChart data={data.series}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="bucket_start"
                          tickFormatter={(value) =>
                            new Date(String(value)).toLocaleDateString("vi-VN")
                          }
                        />
                        <YAxis />
                        <Tooltip />
                        <Line
                          dataKey="average"
                          stroke="#118c75"
                          dot={false}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p>Không có dữ liệu hợp lệ.</p>
                  )}
                </section>
              );
            })}
          </div>
          <h2>Sự kiện nổi bật</h2>
          <p>
            {report.incidents.length
              ? `Ghi nhận ${report.incidents.length}${report.incidentsMayBeTruncated ? "+" : ""} sự cố trong phần dữ liệu API trả về.`
              : "Không ghi nhận sự cố trong phần dữ liệu API trả về."}
          </p>
          {report.incidentsMayBeTruncated ? (
            <p className="muted">
              API giới hạn 100 sự cố; báo cáo không khẳng định đây là toàn bộ
              lịch sử.
            </p>
          ) : null}
          {isAdmin ? (
            <section>
              <h2>Phân tích kỹ thuật</h2>
              {METRICS.map((metric) =>
                report.analytics[metric] ? (
                  <AdminAnalysisPanel
                    key={metric}
                    data={report.analytics[metric]!}
                    range={report.range}
                  />
                ) : null,
              )}
            </section>
          ) : null}
          <footer>
            MQ-2/MQ-7 là tín hiệu ADC chưa hiệu chuẩn, không phải ppm hoặc AQI.
            Báo cáo hỗ trợ giám sát, không xác nhận môi trường an toàn và không
            thay thế thiết bị an toàn chuyên dụng.
          </footer>
        </article>
      ) : null}
    </section>
  );
}
