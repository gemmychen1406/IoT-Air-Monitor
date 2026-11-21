import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Bell, CalendarClock, ChevronDown, Cpu, Send } from "lucide-react";
import {
  digestIntervals,
  environmentPolicyInput,
  type DeviceView,
  type EnvironmentChannel,
  type EnvironmentPolicy,
  type EnvironmentSettingsView,
  type SpacesView,
  type UserView,
} from "@iot/contracts";
import { LoadState, PageTitle } from "../../components/FeatureUI.js";
import { api } from "../../lib/api.js";
import "./notification-settings.css";

const deviceLimit = 20;
const channels = [
  { id: "webpush", label: "Web Push cá nhân", Icon: Bell },
  { id: "telegram", label: "Telegram chung", Icon: Send },
] as const;

function ScheduleGroup({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="ag-notification-disclosure ag-schedule-group">
      <summary>
        <span>
          <strong>{title}</strong>
          <span className="caption">{summary}</span>
        </span>
        <ChevronDown size={20} aria-hidden="true" />
      </summary>
      <div className="ag-schedule-group-fields">{children}</div>
    </details>
  );
}

function DevicePicker({
  devices,
  selected,
  onToggle,
}: {
  devices: DeviceView[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const spaces = useQuery({
    queryKey: ["monitoring-spaces"],
    queryFn: () => api<SpacesView>("/spaces"),
    staleTime: 60_000,
  });
  const matches = (name: string) =>
    name
      .toLocaleLowerCase("vi")
      .includes(search.trim().toLocaleLowerCase("vi"));
  const roomByDevice = new Map(
    spaces.data?.devices.map((device) => [device.id, device.room_id]),
  );
  const rooms = new Map(spaces.data?.rooms.map((room) => [room.id, room]));
  const areas = new Map(spaces.data?.areas.map((area) => [area.id, area.name]));
  const roomNames = new Map<string, number>();
  for (const room of rooms.values())
    roomNames.set(room.name, (roomNames.get(room.name) ?? 0) + 1);
  const groups = new Map<string, { title: string; devices: DeviceView[] }>();
  for (const device of devices.filter((device) => matches(device.name))) {
    const roomId = roomByDevice.get(device.id);
    const room = roomId ? rooms.get(roomId) : undefined;
    const key = room?.id ?? (roomId ? "unknown" : "none");
    const group = groups.get(key) ?? {
      title: room
        ? (roomNames.get(room.name) ?? 0) > 1 && areas.has(room.area_id)
          ? `${room.name} · ${areas.get(room.area_id)}`
          : room.name
        : roomId
          ? "Chưa có tên phòng"
          : spaces.data
            ? "Chưa gán phòng"
            : "Thiết bị",
      devices: [],
    };
    group.devices.push(device);
    groups.set(key, group);
  }
  const available = new Set(devices.map((device) => device.id));
  const unavailable = selected.filter(
    (id) => !available.has(id) && matches(`Thiết bị đã chọn ${id}`),
  );
  const sorted = [...groups.entries()].sort(([a, left], [b, right]) =>
    a === "none"
      ? 1
      : b === "none"
        ? -1
        : left.title.localeCompare(right.title, "vi"),
  );
  return (
    <>
      <label>
        Tìm thiết bị theo tên
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nhập tên thiết bị"
        />
      </label>
      <p className="caption ag-notification-count" role="status">
        Đã chọn {selected.length}/{deviceLimit} thiết bị
      </p>
      {spaces.isError ? (
        <p className="caption">
          Chưa tải được thông tin phòng. Bạn vẫn có thể chọn thiết bị.
        </p>
      ) : null}
      <div className="ag-schedule-devices">
        {sorted.map(([id, group]) => (
          <fieldset key={id} className="ag-schedule-device-group">
            <legend>{group.title}</legend>
            {group.devices.map((device) => (
              <label className="check-label" key={device.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(device.id)}
                  disabled={
                    selected.length >= deviceLimit &&
                    !selected.includes(device.id)
                  }
                  onChange={() => onToggle(device.id)}
                />
                <span>
                  {device.name}
                  {device.source_kind === "simulator" ? (
                    <small className="caption">Mô phỏng</small>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        {unavailable.length ? (
          <fieldset className="ag-schedule-device-group">
            <legend>Thiết bị đã chọn từ trước</legend>
            {unavailable.map((id) => (
              <label className="check-label" key={id}>
                <input type="checkbox" checked onChange={() => onToggle(id)} />{" "}
                Thiết bị đã chọn ({id.slice(0, 8)})
              </label>
            ))}
          </fieldset>
        ) : null}
        {!sorted.length && !unavailable.length ? (
          <p className="muted">
            {search.trim() ? "Không tìm thấy thiết bị." : "Chưa có thiết bị."}
          </p>
        ) : null}
      </div>
    </>
  );
}

function PolicyForm({
  devices,
  draft,
  pending,
  onChange,
  onSave,
}: {
  devices: DeviceView[];
  draft: EnvironmentPolicy;
  pending: boolean;
  onChange: (draft: EnvironmentPolicy) => void;
  onSave: (draft: EnvironmentPolicy) => void;
}) {
  const [error, setError] = useState("");
  const set = <K extends keyof EnvironmentPolicy>(
    key: K,
    value: EnvironmentPolicy[K],
  ) => onChange({ ...draft, [key]: value });
  const toggle = (id: string) =>
    set(
      "device_ids",
      draft.device_ids.includes(id)
        ? draft.device_ids.filter((value) => value !== id)
        : [...draft.device_ids, id],
    );
  const check = (
    label: string,
    checked: boolean,
    change: (value: boolean) => void,
  ) => (
    <label className="check-label">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => change(event.target.checked)}
      />{" "}
      {label}
    </label>
  );
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    change: (value: number) => void,
    step = 1,
  ) => (
    <label>
      {label}
      <input
        type="number"
        required
        value={Number.isNaN(value) ? "" : value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => change(event.target.valueAsNumber)}
      />
    </label>
  );
  const quiet = draft.quiet;
  const toggleSummary = (enabled: boolean, summary: string) =>
    enabled ? `Bật · ${summary}` : "Tắt";
  const minuteSummary = (value: number) =>
    Number.isFinite(value) ? `${value} phút` : "Chưa nhập số phút";

  function submit(event: FormEvent) {
    event.preventDefault();
    const invalid = event.currentTarget.querySelector<HTMLElement>(
      "input:invalid, select:invalid",
    );
    if (invalid) {
      const section = invalid.closest("details");
      if (section) section.open = true;
      invalid.focus();
      if (
        invalid instanceof HTMLInputElement ||
        invalid instanceof HTMLSelectElement
      )
        invalid.reportValidity();
      return;
    }
    const parsed = environmentPolicyInput.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Kiểm tra cấu hình.");
      return;
    }
    setError("");
    onSave(parsed.data);
  }

  return (
    <form className="ag-schedule-form" onSubmit={submit} noValidate>
      <fieldset disabled={pending} className="ag-schedule-layout">
        <section className="panel ag-notification-card">
          <h2>
            <Cpu size={21} aria-hidden="true" /> Thiết bị theo dõi
          </h2>
          <DevicePicker
            devices={devices}
            selected={draft.device_ids}
            onToggle={toggle}
          />
          <div className="ag-notification-option">
            {check(
              "Nhận cả dữ liệu mô phỏng",
              draft.include_simulators,
              (value) => set("include_simulators", value),
            )}
          </div>
        </section>
        <section className="panel ag-notification-card ag-schedule-options">
          <h2>
            <CalendarClock size={21} aria-hidden="true" /> Lịch gửi
          </h2>
          <div className="ag-schedule-enabled" data-enabled={draft.enabled}>
            {check(
              "Bật thông báo môi trường và kết nối",
              draft.enabled,
              (value) => set("enabled", value),
            )}
            <p className="caption">{draft.enabled ? "Đang bật" : "Đang tắt"}</p>
          </div>
          <label>
            Múi giờ (IANA)
            <input
              value={draft.timezone}
              required
              maxLength={80}
              onChange={(event) => set("timezone", event.target.value)}
            />
          </label>
          <ScheduleGroup
            title="Bản tin nhiệt độ và độ ẩm"
            summary={toggleSummary(
              draft.digest.enabled,
              `Mỗi ${draft.digest.interval_minutes} phút`,
            )}
          >
            {check(
              "Gửi bản tin nhiệt độ và độ ẩm",
              draft.digest.enabled,
              (value) => set("digest", { ...draft.digest, enabled: value }),
            )}
            {draft.digest.enabled ? (
              <div className="ag-schedule-field-grid">
                <label>
                  Chu kỳ gửi (phút)
                  <select
                    value={draft.digest.interval_minutes}
                    onChange={(event) =>
                      set("digest", {
                        ...draft.digest,
                        interval_minutes: Number(event.target.value),
                      })
                    }
                  >
                    {digestIntervals.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                {number(
                  "Cửa sổ lấy mẫu (phút)",
                  draft.digest.window_minutes,
                  5,
                  1440,
                  (value) =>
                    set("digest", { ...draft.digest, window_minutes: value }),
                )}
              </div>
            ) : null}
          </ScheduleGroup>
          <ScheduleGroup
            title="Biến động môi trường"
            summary={toggleSummary(
              draft.variation.enabled,
              `Duy trì ${minuteSummary(draft.variation.sustain_minutes)}`,
            )}
          >
            {check(
              "Thông báo biến động đáng chú ý",
              draft.variation.enabled,
              (value) =>
                set("variation", { ...draft.variation, enabled: value }),
            )}
            {draft.variation.enabled ? (
              <div className="ag-schedule-field-grid">
                {number(
                  "Chênh lệch nhiệt độ (°C)",
                  draft.variation.temperature_delta,
                  0.1,
                  30,
                  (value) =>
                    set("variation", {
                      ...draft.variation,
                      temperature_delta: value,
                    }),
                  0.1,
                )}
                {number(
                  "Chênh lệch độ ẩm (điểm %RH)",
                  draft.variation.humidity_delta,
                  0.1,
                  100,
                  (value) =>
                    set("variation", {
                      ...draft.variation,
                      humidity_delta: value,
                    }),
                  0.1,
                )}
                {number(
                  "Duy trì (phút)",
                  draft.variation.sustain_minutes,
                  3,
                  30,
                  (value) =>
                    set("variation", {
                      ...draft.variation,
                      sustain_minutes: value,
                    }),
                )}
                {number(
                  "Khoảng nghỉ (phút)",
                  draft.variation.cooldown_minutes,
                  5,
                  1440,
                  (value) =>
                    set("variation", {
                      ...draft.variation,
                      cooldown_minutes: value,
                    }),
                )}
              </div>
            ) : null}
          </ScheduleGroup>
          <ScheduleGroup
            title="Mất hoặc khôi phục kết nối"
            summary={toggleSummary(
              draft.connectivity.enabled,
              `Chờ ${minuteSummary(draft.connectivity.wait_minutes)}`,
            )}
          >
            {check(
              "Thông báo mất và kết nối lại",
              draft.connectivity.enabled,
              (value) =>
                set("connectivity", { ...draft.connectivity, enabled: value }),
            )}
            {draft.connectivity.enabled ? (
              <div className="ag-schedule-field-grid">
                {number(
                  "Chờ sau khi mất kết nối (phút)",
                  draft.connectivity.wait_minutes,
                  1,
                  60,
                  (value) =>
                    set("connectivity", {
                      ...draft.connectivity,
                      wait_minutes: value,
                    }),
                )}
                {number(
                  "Khoảng nghỉ giữa hai lượt báo mất (phút)",
                  draft.connectivity.cooldown_minutes,
                  1,
                  1440,
                  (value) =>
                    set("connectivity", {
                      ...draft.connectivity,
                      cooldown_minutes: value,
                    }),
                )}
              </div>
            ) : null}
          </ScheduleGroup>
          <ScheduleGroup
            title="Giờ yên lặng"
            summary={
              quiet ? `Bật · ${quiet.start || "…"}–${quiet.end || "…"}` : "Tắt"
            }
          >
            {check("Bật giờ yên lặng", !!quiet, (value) =>
              set("quiet", value ? { start: "22:00", end: "07:00" } : null),
            )}
            {quiet ? (
              <>
                <div className="ag-schedule-field-grid">
                  <label>
                    Bắt đầu
                    <input
                      type="time"
                      required
                      value={quiet.start}
                      onChange={(event) =>
                        set("quiet", { ...quiet, start: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Kết thúc
                    <input
                      type="time"
                      required
                      value={quiet.end}
                      onChange={(event) =>
                        set("quiet", { ...quiet, end: event.target.value })
                      }
                    />
                  </label>
                </div>
                {check(
                  "Áp dụng cho cả cảnh báo sự cố của kênh này",
                  draft.quiet_incidents,
                  (value) => set("quiet_incidents", value),
                )}
                {draft.quiet_incidents
                  ? check(
                      "Cảnh báo nghiêm trọng bỏ qua giờ yên lặng",
                      draft.critical_bypass,
                      (value) => set("critical_bypass", value),
                    )
                  : null}
                {draft.quiet_incidents && draft.critical_bypass ? (
                  <p className="caption">
                    Tùy chọn bỏ qua chỉ áp dụng trên AirGuard. Thiết bị vẫn có
                    thể chặn hoặc hoãn thông báo.
                  </p>
                ) : null}
              </>
            ) : null}
          </ScheduleGroup>
          {error ? (
            <p role="alert" className="notice error">
              {error}
            </p>
          ) : null}
          <button className="primary ag-schedule-save" disabled={pending}>
            {pending ? "Đang lưu…" : "Lưu lịch thông báo"}
          </button>
        </section>
      </fieldset>
    </form>
  );
}

export default function EnvironmentSettingsPage({
  devices,
  user,
  embedded = false,
}: {
  devices: DeviceView[];
  user: UserView;
  embedded?: boolean;
}) {
  const [selectedChannel, setChannel] = useState<EnvironmentChannel>("webpush");
  const [drafts, setDrafts] = useState<
    Partial<Record<EnvironmentChannel, EnvironmentPolicy>>
  >({});
  const channel = user.role === "admin" ? selectedChannel : "webpush";
  const client = useQueryClient();
  const key = ["environment-settings", user.id, channel];
  const url = `/environment/settings/${channel}`;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<EnvironmentSettingsView>(url),
    refetchInterval: 30000,
  });
  const save = useMutation({
    mutationFn: (value: EnvironmentPolicy) =>
      api<EnvironmentSettingsView>(url, {
        method: "PUT",
        body: JSON.stringify(value),
      }),
    onSuccess: (value) => {
      client.setQueryData(key, value);
      setDrafts((previous) => ({ ...previous, [channel]: undefined }));
      void client.invalidateQueries({ queryKey: ["environment-history"] });
    },
  });
  const view = query.data;

  return (
    <div className="ag-notification-schedule">
      {embedded ? (
        <div className="ag-schedule-header">
          <h2>Lịch thông báo môi trường &amp; kết nối</h2>
          <Link to="/app/notifications?view=environment">
            Xem lịch sử tin môi trường
          </Link>
        </div>
      ) : (
        <PageTitle title="Thông báo môi trường & kết nối">
          <Link to="/app/notifications?view=environment">
            Xem lịch sử tin môi trường
          </Link>
        </PageTitle>
      )}
      <div className="ag-schedule-channels" role="group" aria-label="Kênh gửi">
        {channels
          .filter(({ id }) => id === "webpush" || user.role === "admin")
          .map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={channel === id}
              disabled={save.isPending}
              onClick={() => {
                setChannel(id);
                save.reset();
              }}
            >
              <Icon size={18} aria-hidden="true" /> {label}
            </button>
          ))}
      </div>
      <LoadState
        pending={query.isPending}
        error={query.error ?? save.error}
        retry={() => void query.refetch()}
      />
      {save.isSuccess ? (
        <p className="notice" role="status">
          Đã lưu cài đặt.
        </p>
      ) : null}
      {view ? (
        <>
          <div className="ag-schedule-channel-status">
            <p className="caption">
              {channel === "telegram"
                ? "Áp dụng cho nhóm Telegram do quản trị viên cấu hình."
                : "Áp dụng cho các trình duyệt đã đăng ký của tài khoản bạn."}
            </p>
            {channel === "telegram" && view.channel_ready ? (
              <p className="badge success">Telegram đã có đích gửi</p>
            ) : null}
            {!view.channel_ready ? (
              <p className="notice">
                {channel === "telegram"
                  ? "Backend chưa cấu hình đích Telegram."
                  : "Chưa có đăng ký Web Push hợp lệ. Hãy bật Web Push trong tab Cảnh báo trình duyệt."}
              </p>
            ) : null}
            {!view.simulator_allowed_by_server ? (
              <p className="caption">
                Máy chủ chưa cho phép gửi dữ liệu mô phỏng qua Telegram.
              </p>
            ) : null}
            {view.next_digest_at ? (
              <p className="caption">
                Bản tin tiếp theo theo lịch{" "}
                {new Intl.DateTimeFormat("vi-VN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: view.policy.timezone,
                }).format(new Date(view.next_digest_at))}{" "}
                ({view.policy.timezone})
              </p>
            ) : null}
          </div>
          <PolicyForm
            key={channel}
            devices={devices}
            draft={drafts[channel] ?? view.policy}
            pending={save.isPending}
            onChange={(draft) =>
              setDrafts((previous) => ({ ...previous, [channel]: draft }))
            }
            onSave={(draft) => save.mutate(draft)}
          />
        </>
      ) : null}
    </div>
  );
}
