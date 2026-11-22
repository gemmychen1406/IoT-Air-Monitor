import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  Activity,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock3,
  Map,
  Radio,
} from "lucide-react";
import type { DeviceView, DiagnosticSummaryRow } from "@iot/contracts";
import { LoadState } from "../../components/FeatureUI.js";
import { api } from "../../lib/api.js";
import { StationDetail, evidenceGroup } from "./StationDetail.js";
import { RoomSymbol } from "./RoomSymbol.js";
import { readOptions } from "./preferences.js";
import "./styles.css";
const SpatialSimulation = lazy(() => import("./SpatialSimulation.js"));

function Help({ map }: { map: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tip, setTip] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!tip) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTip(false);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [tip]);
  const hint = map
    ? "Chấm là số đo, màu giữa các chấm là ước tính."
    : "Chọn một trạm để xem bằng chứng và bước kiểm tra.";
  return (
    <div
      className="dd-help"
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setTip(false);
      }}
    >
      <button
        ref={button}
        aria-label="Hướng dẫn kiểm tra thiết bị"
        aria-haspopup="dialog"
        aria-describedby={tip ? "dd-tip" : undefined}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
        onClick={() => {
          setTip(false);
          dialog.current?.showModal();
        }}
      >
        <CircleHelp size={20} />
      </button>
      {tip && (
        <span id="dd-tip" role="tooltip">
          {hint}
        </span>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="dd-help-title"
        onClose={() => {
          button.current?.focus();
          setTip(false);
        }}
      >
        <h2 id="dd-help-title">
          {map ? "Cách đọc bản đồ" : "Cách đọc kết quả kiểm tra"}
        </h2>
        <p>{hint}</p>
        <h3>Thiết bị cần chú ý</h3>
        <p>
          Danh sách cập nhật mỗi 30 giây. Mất kết nối dựa vào lần liên lạc cuối.
          Trạm vẫn có thể liên lạc trong khi số đo cũ hoặc lỗi. Kiểm tra giờ máy
          nếu thời điểm đo lệch với thời điểm nhận.
        </p>
        <p>
          Dấu hiệu đứng lâu hoặc thay đổi nhanh cần đối chiếu với môi trường
          thực tế. Lịch sử chi tiết dùng khoảng thời gian và ngưỡng bạn chọn.
        </p>
        <h3>Phân bố trong phòng</h3>
        <p>
          Gas/khói và CO hiển thị theo phần trăm toàn thang ADC. Từ ba vị trí đủ
          tách biệt, IDW ước tính vùng xung quanh bằng cách cho điểm gần trọng
          số lớn hơn. Vân chéo là vùng thiếu độ phủ.
        </p>
        <p>
          Bản đồ dùng tọa độ đã đăng ký và so sánh các trạm cùng nguồn, cùng độ
          phân giải ADC. Vị trí trùng nhau được lấy trung bình khi nội suy.
        </p>
        <button autoFocus onClick={() => dialog.current?.close()}>
          Đóng hướng dẫn
        </button>
      </dialog>
    </div>
  );
}

export default function DeviceDiagnosticsPage({
  devices,
  userId,
}: {
  devices: DeviceView[];
  userId: string;
}) {
  const [map, setMap] = useState(false);
  const [id, select] = useState("");
  const [filter, setFilter] = useState("");
  const trigger = useRef<HTMLElement | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const key = "airguard.diagnostics.options.v1." + userId;
  const [options, setOptions] = useState(() => readOptions(key));
  const params = new URLSearchParams(
    Object.entries(options).map(([k, v]) => [k, String(v)]),
  );
  const summary = useQuery({
    queryKey: ["diagnostic-summary", userId, params.toString()],
    queryFn: () =>
      api<DiagnosticSummaryRow[]>("/diagnostics/summary?" + params),
    enabled: !map && !!devices.length,
    refetchInterval: 30000,
  });
  const rows = summary.data ?? [];
  const selected = rows.find((r) => r.device_id === id);
  function open(id: string) {
    trigger.current = document.activeElement as HTMLElement;
    select(id);
    setMap(false);
  }
  function close() {
    select("");
    requestAnimationFrame(() =>
      (trigger.current?.isConnected
        ? trigger.current
        : search.current
      )?.focus(),
    );
  }
  const selectedId = selected?.device_id;
  useEffect(() => {
    if (selectedId) detail.current?.focus();
  }, [selectedId]);
  function station(row: DiagnosticSummaryRow) {
    const issue = row.notices[0];
    const Icon =
      issue?.level === "check" ? CircleAlert : issue ? Clock3 : Radio;
    return (
      <button
        key={row.device_id}
        className="dd-station"
        data-impact={
          issue?.id === "offline" || issue?.id.startsWith("invalid-")
            ? "fault"
            : issue
              ? "attention"
              : "ok"
        }
        aria-pressed={row.device_id === id}
        onClick={() => open(row.device_id)}
      >
        <Icon className={issue ? "dd-issue" : "dd-ok"} size={19} />
        <span>
          <small className="dd-room-meta">
            <RoomSymbol name={row.room} />
            {row.room ?? "Chưa gán phòng"}
            {row.source_kind === "simulator" && " · Mô phỏng"}
          </small>
          <strong>{row.name}</strong>
          <span>
            {issue?.title ??
              (row.recovered_at ? "Đã kết nối trở lại" : "Đang gửi dữ liệu")}
            {row.notices.length > 1 && " · +" + (row.notices.length - 1)}
          </span>
        </span>
        {row.last_seen_at && (
          <time dateTime={row.last_seen_at}>
            Liên lạc cuối
            <br />
            {new Date(row.last_seen_at).toLocaleTimeString("vi-VN")}
          </time>
        )}
        <ChevronRight size={17} />
      </button>
    );
  }
  const visible = rows.filter((r) =>
    [r.room, r.name]
      .join(" ")
      .toLocaleLowerCase("vi")
      .includes(filter.toLocaleLowerCase("vi")),
  );
  const issues = visible.filter((r) => r.notices.length);
  return (
    <div className="dd-page dd-hub">
      <header className="page-title">
        <h1>Kiểm tra thiết bị</h1>
        <Help map={map} />
      </header>
      <nav className="dd-tabs" aria-label="Chế độ kiểm tra">
        {[false, true].map((active) => {
          const Icon = active ? Map : Activity;
          return (
            <button
              key={String(active)}
              aria-pressed={map === active}
              onClick={() => {
                setMap(active);
                select("");
              }}
            >
              <Icon size={17} />
              {active ? "Bản đồ phân bố trong phòng" : "Thiết bị cần chú ý"}
            </button>
          );
        })}
      </nav>
      {map ? (
        <Suspense fallback={<p>Đang tải bản đồ…</p>}>
          <SpatialSimulation userId={userId} onInspect={open} />
        </Suspense>
      ) : !devices.length ? (
        <section className="panel dd-section">
          <h2>Chưa có thiết bị để kiểm tra</h2>
          <Link to="/app/devices">Mở danh sách thiết bị</Link>
        </section>
      ) : (
        <>
          <LoadState
            pending={summary.isPending}
            error={summary.error}
            retry={() => void summary.refetch()}
          />
          {summary.data && (
            <div className={"dd-workbench" + (selected ? " has-detail" : "")}>
              <section className="panel dd-fleet">
                <h2>
                  {rows.filter((r) => r.notices.length).length} trạm cần chú ý
                </h2>
                <small>
                  {rows.length} trạm · Cập nhật{" "}
                  {new Date(summary.dataUpdatedAt).toLocaleTimeString("vi-VN")}
                </small>
                <input
                  ref={search}
                  aria-label="Tìm phòng hoặc trạm"
                  placeholder="Tìm phòng hoặc trạm"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                {issues.map(station)}
                {!issues.length && (
                  <p>
                    {filter
                      ? "Không có dấu hiệu khớp bộ lọc."
                      : "Chưa ghi nhận dấu hiệu cần kiểm tra."}
                  </p>
                )}
                <details>
                  <summary>Tất cả thiết bị ({visible.length})</summary>
                  {visible.map(station)}
                </details>
              </section>
              {selected && (
                <div ref={detail} tabIndex={-1} className="dd-detail-wrap">
                  <StationDetail
                    key={selected.device_id}
                    row={selected}
                    initialGroup={evidenceGroup(selected.notices[0]?.id)}
                    options={options}
                    setOptions={setOptions}
                    storageKey={key}
                    onClose={close}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
