import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ClipboardCheck, RefreshCw, Info, Wrench } from "lucide-react";
import {
  diagnosticOptionsSchema,
  type DeviceView,
  type DiagnosticReport,
  type DiagnosticOptions,
} from "@iot/contracts";
import { api } from "../../lib/api.js";
import {
  ClockTab,
  ConnectionTab,
  EventsTab,
  QualityTab,
  SessionsTab,
} from "./ReportTabs.js";
import { date } from "./shared.js";
import "./styles.css";
const SpatialSimulation = lazy(() => import("./SpatialSimulation.js"));
const tabs = [
  ["quality", "Chất lượng dữ liệu"],
  ["events", "Gián đoạn & bất thường"],
  ["connection", "Kết nối"],
  ["spatial", "Mô phỏng phân bố"],
  ["clock", "Thời gian thiết bị"],
  ["sessions", "Khởi động & phiên bản"],
] as const;
type Tab = (typeof tabs)[number][0];
const defaults = diagnosticOptionsSchema.parse({});
function readOptions(key: string) {
  try {
    return diagnosticOptionsSchema.parse(
      JSON.parse(localStorage.getItem(key) ?? "{}"),
    );
  } catch {
    return defaults;
  }
}
const optionLabels: Record<
  keyof DiagnosticOptions,
  { name: string; min: number; max: number; unit: string }
> = {
  gap_multiplier: {
    name: "Báo thiếu mẫu khi vượt",
    min: 2,
    max: 20,
    unit: "lần chu kỳ gửi",
  },
  flat_minutes: {
    name: "Kiểm tra số đo ít thay đổi sau",
    min: 5,
    max: 120,
    unit: "phút",
  },
  temperature_jump: {
    name: "Nhiệt độ thay đổi nhanh từ",
    min: 1,
    max: 30,
    unit: "°C / cặp mẫu",
  },
  humidity_jump: {
    name: "Độ ẩm thay đổi nhanh từ",
    min: 2,
    max: 80,
    unit: "điểm %RH / cặp mẫu",
  },
  gas_jump_pct: {
    name: "Tín hiệu khí thay đổi nhanh từ",
    min: 5,
    max: 90,
    unit: "% toàn thang ADC / cặp mẫu",
  },
  reboot_threshold: {
    name: "Nhắc kiểm tra nguồn từ",
    min: 2,
    max: 20,
    unit: "lần đổi phiên / giờ",
  },
};

export default function DeviceDiagnosticsPage({
  devices,
  userId,
}: {
  devices: DeviceView[];
  userId: string;
}) {
  const storageKey = `airguard.diagnostics.options.v1.${userId}`;
  const [tab, setTab] = useState<Tab>("quality");
  const [selectedId, setSelectedId] = useState("");
  const device = devices.find((d) => d.id === selectedId) ?? devices[0];
  const [hours, setHours] = useState(24);
  const [custom, setCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [end, setEnd] = useState(() => Date.now());
  const [options, setOptions] = useState(() => readOptions(storageKey));
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
    queryKey: ["device-diagnostics", device?.id, params.toString()],
    queryFn: () =>
      api<DiagnosticReport>(`/devices/${device!.id}/diagnostics?${params}`),
    enabled: !!device && tab !== "spatial",
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
  return (
    <div className="dd-page">
      <div className="page-title">
        <div>
          <h1>Kiểm tra thiết bị</h1>
          <p>
            Hiểu số đo có đáng dùng không và biết khi nào cần xem lại thiết bị.
          </p>
        </div>
        <ClipboardCheck aria-hidden="true" />
      </div>
      {!devices.length && tab !== "spatial" ? (
        <section className="panel dd-section">
          <h2>Chưa có thiết bị để kiểm tra</h2>
          <p>Thêm thiết bị, kết nối và chờ nhận số đo đầu tiên.</p>
          <Link to="/app/devices">Mở danh sách thiết bị</Link>
          <p>
            <button onClick={() => setTab("spatial")}>
              Thử mô phỏng trước khi có thiết bị
            </button>
          </p>
        </section>
      ) : (
        <>
          {tab !== "spatial" ? (
            <section
              className="panel dd-toolbar"
              aria-label="Chọn dữ liệu kiểm tra"
            >
              <label>
                Thiết bị
                <select
                  aria-label="Thiết bị"
                  value={device?.id ?? ""}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.source_kind === "simulator" ? " · Mô phỏng" : ""}
                    </option>
                  ))}
                </select>
              </label>
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
              <span className="dd-device-location">
                {device?.location || "Chưa khai báo vị trí"}
                {device?.source_kind === "simulator"
                  ? " · Dữ liệu mô phỏng"
                  : ""}
              </span>
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
          ) : null}
          <nav className="dd-tabs" aria-label="Các phần kiểm tra thiết bị">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                aria-current={tab === id ? "page" : undefined}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {message ? (
            <p className="notice" role="status">
              {message}
            </p>
          ) : null}
          {tab === "spatial" ? (
            <Suspense fallback={<p role="status">Đang tải mô phỏng…</p>}>
              <SpatialSimulation devices={devices} userId={userId} />
            </Suspense>
          ) : (
            <>
              {report.isPending ? (
                <div className="panel dd-section" role="status">
                  Đang đọc lịch sử và kiểm tra thiết bị…
                </div>
              ) : null}
              {report.isError ? (
                <section className="notice error" role="alert">
                  Chưa kiểm tra được: {report.error.message}.{" "}
                  <button onClick={() => void report.refetch()}>Thử lại</button>
                </section>
              ) : null}
              {data ? (
                <>
                  <p className="dd-snapshot">
                    {date(data.from)} → {date(data.to)} ·{" "}
                    {data.count.toLocaleString("vi-VN")} mẫu gốc · Kết quả lúc{" "}
                    {date(data.generated_at)}. Bấm Cập nhật để xem lại.
                  </p>
                  {incomplete ? (
                    <div className="notice" role="status">
                      <Info size={18} />
                      <div>
                        <strong>Chỉ phân tích được một phần lịch sử.</strong>
                        <p>
                          {data.completeness.truncated
                            ? "Khoảng này vượt 30.000 mẫu; hãy thu hẹp khoảng để kiểm tra đầy đủ. "
                            : ""}
                          {data.completeness.rolled_up
                            ? "Có dữ liệu đã tổng hợp; chi tiết mẫu gốc không còn đầy đủ. "
                            : ""}
                          {data.completeness.status_truncated
                            ? "Lịch sử kết nối vượt giới hạn. "
                            : ""}
                          {data.completeness.config_truncated
                            ? "Thiếu lịch sử cấu hình hoặc lịch sử vượt giới hạn. "
                            : ""}
                          Không tạo lời nhắc và không kết luận tổng thời gian
                          kết nối cho khoảng này.
                        </p>
                      </div>
                    </div>
                  ) : null}
                  <section
                    className="panel dd-section dd-advice"
                    aria-labelledby="dd-advice-title"
                  >
                    <h2 id="dd-advice-title">
                      <Wrench size={19} /> Việc cần kiểm tra
                    </h2>
                    <p>
                      Cho {device?.name}
                      {device?.location ? ` tại ${device.location}` : ""}. Lời
                      nhắc dựa trên 5 phút cuối khoảng chọn, hoặc một giờ cuối
                      cho khởi động lại. Đây là thông tin kiểm tra thiết bị,
                      không thay thế cảnh báo sự cố.
                    </p>
                    {incomplete ? (
                      <p>
                        Thu hẹp khoảng hoặc chọn dữ liệu gốc đầy đủ để nhận lời
                        nhắc.
                      </p>
                    ) : data.notices.length ? (
                      <div className="dd-notices">
                        {data.notices.map((n) => (
                          <article
                            key={n.id}
                            className={`dd-notice dd-notice-${n.level}`}
                          >
                            <h3>{n.title}</h3>
                            <p>{n.evidence}</p>
                            <p>
                              <strong>Bạn có thể làm:</strong> {n.action}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="dd-calm">
                        Chưa có việc cần nhắc theo các quy tắc kiểm tra hiện
                        tại. Bạn vẫn có thể xem chi tiết bên dưới.
                      </p>
                    )}
                    {Date.parse(data.generated_at) - Date.parse(data.to) >
                    120000 ? (
                      <p className="dd-historical">
                        Đang xem lịch sử. Lời nhắc mô tả tình trạng tại cuối
                        khoảng chọn, không phải trạng thái hiện tại.
                      </p>
                    ) : null}
                  </section>
                  {tab === "quality" ? <QualityTab report={data} /> : null}
                  {tab === "events" ? <EventsTab report={data} /> : null}
                  {tab === "connection" ? (
                    <ConnectionTab report={data} incomplete={incomplete} />
                  ) : null}
                  {tab === "clock" ? <ClockTab report={data} /> : null}
                  {tab === "sessions" ? <SessionsTab report={data} /> : null}
                  <details className="panel dd-section">
                    <summary>Tùy chỉnh kiểm tra</summary>
                    <p>
                      Các ngưỡng này chỉ dùng để tìm dấu hiệu và tạo lời nhắc.
                      Tùy chỉnh được lưu riêng cho tài khoản trên trình duyệt
                      này.
                    </p>
                    <div className="dd-options">
                      {(
                        Object.keys(optionLabels) as (keyof DiagnosticOptions)[]
                      ).map((key) => (
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
                      ))}
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
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
