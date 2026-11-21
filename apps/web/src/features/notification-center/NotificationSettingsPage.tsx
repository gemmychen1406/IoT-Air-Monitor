import { Link } from 'react-router';
import type { DeviceView, UserView } from '@iot/contracts';
import { PageTitle } from '../../components/FeatureUI.js';
import { PushSettings } from '../../components/PushSettings.js';
import EnvironmentSettingsPage from './EnvironmentSettingsPage.js';

export default function NotificationSettingsPage({
  devices,
  user,
}: {
  devices: DeviceView[];
  user: UserView;
}) {
  return (
    <>
      <Link to="/app/settings">← Cài đặt</Link>
      <PageTitle title="Thông báo">
        <Link to="/app/notifications">Xem lịch sử gửi</Link>
      </PageTitle>
      <PushSettings devices={devices} />
      <EnvironmentSettingsPage devices={devices} user={user} embedded />
    </>
  );
}
