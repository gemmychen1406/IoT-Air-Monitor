import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, CheckCircle2, Monitor, RefreshCw } from "lucide-react";
import type { PushConfigView, PushSubscriptionView } from "@iot/contracts";
import { api } from "../lib/api.js";
import {
  supportsWebPush,
  browserPushStatus,
  enableBrowserPush,
  disableBrowserPush,
} from "../lib/web-push.js";
import { LoadState } from "./FeatureUI.js";

export function PushSettings({
  devices = [],
}: { devices?: { id: string; name: string }[] } = {}) {
  const [selectedDevices, setSelectedDevices] = useState<string[]>();
  const [choice, setChoice] = useState<boolean>();
  const supported = supportsWebPush();
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["web-push-settings"],
    queryFn: async () => {
      const config = await api<PushConfigView>("/push/config");
      if (!config.enabled) return { config, server: null, local: null };
      const [server, local] = await Promise.all([
        api<PushSubscriptionView | null>("/push/subscription"),
        browserPushStatus(),
      ]);
      return { config, server, local };
    },
  });
  const includeSimulators =
    choice ?? settings.data?.server?.include_simulators ?? false;
  const deviceIds = selectedDevices ?? settings.data?.server?.device_ids ?? [];
  const refreshSettings = () =>
    Promise.all([
      settings.refetch(),
      client.invalidateQueries({ queryKey: ["environment-settings"] }),
    ]);
  const enable = useMutation({
    mutationFn: () =>
      enableBrowserPush(
        settings.data!.config.public_key!,
        includeSimulators,
        deviceIds,
      ),
    onSuccess: refreshSettings,
  });
  const disable = useMutation({
    mutationFn: disableBrowserPush,
    onSuccess: refreshSettings,
  });
  const active =
    !!settings.data?.server &&
    !!settings.data?.local &&
    settings.data.server.endpoint_hash === settings.data.local.endpointHash &&
    settings.data.server.vapid_public_key === settings.data.config.public_key &&
    settings.data.local.publicKey === settings.data.config.public_key;
  const busy = enable.isPending || disable.isPending;
  const denied = supported && Notification.permission === "denied";

  return (
    <section className="panel ag-notification-card" aria-label="Web Push">
      <div className="ag-notification-card-heading">
        <span className="ag-notification-icon">
          <Bell size={22} aria-hidden="true" />
        </span>
        <div>
          <h2>Thông báo Web Push</h2>
          <p className="caption">Nhận cảnh báo sự cố trên trình duyệt này.</p>
        </div>
      </div>
      <LoadState
        pending={settings.isPending}
        error={settings.error ?? enable.error ?? disable.error}
        retry={settings.isError ? () => void settings.refetch() : undefined}
      />
      {!supported ? (
        <p className="notice">
          Trình duyệt hoặc địa chỉ này chưa hỗ trợ Web Push. Hãy mở web bằng
          HTTPS hoặc localhost trên trình duyệt có hỗ trợ.
        </p>
      ) : null}
      {settings.data && !settings.data.config.enabled ? (
        <p className="notice">
          Backend chưa bật Web Push. Liên hệ quản trị viên để cấu hình VAPID và
          khởi động lại API.
        </p>
      ) : null}
      {settings.data?.config.enabled && supported ? (
        <>
          <div className="ag-push-status" data-active={active} role="status">
            {active ? (
              <CheckCircle2 size={22} aria-hidden="true" />
            ) : (
              <Monitor size={22} aria-hidden="true" />
            )}
            <span>
              {active
                ? "Đang nhận thông báo trên trình duyệt này"
                : "Chưa đăng ký nhận thông báo cho trình duyệt này"}
            </span>
          </div>
          {denied ? (
            <p className="notice">
              Quyền thông báo đang bị chặn. Mở quyền của trang trong trình
              duyệt, chọn Cho phép rồi tải lại trang.
            </p>
          ) : null}
          <div className="ag-notification-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || denied}
              onClick={() => enable.mutate()}
            >
              <Bell size={18} aria-hidden="true" />
              {enable.isPending
                ? "Đang lưu…"
                : active
                  ? "Lưu tùy chọn"
                  : "Bật Web Push"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => disable.mutate()}
            >
              <BellOff size={18} aria-hidden="true" />{" "}
              {disable.isPending ? "Đang tắt…" : "Tắt Web Push"}
            </button>
            <button
              type="button"
              disabled={busy || settings.isFetching}
              onClick={() => void settings.refetch()}
            >
              <RefreshCw size={17} aria-hidden="true" />{" "}
              {settings.isFetching ? "Đang kiểm tra…" : "Kiểm tra lại"}
            </button>
          </div>
          <fieldset className="ag-push-options" disabled={busy}>
            <legend className="sr-only">Tùy chọn nhận cảnh báo</legend>
            {devices.length > 0 ? (
              <details className="ag-notification-disclosure">
                <summary>
                  Thiết bị nhận cảnh báo{" "}
                  <span className="ag-notification-count">
                    {deviceIds.length || "Tất cả"}
                  </span>
                </summary>
                <p className="caption">Để trống để nhận từ tất cả thiết bị.</p>
                <div className="ag-push-devices">
                  {devices.map((device) => (
                    <label className="check-label" key={device.id}>
                      <input
                        type="checkbox"
                        checked={deviceIds.includes(device.id)}
                        onChange={(event) =>
                          setSelectedDevices(
                            event.target.checked
                              ? [...deviceIds, device.id]
                              : deviceIds.filter((id) => id !== device.id),
                          )
                        }
                      />{" "}
                      {device.name}
                    </label>
                  ))}
                </div>
              </details>
            ) : null}
            <label className="check-label ag-notification-option">
              <input
                type="checkbox"
                checked={includeSimulators}
                onChange={(event) => setChoice(event.target.checked)}
              />{" "}
              Nhận cả cảnh báo mô phỏng
            </label>
          </fieldset>
        </>
      ) : null}
      <details className="ag-notification-disclosure ag-push-help">
        <summary>Yêu cầu trình duyệt và cách nhận</summary>
        <p>
          Cảnh báo mức Warning và Critical có thể đến khi đóng tab nếu trình
          duyệt và hệ điều hành hỗ trợ. Còi cục bộ vẫn hoạt động theo thiết bị.
        </p>
        <p>
          Trình duyệt chỉ xin quyền khi bạn bấm bật. Đổi khóa VAPID cần đăng ký
          lại. Bạn cần đăng nhập để mở chi tiết sự cố.
        </p>
        {active ? (
          <p>
            {settings.data?.server?.expires_at
              ? "Đăng ký cũ theo phiên. Bấm Lưu tùy chọn để chuyển sang nhận lâu dài."
              : "Tắt Web Push hoặc đăng xuất để ngắt đăng ký trên trình duyệt này."}
          </p>
        ) : null}
      </details>
    </section>
  );
}
