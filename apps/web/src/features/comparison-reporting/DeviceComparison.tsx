import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
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
  adcCompatibility,
  alignSeries,
  defaultRange,
  formatValue,
  friendlyConclusion,
  rangeParams,
} from "./utils.js";

const COLORS = ["#17b897", "#6c8cff", "#f59e0b", "#ec4899"];

export function DeviceComparison({
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
  const [selected, setSelected] = useState<string[]>(() =>
    initial?.kind === "devices"
      ? initial.deviceIds
          .filter((id) => devices.some((device) => device.id === id))
          .slice(0, 4)
      : devices.slice(0, 2).map((device) => device.id),
  );
  const [metric, setMetric] = useState<Metric>(() =>
    initial?.kind === "devices" ? initial.metric : "temperature_c",
  );
  const [range, setRange] = useState<RangeInput>(() =>
    initial?.kind === "devices" ? initial.range : defaultRange(),
  );
  const [submitted, setSubmitted] = useState<{
    selected: string[];
    metric: Metric;
    range: RangeInput;
  } | null>(null);
  const queries = useQueries({
    queries: (submitted?.selected ?? []).map((id) => ({
      queryKey: [
        "comparison-reporting",
        "devices",
        id,
        submitted!.metric,
        submitted!.range,
      ],
      queryFn: () =>
        api<AnalyticsView>(
          `/devices/${id}/analytics?${rangeParams(submitted!.range, submitted!.metric)}`,
        ),
      retry: false,
    })),
  });
  const rows = useMemo(
    () =>
      alignSeries(
        (submitted?.selected ?? []).map((id, index) => ({
          id,
          data: queries[index]?.data,
        })),
      ),
    [submitted, queries],
  );
  const incompatible = submitted
    ? adcCompatibility(
        submitted.metric,
        queries.map((query) => query.data),
      )
    : null;
  const ready = !!submitted && !queries.some((query) => query.isPending);
  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < 4
          ? [...current, id]
          : current,
    );
  }
  function run() {
    try {
      rangeParams(range, metric);
      setSubmitted({ selected: [...selected], metric, range: { ...range } });
    } catch (error) {
      setSubmitted(null);
      window.alert(
        error instanceof Error
          ? error.message
          : "Khoảng thời gian không hợp lệ.",
      );
    }
  }
  const first = queries[0]?.data;
  const second = queries[1]?.data;
  return (
    <section className="cr-section">
      <div className="panel cr-controls">
        <fieldset>
          <legend>1. Chọn từ 2 đến 4 phòng/thiết bị</legend>
          <div className="cr-checks">
            {devices.map((device) => (
              <label key={device.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(device.id)}
                  disabled={
                    !selected.includes(device.id) && selected.length === 4
                  }
                  onChange={() => toggle(device.id)}
                />{" "}
                {device.name}{" "}
                <small>
                  (
                  {device.source_kind === "simulator"
                    ? "mô phỏng"
                    : "thiết bị thật"}
                  )
                </small>
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          2. Chọn chỉ số
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
        <div className="cr-actions">
          <button
            className="primary"
            disabled={selected.length < 2}
            onClick={run}
          >
            Xem kết quả
          </button>
          <button
            disabled={selected.length < 2}
            onClick={() =>
              onSave({
                kind: "devices",
                deviceIds: selected,
                metric,
                range,
                timeBasis: "received",
              })
            }
          >
            Lưu lựa chọn
          </button>
        </div>
      </div>
      {queries.some((query) => query.isPending) ? (
        <div
          className="skeleton"
          role="status"
          aria-label="Đang tải dữ liệu so sánh"
        />
      ) : null}
      {queries.find((query) => query.isError) ? (
        <p className="notice error" role="alert">
          Không tải được dữ liệu:{" "}
          {queries.find((query) => query.error)?.error?.message}
        </p>
      ) : null}
      {ready && incompatible ? (
        <p className="notice error" role="alert">
          {incompatible}
        </p>
      ) : null}
      {ready && !incompatible ? (
        <>
          {rows.length ? (
            <div
              className="panel cr-chart"
              aria-label="Biểu đồ so sánh thiết bị"
            >
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="bucket_start"
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
                    labelFormatter={(value) =>
                      new Date(String(value)).toLocaleString("vi-VN")
                    }
                  />
                  <Legend />
                  {submitted!.selected.map((id, index) => (
                    <Line
                      key={id}
                      dataKey={id}
                      name={
                        devices.find((device) => device.id === id)?.name ?? id
                      }
                      stroke={COLORS[index]}
                      dot={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="panel cr-empty">
              Không có điểm dữ liệu hợp lệ trong khoảng đã chọn. Dữ liệu thiếu
              không được đổi thành 0.
            </p>
          )}
          <div className="cr-summary-grid">
            {submitted!.selected.map((id, index) => {
              const data = queries[index]?.data;
              const device = devices.find((value) => value.id === id);
              return (
                <article className="panel" key={id}>
                  <h3>{device?.name}</h3>
                  <strong>
                    {formatValue(data?.summary.average ?? null, data?.unit)}
                  </strong>
                  <p>
                    Min {formatValue(data?.summary.min ?? null, data?.unit)} ·
                    Max {formatValue(data?.summary.max ?? null, data?.unit)}
                  </p>
                  <small>{data?.summary.valid_count ?? 0} mẫu hợp lệ</small>
                  {isAdmin && data ? (
                    <AdminAnalysisPanel data={data} range={submitted!.range} />
                  ) : null}
                </article>
              );
            })}
          </div>
          {first && second ? (
            <p className="notice">
              {friendlyConclusion(
                METRIC_LABEL[submitted!.metric],
                first.summary,
                second.summary,
                devices.find((d) => d.id === submitted!.selected[0])?.name,
                devices.find((d) => d.id === submitted!.selected[1])?.name,
              )}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
