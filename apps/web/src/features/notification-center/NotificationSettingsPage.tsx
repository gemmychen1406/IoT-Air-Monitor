import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { ArrowLeft, Bell, CalendarClock, History } from "lucide-react";
import type { DeviceView, UserView } from "@iot/contracts";
import { PushSettings } from "../../components/PushSettings.js";
import EnvironmentSettingsPage from "./EnvironmentSettingsPage.js";
import PushPrivacyPreference from "./PushPrivacyPreference.js";
import "./notification-settings.css";

const tabs = [
  { id: "browser", label: "Cảnh báo trình duyệt", Icon: Bell },
  { id: "schedule", label: "Lịch thông báo", Icon: CalendarClock },
] as const;
type Tab = (typeof tabs)[number]["id"];

export default function NotificationSettingsPage({
  devices,
  user,
}: {
  devices: DeviceView[];
  user: UserView;
}) {
  const [tab, setTab] = useState<Tab>("browser");
  const buttons = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  function moveTab(event: KeyboardEvent<HTMLButtonElement>) {
    const index = tabs.findIndex(({ id }) => id === tab);
    const next =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs[tabs.length - 1]
          : event.key === "ArrowRight"
            ? tabs[(index + 1) % tabs.length]
            : event.key === "ArrowLeft"
              ? tabs[(index + tabs.length - 1) % tabs.length]
              : undefined;
    if (!next) return;
    event.preventDefault();
    setTab(next.id);
    buttons.current[next.id]?.focus();
  }

  return (
    <div className="ag-notification-settings">
      <Link className="ag-notification-link" to="/app/settings">
        <ArrowLeft size={18} aria-hidden="true" /> Cài đặt
      </Link>
      <header className="ag-notification-header">
        <h1>Cài đặt thông báo</h1>
        <Link className="ag-notification-link" to="/app/notifications">
          <History size={18} aria-hidden="true" /> Xem lịch sử gửi
        </Link>
      </header>
      <div
        className="ag-notification-tabs"
        role="tablist"
        aria-label="Loại cài đặt thông báo"
      >
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            ref={(element) => {
              buttons.current[id] = element;
            }}
            type="button"
            id={`ag-notification-tab-${id}`}
            role="tab"
            aria-controls={`ag-notification-panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={moveTab}
          >
            <Icon size={19} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <div
        className="ag-notification-panel"
        id="ag-notification-panel-browser"
        role="tabpanel"
        aria-labelledby="ag-notification-tab-browser"
        hidden={tab !== "browser"}
      >
        <PushSettings devices={devices} />
        <PushPrivacyPreference />
      </div>
      <div
        className="ag-notification-panel"
        id="ag-notification-panel-schedule"
        role="tabpanel"
        aria-labelledby="ag-notification-tab-schedule"
        hidden={tab !== "schedule"}
      >
        <EnvironmentSettingsPage devices={devices} user={user} embedded />
      </div>
    </div>
  );
}
