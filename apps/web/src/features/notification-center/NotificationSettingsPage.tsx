import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { DeviceView, UserView } from '@iot/contracts';
import { LoadState, PageTitle } from '../../components/FeatureUI.js';
import { api } from '../../lib/api.js';
import { PushSettings } from '../../components/PushSettings.js';
import EnvironmentSettingsPage from './EnvironmentSettingsPage.js';

export default function NotificationSettingsPage({
  devices,
  user,
}: {
  devices: DeviceView[];
  user: UserView;
}) {
  const group = useQuery({
    queryKey: ['telegram-group', user.id],
    queryFn: () => api<{ enabled: boolean; invite_url: string | null }>('/telegram/group'),
  });
  return (
    <>
      <Link to="/app/settings">← Cài đặt</Link>
      <PageTitle title="Thông báo">
        <Link to="/app/notifications">Xem lịch sử gửi</Link>
      </PageTitle>
      <PushSettings devices={devices} />
      <section className="panel feature-section" aria-label="Telegram gia đình">
        <h2>Telegram gia đình</h2>
        <LoadState pending={group.isPending} error={group.error} retry={() => void group.refetch()} />
        {group.data && (!group.data.enabled ? <p>Gia đình chưa bật cảnh báo Telegram.</p>
          : <>
            <p>Cảnh báo được gửi vào nhóm chung của gia đình. Để nhận tin, hãy tham gia nhóm bằng tài khoản Telegram của bạn.</p>
            {group.data.invite_url
              ? <a href={group.data.invite_url} target="_blank" rel="noreferrer">Mở nhóm Telegram gia đình</a>
              : <p>Hãy liên hệ quản trị viên gia đình để được mời vào nhóm.</p>}
          </>)}
      </section>
      <EnvironmentSettingsPage devices={devices} user={user} embedded />
    </>
  );
}
