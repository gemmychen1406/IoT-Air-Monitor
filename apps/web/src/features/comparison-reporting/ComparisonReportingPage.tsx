import { useState } from "react";
import { BarChart3, FileDown, GitCompareArrows, Save } from "lucide-react";
import type { DeviceView, UserView } from "@iot/contracts";
import { DeviceComparison } from "./DeviceComparison.js";
import { PeriodComparison } from "./PeriodComparison.js";
import { ReportBuilder } from "./ReportBuilder.js";
import { loadConfigurations, saveConfigurations } from "./storage.js";
import type { SavedConfiguration } from "./types.js";
import "./styles.css";

const TABS = [
  ["devices", "So sánh thiết bị", GitCompareArrows],
  ["period", "So sánh giai đoạn", BarChart3],
  ["report", "Báo cáo môi trường", FileDown],
  ["saved", "Cấu hình đã lưu", Save],
] as const;
type Tab = (typeof TABS)[number][0];

export default function ComparisonReportingPage({
  devices,
  user,
}: {
  devices: DeviceView[];
  user: UserView;
}) {
  const [tab, setTab] = useState<Tab>("devices");
  const [saved, setSaved] = useState(() => loadConfigurations(user.id));
  const [applied, setApplied] = useState<SavedConfiguration | null>(null);
  function persist(values: SavedConfiguration[]) {
    setSaved(values);
    saveConfigurations(user.id, values);
  }
  function add(value: Omit<SavedConfiguration, "id" | "name" | "createdAt">) {
    const name = window
      .prompt("Tên cấu hình", `Cấu hình ${saved.length + 1}`)
      ?.trim();
    if (!name) return;
    persist([
      ...saved,
      {
        ...value,
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
      },
    ]);
  }
  function apply(value: SavedConfiguration) {
    const validIds = value.deviceIds.filter((id) =>
      devices.some((device) => device.id === id),
    );
    if (!validIds.length) {
      window.alert("Thiết bị trong cấu hình không còn khả dụng.");
      return;
    }
    const next = { ...value, deviceIds: validIds };
    setApplied(next);
    setTab(value.kind);
  }
  function rename(value: SavedConfiguration) {
    const name = window.prompt("Tên mới", value.name)?.trim();
    if (name)
      persist(
        saved.map((item) => (item.id === value.id ? { ...item, name } : item)),
      );
  }
  return (
    <div className="cr-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">SO SÁNH & BÁO CÁO</span>
          <h1>Hiểu dữ liệu môi trường dễ dàng hơn</h1>
          <p>
            Chọn phòng, khoảng thời gian và xem kết quả từ dữ liệu cảm biến thực
            tế.
          </p>
        </div>
      </div>
      <nav className="cr-tabs" aria-label="Các chức năng so sánh và báo cáo">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={17} /> {label}
          </button>
        ))}
      </nav>
      {!devices.length ? (
        <p className="panel cr-empty">
          Chưa có thiết bị được phép xem. Hãy thêm thiết bị trước khi tạo so
          sánh hoặc báo cáo.
        </p>
      ) : null}
      {devices.length && tab === "devices" ? (
        <DeviceComparison
          key={applied?.id ?? "new-devices"}
          devices={devices}
          isAdmin={user.role === "admin"}
          initial={applied}
          onSave={add}
        />
      ) : null}
      {devices.length && tab === "period" ? (
        <PeriodComparison
          key={applied?.id ?? "new-period"}
          devices={devices}
          isAdmin={user.role === "admin"}
          initial={applied}
          onSave={add}
        />
      ) : null}
      {devices.length && tab === "report" ? (
        <ReportBuilder
          key={applied?.id ?? "new-report"}
          devices={devices}
          isAdmin={user.role === "admin"}
          initial={applied}
          onSave={add}
        />
      ) : null}
      {tab === "saved" ? (
        <section className="cr-section">
          <div className="notice">
            Cấu hình chỉ được lưu trên trình duyệt này, theo tài khoản đang đăng
            nhập; không tự đồng bộ sang thiết bị khác.
          </div>
          {saved.length ? (
            <div className="cr-saved">
              {saved.map((value) => (
                <article className="panel" key={value.id}>
                  <div>
                    <h3>{value.name}</h3>
                    <p>
                      {value.kind === "devices"
                        ? "So sánh thiết bị"
                        : value.kind === "period"
                          ? "So sánh giai đoạn"
                          : "Báo cáo môi trường"}{" "}
                      · {value.deviceIds.length} thiết bị
                    </p>
                  </div>
                  <div className="cr-actions">
                    <button className="primary" onClick={() => apply(value)}>
                      Mở lại
                    </button>
                    <button onClick={() => rename(value)}>Đổi tên</button>
                    <button
                      onClick={() =>
                        persist(saved.filter((item) => item.id !== value.id))
                      }
                    >
                      Xóa
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="panel cr-empty">Bạn chưa lưu cấu hình nào.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
