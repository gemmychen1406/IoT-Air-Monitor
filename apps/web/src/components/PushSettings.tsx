import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PushConfigView, PushSubscriptionView } from '@iot/contracts';
import { api } from '../lib/api.js';
import {
  supportsWebPush,
  browserPushStatus,
  enableBrowserPush,
  disableBrowserPush,
} from '../lib/web-push.js';
import { LoadState } from './FeatureUI.js';
import PushPrivacyPreference from '../features/notification-center/PushPrivacyPreference.js';

export function PushSettings({ devices = [] }: {devices?: {id:string; name:string}[]} = {}) {
  const [selectedDevices, setSelectedDevices] = useState<string[]>();
  const [choice, setChoice] = useState<boolean | undefined>();
  const supported = supportsWebPush();
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ['web-push-settings'],
    queryFn: async () => {
      const config = await api<PushConfigView>('/push/config');
      if (!config.enabled) return { config, server: null, local: null };
      const [server, local] = await Promise.all([
        api<PushSubscriptionView | null>('/push/subscription'),
        browserPushStatus(),
      ]);
      return { config, server, local };
    },
  });
  const includeSimulators = choice ?? settings.data?.server?.include_simulators ?? false;
  const deviceIds = selectedDevices ?? settings.data?.server?.device_ids ?? [];
  const refreshSettings = () => Promise.all([
    settings.refetch(),
    client.invalidateQueries({ queryKey: ['environment-settings'] }),
  ]);
  const enable = useMutation({
    mutationFn: (permission: Promise<NotificationPermission>) =>
      enableBrowserPush(settings.data!.config.public_key!, includeSimulators, deviceIds, permission),
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
  return (
    <section className="panel feature-section" aria-label="Web Push">
      <h2>Thông báo Web Push</h2>
      <p>
        Để nhận cảnh báo trên thiết bị này, bấm Bật Web Push rồi chọn Cho phép khi trình duyệt hỏi.
        Lặp lại trên mỗi trình duyệt bạn muốn nhận tin. Có thể nhận khi đóng tab nếu hệ điều hành hỗ trợ.
      </p>
      <LoadState
        pending={settings.isPending}
        error={settings.error ?? enable.error ?? disable.error}
        retry={() => void settings.refetch()}
      />
      {!supported ? (
        <p className="notice">
          Trình duyệt hoặc ngữ cảnh này chưa hỗ trợ Web Push. Dùng HTTPS hoặc localhost trên trình
          duyệt hỗ trợ. Trên iPhone hoặc iPad từ phiên bản 16.4, chọn Chia sẻ → Thêm vào Màn hình
          chính, mở AirGuard từ biểu tượng vừa thêm rồi bật thông báo.
        </p>
      ) : null}
      {settings.data && !settings.data.config.enabled ? (
        <p className="notice">
          Backend chưa bật Web Push. Quản trị viên cần cấu hình VAPID trong .env và khởi động lại
          API.
        </p>
      ) : null}
      {settings.data?.config.enabled && supported ? (
        <>
          <p role="status">
            {active
              ? 'Đang nhận thông báo trên trình duyệt này'
              : 'Chưa đăng ký nhận thông báo cho trình duyệt này'}
          </p>
          {Notification.permission === 'denied' ? (
            <p className="notice">
              Quyền thông báo đang bị chặn. Mở quyền của website trong trình duyệt, cho phép rồi tải
              lại trang; ứng dụng không thể tự bỏ chặn.
            </p>
          ) : null}
          {devices.length > 0 && <details><summary>Thiết bị nhận cảnh báo · {deviceIds.length || 'Tất cả'}</summary>
            <p>Để trống để nhận từ tất cả thiết bị.</p>{devices.map(d => <label className="check-label" key={d.id}>
              <input type="checkbox" checked={deviceIds.includes(d.id)} onChange={e => setSelectedDevices(e.target.checked ? [...deviceIds,d.id] : deviceIds.filter(id => id !== d.id))}/>{d.name}
            </label>)}</details>}
          <label className="check-label">
            <input
              type="checkbox"
              checked={includeSimulators}
              onChange={(e) => setChoice(e.target.checked)}
            />
            Nhận cả cảnh báo mô phỏng
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={
                enable.isPending || disable.isPending || Notification.permission === 'denied'
              }
              onClick={() => {
                // Safari requires the permission prompt to originate in the button's click handler.
                const permission = Notification.permission === 'default'
                  ? Notification.requestPermission()
                  : Promise.resolve(Notification.permission);
                enable.mutate(permission);
              }}
            >
              {active ? 'Lưu tùy chọn Web Push' : 'Bật Web Push'}
            </button>
            <button
              disabled={enable.isPending || disable.isPending}
              onClick={() => disable.mutate()}
            >
              Tắt Web Push
            </button>
            <button onClick={() => void settings.refetch()}>Kiểm tra lại</button>
          </div>
          {active ? (
            <p className="caption">
              {settings.data.server?.expires_at ? 'Đăng ký cũ theo phiên. Bấm Lưu tùy chọn Web Push để chuyển sang nhận lâu dài.' : 'Vẫn nhận sau khi phiên hết hạn. Tắt Web Push hoặc đăng xuất để ngắt trình duyệt này.'}
            </p>
          ) : null}
        </>
      ) : null}
      <PushPrivacyPreference />
      <p className="caption">
        Chỉ xin quyền sau khi bạn bấm bật. Mở sự cố từ thông báo vẫn cần đăng nhập. Đổi khóa VAPID cần đăng ký
        lại. Hệ điều hành có thể chặn/hoãn thông báo; đóng hoàn toàn trình duyệt không bảo đảm nhận
        được.
      </p>
    </section>
  );
}
