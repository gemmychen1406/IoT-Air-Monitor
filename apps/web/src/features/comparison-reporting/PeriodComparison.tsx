import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsView, DeviceView } from "@iot/contracts";
import { api } from "../../lib/api.js";
import { AdminAnalysisPanel } from "./AdminAnalysisPanel.js";
import { RangeFields } from "./RangeFields.js";
import {
  METRICS,
  METRIC_LABEL,
  type Metric,
  type RangeInput,
  type SavedConfiguration,
} from "./types.js";
import {
  defaultRange,
  delta,
  formatValue,
  friendlyConclusion,
  previousRange,
  rangeParams,
} from "./utils.js";

export function PeriodComparison({
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
  const initialRange =
    initial?.kind === "period" ? initial.range : defaultRange();
  const [deviceId, setDeviceId] = useState(() =>
    initial?.kind === "period" &&
    devices.some((device) => device.id === initial.deviceIds[0])
      ? initial.deviceIds[0]!
      : (devices[0]?.id ?? ""),
  );
  const [metric, setMetric] = useState<Metric>(() =>
    initial?.kind === "period" ? initial.metric : "temperature_c",
  );
  const [rangeB, setRangeB] = useState<RangeInput>(initialRange);
  const [rangeA, setRangeA] = useState<RangeInput>(() =>
    previousRange(initialRange),
  );
  const [submitted, setSubmitted] = useState<{
    deviceId: string;
    metric: Metric;
    ranges: [RangeInput, RangeInput];
  } | null>(null);
  const queries = useQueries({
    queries: (submitted?.ranges ?? []).map((range, index) => ({
      queryKey: [
        "comparison-reporting",
        "period",
        submitted!.deviceId,
        submitted!.metric,
        index,
        range,
      ],
      queryFn: () =>
        api<AnalyticsView>(
          `/devices/${submitted!.deviceId}/analytics?${rangeParams(range, submitted!.metric)}`,
        ),
      retry: false,
    })),
  });
  const first = queries[0]?.data;
  const second = queries[1]?.data;
  const change = first && second ? delta(first.summary, second.summary) : null;
  function quickPrevious() {
    setRangeA(previousRange(rangeB));
  }
  function run() {
    try {
      rangeParams(rangeA, metric);
      rangeParams(rangeB, metric);
      setSubmitted({
        deviceId,
        metric,
        ranges: [{ ...rangeA }, { ...rangeB }],
      });
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Khoảng thời gian không hợp lệ.",
      );
    }
  }
  return (
    <section className="cr-section">
      <div className="panel cr-controls">
        <label>
          1. Phòng/thiết bị
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
        <div>
          <h3>Giai đoạn A (trước)</h3>
          <RangeFields value={rangeA} onChange={setRangeA} />
        </div>
        <div>
          <h3>Giai đoạn B (sau)</h3>
          <RangeFields value={rangeB} onChange={setRangeB} />
        </div>
        <div className="cr-actions">
          <button onClick={quickPrevious}>A = giai đoạn ngay trước B</button>
          <button className="primary" disabled={!deviceId} onClick={run}>
            So sánh hai giai đoạn
          </button>
          <button
            disabled={!deviceId}
            onClick={() =>
              onSave({
                kind: "period",
                deviceIds: [deviceId],
                metric,
                range: rangeB,
                timeBasis: "received",
              })
            }
          >
            Lưu lựa chọn
          </button>
        </div>
      </div>
      {queries.some((query) => query.isPending) ? (
        <div className="skeleton" role="status" />
      ) : null}
      {queries.find((query) => query.isError) ? (
        <p className="notice error" role="alert">
          Không tải được dữ liệu:{" "}
          {queries.find((query) => query.error)?.error?.message}
        </p>
      ) : null}
      {first && second && submitted ? (
        <>
          <div className="panel cr-chart">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={[
                  { name: "Giai đoạn A", value: first.summary.average },
                  { name: "Giai đoạn B", value: second.summary.average },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar
                  name={`${METRIC_LABEL[metric]} (${second.unit})`}
                  dataKey="value"
                  fill="#17b897"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="cr-summary-grid">
            <article className="panel">
              <h3>Giai đoạn A</h3>
              <strong>{formatValue(first.summary.average, first.unit)}</strong>
              <p>{first.summary.valid_count} mẫu hợp lệ</p>
            </article>
            <article className="panel">
              <h3>Giai đoạn B</h3>
              <strong>
                {formatValue(second.summary.average, second.unit)}
              </strong>
              <p>{second.summary.valid_count} mẫu hợp lệ</p>
            </article>
            <article className="panel">
              <h3>Thay đổi</h3>
              <strong>
                {change?.absolute === null
                  ? "Chưa tính được"
                  : formatValue(change!.absolute, second.unit)}
              </strong>
              <p>
                {change?.percent === null
                  ? "Không tính phần trăm khi mốc A bằng 0 hoặc thiếu dữ liệu"
                  : `${change!.percent.toFixed(1)}%`}
              </p>
            </article>
          </div>
          <p className="notice">
            {friendlyConclusion(
              METRIC_LABEL[metric],
              first.summary,
              second.summary,
            )}
          </p>
          {Date.parse(rangeA.to) - Date.parse(rangeA.from) !==
          Date.parse(rangeB.to) - Date.parse(rangeB.from) ? (
            <p className="notice error">
              Hai giai đoạn dài khác nhau; hãy thận trọng khi diễn giải kết quả.
            </p>
          ) : null}
          {isAdmin ? (
            <div className="cr-admin-pair">
              <AdminAnalysisPanel data={first} range={submitted.ranges[0]} />
              <AdminAnalysisPanel data={second} range={submitted.ranges[1]} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
