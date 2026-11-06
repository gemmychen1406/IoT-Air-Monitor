import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { PushConfigView, PushSubscriptionView } from '@iot/contracts';
import { api } from '../lib/api.js';
import {
  supportsWebPush,
  browserPushStatus,
  enableBrowserPush,
  disableBrowserPush,
} from '../lib/web-push.js';
import { LoadState, dateText } from './FeatureUI.js';

export function PushSettings() {
  const [choice, setChoice] = useState<boolean | undefined>();
  const supported = supportsWebPush();
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
  const enable = useMutation({
    mutationFn: () => enableBrowserPush(settings.data!.config.public_key!, includeSimulators),
    onSuccess: () => settings.refetch(),
  });
  const disable = useMutation({
    mutationFn: disableBrowserPush,
    onSuccess: () => settings.refetch(),
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
        Cảnh báo warning/critical trên trình duyệt đã đăng ký; có thể nhận khi đóng tab nếu trình
        duyệt/hệ điều hành hỗ trợ. Không thay thế còi cục bộ.
      </p>
      <LoadState
        pending={settings.isPending}
        error={settings.error ?? enable.error ?? disable.error}
        retry={() => void settings.refetch()}
      />
      {!supported ? (
        <p className="notice">
          Trình duyệt hoặc ngữ cảnh này chưa hỗ trợ Web Push. Dùng HTTPS hoặc localhost trên trình
          duyệt hỗ trợ; HTTP qua IP LAN không đủ.
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
              : 'Chưa đăng ký nhận thông báo cho phiên này'}
          </p>
          {Notification.permission === 'denied' ? (
            <p className="notice">
              Quyền thông báo đang bị chặn. Mở quyền của website trong trình duyệt, cho phép rồi tải
              lại trang; ứng dụng không thể tự bỏ chặn.
            </p>
          ) : null}
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
              onClick={() => enable.mutate()}
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
              Hiệu lực tới khi phiên hết hạn: {dateText(settings.data.server?.expires_at)}. Đăng
              xuất hoặc thu hồi phiên sẽ hủy đăng ký; đăng nhập lại cần bật lại.
            </p>
          ) : null}
        </>
      ) : null}
      <p className="caption">
        Chỉ xin quyền sau khi bạn bấm bật. Thông báo màn hình khóa không chứa tên/vị trí thiết bị
        hay số đo; bấm để mở chi tiết, ứng dụng vẫn kiểm tra đăng nhập. Đổi khóa VAPID cần đăng ký
        lại. Hệ điều hành có thể chặn/hoãn thông báo; đóng hoàn toàn trình duyệt không bảo đảm nhận
        được.
      </p>
    </section>
  );
}
