import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import {
  diagnosticOptionsSchema,
  type DiagnosticSummaryRow,
  type DiagnosticOptions,
  type DiagnosticReport,
} from "@iot/contracts";
import { api } from "../../lib/api.js";
import { LoadState } from "../../components/FeatureUI.js";
import {
  QualityTab,
  EventsTab,
  ConnectionTab,
  ClockTab,
  SessionsTab,
} from "./ReportTabs.js";
import { date } from "./shared.js";
import { defaults, optionLabels } from "./preferences.js";

const sections = {
  connection: "Trạm có gửi đều không?",
  quality: "Số đo có dùng được không?",
  clock: "Giờ máy và khởi động",
};
function section(id?: string): keyof typeof sections {
  if (["offline", "silent", "empty"].includes(id ?? "")) return "connection";
  return id === "time" || id === "reboot" ? "clock" : "quality";
}

export function StationDetail({
  row,
  storageKey,
  options,
  setOptions,
  initialGroup,
  onClose,
}: {
  row: DiagnosticSummaryRow;
  storageKey: string;
  options: DiagnosticOptions;
  setOptions: (value: DiagnosticOptions) => void;
  initialGroup: keyof typeof sections;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(initialGroup);

  const [hours, setHours] = useState(24);
  const [custom, setCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [end, setEnd] = useState(() => Date.now());

  const [draft, setDraft] = useState(options);
  const [message, setMessage] = useState("");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const params = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(options).map(([k, v]) => [k, String(v)]),
    ),
    from: range?.from ?? new Date(end - hours * 3600000).toISOString(),
    to: range?.to ?? new Date(end).toISOString(),
  });
  const report = useQuery({
    queryKey: ["device-diagnostics", row.device_id, params.toString()],
    queryFn: () =>
      api<DiagnosticReport>(`/devices/${row.device_id}/diagnostics?${params}`),

    staleTime: 30000,
    retry: false,
  });
  const data = report.data;
  const incomplete =
    !!data &&
    Object.entries(data.completeness).some(
      ([key, value]) =>
        [
          "truncated",
          "rolled_up",
          "status_truncated",
          "config_truncated",
        ].includes(key) && value === true,
    );
  function applyOptions() {
    const result = diagnosticOptionsSchema.safeParse(draft);
    if (!result.success) {
      setMessage(
        "Một số ngưỡng chưa hợp lệ. Hãy chọn giá trị trong giới hạn ghi bên cạnh.",
      );
      return;
    }
    setOptions(result.data);
    try {
      localStorage.setItem(storageKey, JSON.stringify(result.data));
      setMessage("Đã áp dụng. Tùy chỉnh chỉ lưu trên trình duyệt này.");
    } catch {
      setMessage(
        "Đã áp dụng cho lần xem này; trình duyệt không cho phép lưu tùy chỉnh.",
      );
    }
  }
  function applyRange() {
    const from = Date.parse(customFrom),
      to = Date.parse(customTo);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      to <= from ||
      to - from > 14 * 86400000 ||
      to > Date.now()
    ) {
      setMessage(
        "Chọn đủ ngày giờ, kết thúc sau bắt đầu, không vượt hiện tại và tối đa 14 ngày.",
      );
      return;
    }
    setRange({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    setMessage("Đã áp dụng khoảng thời gian.");
  }
  const events =
    data?.events.filter((e) =>
      tab === "quality"
        ? e.kind === "flat" || e.kind === "jump"
        : e.kind === (tab === "clock" ? "clock" : "gap"),
    ) ?? [];
  return (
    <section className="dd-detail" aria-label={"Chi tiết " + row.name}>
      <button className="dd-back" onClick={onClose}>
        ← Danh sách thiết bị
      </button>
      <h2>{row.name}</h2>
      <p>
        {row.room ?? "Chưa gán phòng"}
        {row.source_kind === "simulator" && " · Mô phỏng"}
      </p>
      {row.notices.length > 0 && <h3>Hiện tại</h3>}
      <div className="dd-current">
        {row.notices.map((n) => (
          <article key={n.id}>
            <strong>{n.title}</strong>
            <p>{n.evidence}</p>
            <p>{n.action}</p>
            {section(n.id) !== tab && (
              <button onClick={() => setTab(section(n.id))}>
                Xem bằng chứng
              </button>
            )}
          </article>
        ))}
      </div>
      <nav className="dd-tabs" aria-label="Nhóm bằng chứng">
        {Object.entries(sections).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={key === tab}
            onClick={() => setTab(key as keyof typeof sections)}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="dd-toolbar" aria-label="Khoảng lịch sử">
        <>
          <label>
            Khoảng thời gian
            <select
              aria-label="Khoảng thời gian"
              value={custom ? "custom" : hours}
              onChange={(e) => {
                if (e.target.value === "custom") setCustom(true);
                else {
                  setCustom(false);
                  setRange(null);
                  setHours(Number(e.target.value));
                  setEnd(Date.now());
                }
              }}
            >
              <option value={1}>1 giờ gần nhất</option>
              <option value={24}>24 giờ gần nhất</option>
              <option value={168}>7 ngày gần nhất</option>
              <option value="custom">Tự chọn</option>
            </select>
          </label>
          <button
            disabled={report.isFetching}
            onClick={() => {
              if (range) void report.refetch();
              else setEnd(Date.now());
            }}
          >
            <RefreshCw
              size={16}
              className={report.isFetching ? "dd-loading" : ""}
            />
            {report.isFetching ? "Đang kiểm tra…" : "Cập nhật"}
          </button>
        </>
        {custom ? (
          <div className="dd-custom-range">
            <label>
              Từ ngày giờ
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label>
              Đến ngày giờ
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
            <button onClick={applyRange}>Xem khoảng này</button>
          </div>
        ) : null}
      </section>
      {message && <p role="status">{message}</p>}
      <LoadState
        pending={report.isPending}
        error={report.error}
        retry={() => void report.refetch()}
      />
      {data && (
        <>
          <p className="dd-snapshot">
            {date(data.from)} → {date(data.to)} · {data.count} mẫu
          </p>
          {range && !incomplete && data.notices.length > 0 && (
            <details>
              <summary>
                Dấu hiệu tại cuối khoảng đã chọn ({data.notices.length})
              </summary>
              {data.notices.map((n) => (
                <p key={n.id}>
                  <strong>{n.title}</strong> · {n.evidence}
                </p>
              ))}
            </details>
          )}
          {incomplete && (
            <p className="notice">Chỉ phân tích được một phần lịch sử.</p>
          )}
          {tab === "quality" && <QualityTab report={data} />}
          {tab === "connection" && (
            <ConnectionTab report={data} incomplete={incomplete} />
          )}
          {tab === "clock" && (
            <>
              <ClockTab report={data} />
              <SessionsTab report={data} />
            </>
          )}
          <div className="dd-time-track" aria-hidden="true">
            {events.map((e, i) => {
              const span = Date.parse(data.to) - Date.parse(data.from);
              const left = Math.max(
                0,
                ((Date.parse(e.from) - Date.parse(data.from)) * 100) / span,
              );
              return (
                <i
                  key={i}
                  data-kind={e.kind}
                  style={{
                    left: left + "%",
                    width:
                      Math.max(
                        0,
                        ((Date.parse(e.to) - Date.parse(e.from)) * 100) / span,
                      ) + "%",
                  }}
                />
              );
            })}
          </div>
          <details className="panel dd-section">
            <summary>
              Dòng thời gian · {events.length} dấu hiệu hiển thị
            </summary>
            <EventsTab
              report={{ ...data, events, event_count: events.length }}
            />
          </details>
          <details className="panel dd-section">
            <summary>Tùy chỉnh kiểm tra</summary>
            <p>
              Các ngưỡng này chỉ dùng để tìm dấu hiệu và tạo lời nhắc. Tùy chỉnh
              được lưu riêng cho tài khoản trên trình duyệt này.
            </p>
            <div className="dd-options">
              {(Object.keys(optionLabels) as (keyof DiagnosticOptions)[]).map(
                (key) => (
                  <label key={key}>
                    {optionLabels[key].name}
                    <input
                      type="number"
                      min={optionLabels[key].min}
                      max={optionLabels[key].max}
                      step={1}
                      value={Number.isNaN(draft[key]) ? "" : draft[key]}
                      onChange={(e) =>
                        setDraft((current) => ({
                          ...current,
                          [key]: e.target.valueAsNumber,
                        }))
                      }
                    />
                    <small>
                      {optionLabels[key].unit} ({optionLabels[key].min}–
                      {optionLabels[key].max})
                    </small>
                  </label>
                ),
              )}
            </div>
            <div className="dd-actions">
              <button className="primary" onClick={applyOptions}>
                Áp dụng tùy chỉnh
              </button>
              <button
                onClick={() => {
                  setDraft(defaults);
                  setOptions(defaults);
                  try {
                    localStorage.removeItem(storageKey);
                  } catch {
                    /* preference storage is optional */
                  }
                  setMessage("Đã khôi phục ngưỡng mặc định.");
                }}
              >
                Khôi phục mặc định
              </button>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
export const evidenceGroup = section;
