import { useState } from "react";
import { FileDown, Printer } from "lucide-react";
import type { AnalyticsView, DeviceView, IncidentView } from "@iot/contracts";
import { api, apiPage } from "../../lib/api.js";
import { AdminAnalysisPanel } from "./AdminAnalysisPanel.js";
import { RangeFields } from "./RangeFields.js";
import { ReportChart } from "./ReportChart.js";
import { reportComment, reportHasData } from "./report-utils.js";
import { buildSummary } from "./summary.js";
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

async function loadIncidents(basePath: string) {
  const incidents: IncidentView[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = await apiPage<IncidentView[]>(
      `${basePath}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    incidents.push(...page.data);
    cursor = page.meta.next_cursor ?? undefined;
    if (!cursor) return { incidents, complete: true };
  }
  return { incidents, complete: false };
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
      const [analytics, incidentResult] = await Promise.all([
        Promise.all(
          METRICS.map((metric) =>
            api<AnalyticsView>(
              `/devices/${deviceId}/analytics?${rangeParams(range, metric)}`,
            ),
          ),
        ),
        loadIncidents(
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
        incidents: incidentResult.incidents,
        incidentsComplete: incidentResult.complete,
      });
      if (!reportHasData(analytics))
        setError(
          "Khoảng thời gian đã chọn không có mẫu cảm biến hợp lệ. Báo cáo vẫn hiển thị để kiểm tra chất lượng dữ liệu.",
        );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không tạo được báo cáo.",
      );
    } finally {
      setLoading(false);
    }
  }
  const summary = report ? buildSummary(report) : null;
  const bucketWord = { minute: "phút", hour: "giờ", day: "ngày" };
  async function printReport() {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    window.print();
  }
  return (
    <section className="cr-section">
      <div className="panel cr-controls no-print">
        <div className="cr-device-row">
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
        </div>
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
            <button
              className="primary no-print"
              onClick={() => void printReport()}
            >
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
              <b>Bắt đầu:</b>{" "}
              {formatTime(new Date(report.range.from).toISOString())}
            </p>
            <p>
              <b>Kết thúc:</b>{" "}
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
          {summary ? (
            <section
              className={`cr-report-summary tone-${summary.tone}`}
              aria-label="Tóm tắt dễ hiểu"
            >
              <h2>Tóm tắt dễ hiểu</h2>
              <p className="cr-summary-headline">{summary.headline}</p>
              <dl>
                {summary.items.map((item) => (
                  <div key={item.id} className={`tone-${item.tone}`}>
                    <dt>{item.title}</dt>
                    <dd>{item.text}</dd>
                  </div>
                ))}
              </dl>
              <h3>Gợi ý</h3>
              <ul>
                {summary.advice.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <h2>Chi tiết từng chỉ số</h2>
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
                    Max {formatValue(data?.summary.max ?? null, data?.unit)} ·{" "}
                    {data?.summary.valid_count ?? 0} mẫu hợp lệ
                  </small>
                  <p>{reportComment(metric, data, report.range)}</p>
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
                    <ReportChart data={data} />
                  ) : (
                    <p>Không có dữ liệu hợp lệ.</p>
                  )}
                </section>
              );
            })}
          </div>
          <section className="cr-report-quality">
            <h2>Chất lượng dữ liệu</h2>
            <p className="muted">
              Báo cáo chia thời gian thành từng{" "}
              {bucketWord[report.range.bucket]}. “Khoảng có dữ liệu” là số{" "}
              {bucketWord[report.range.bucket]} mà thiết bị gửi được ít nhất một
              số đo hợp lệ.
            </p>
            <div className="cr-quality-grid">
              {METRICS.map((metric) => {
                const data = report.analytics[metric];
                const quality = coverage(data, report.range);
                return (
                  <div key={metric}>
                    <b>{METRIC_LABEL[metric]}</b>
                    <span>Số đo hợp lệ: {data?.summary.valid_count ?? 0}</span>
                    <span>
                      Số đo bị loại: {data?.summary.invalid_count ?? 0}
                    </span>
                    <span>
                      Khoảng có dữ liệu: {quality.present}/{quality.expected} ·
                      thiếu {quality.missing}
                    </span>
                    <span>
                      Tỷ lệ có dữ liệu:{" "}
                      {quality.percent === null
                        ? "Không xác định"
                        : `${quality.percent.toFixed(1)}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="cr-incidents">
            <h2>Sự kiện nổi bật</h2>
            <p>
              {report.incidents.length
                ? `Ghi nhận ${report.incidents.length}${report.incidentsComplete ? "" : "+"} sự cố trong dữ liệu truy xuất.`
                : "Không ghi nhận sự cố trong phần dữ liệu API trả về."}
            </p>
            {report.incidents.length ? (
              <div className="cr-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Loại</th>
                      <th>Thời điểm</th>
                      <th>Mức độ</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.incidents.map((incident) => (
                      <tr key={incident.id}>
                        <td>{incident.condition.toUpperCase()}</td>
                        <td>
                          {formatTime(
                            incident.started_at ?? incident.first_observed_at,
                          )}
                        </td>
                        <td>
                          {incident.severity === "critical"
                            ? "Nghiêm trọng"
                            : "Cảnh báo"}
                        </td>
                        <td>
                          {incident.status === "active"
                            ? "Đang diễn ra"
                            : "Đã kết thúc"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {!report.incidentsComplete ? (
              <p className="muted">
                Đã đạt giới hạn an toàn 1.000 sự cố; báo cáo không khẳng định
                đây là toàn bộ lịch sử.
              </p>
            ) : null}
          </section>
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
