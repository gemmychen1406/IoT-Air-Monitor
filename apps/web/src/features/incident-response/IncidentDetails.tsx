import { Link } from 'react-router';
import type { IncidentDetail, UserView } from '@iot/contracts';
import { PageTitle, dateText } from '../../components/FeatureUI.js';
import { IncidentSupportContent } from './IncidentSupport.js';
import {
  incidentLocationText,
  useIncidentSupport,
} from './incident-support.js';
import {
  IncidentReceiptAction,
  IncidentReceiptTeam,
  useIncidentReceipt,
} from './IncidentReceipt.js';
import { IncidentDeliveryHistory } from '../notification-center/DeliveryHistoryPage.js';

export function IncidentDetails({ incident, user }: { incident: IncidentDetail; user: UserView }) {
  const receipt = useIncidentReceipt(incident.id, user.id);
  const support = useIncidentSupport(incident.id);
  const location = support.isSuccess ? support.data.location : undefined;
  return (
    <>
      <PageTitle
        title={
          { gas: 'Cảnh báo khí ga', co: 'Cảnh báo khí CO', flame: 'Phát hiện lửa' }[
            incident.condition
          ]
        }
      >
        <div className="button-row">
          <span className={`badge ${incident.severity === 'critical' ? 'danger' : ''}`}>
            {incident.severity.toUpperCase()}
          </span>
          <span className={`badge ${incident.status === 'active' ? 'danger' : ''}`}>
            {incident.status === 'active' ? 'Chưa kết thúc' : 'Đã kết thúc'}
          </span>
          {incident.source_kind === 'simulator' ? (
            <span className="badge simulation">Dữ liệu mô phỏng</span>
          ) : null}
        </div>
        <p>
          <strong>Vị trí hiện tại </strong>
          {location
            ? incidentLocationText(location)
            : support.isPending
              ? 'Đang tải…'
              : 'Chưa xác minh được vị trí'}
        </p>
        <p><strong>Thiết bị </strong><Link to={`/app/devices/${incident.device_id}`}>{incident.device_name}</Link></p>

        <IncidentReceiptAction {...receipt} />
      </PageTitle>
      <IncidentTimeline incident={incident} />
      <IncidentDeliveryHistory incidentId={incident.id} user={user} />
      <IncidentReceiptTeam receipts={receipt.receipts} />
      <IncidentSupportContent support={support} />
    </>
  );
}

function IncidentTimeline({ incident }: { incident: IncidentDetail }) {
  const events = incident.events ?? [];
  const start = incident.started_at ?? events.find((e) => e.transition === 'started')?.occurred_at;
  const end = incident.ended_at ?? events.find((e) => e.transition === 'ended')?.occurred_at;
  const seconds = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 1000) : NaN;
  return (
    <section className="panel feature-section">
      <h2>Diễn biến sự cố</h2>
      <p>Bắt đầu · {start ? `Giờ thiết bị ${dateText(start)}` : 'Chưa có thời điểm thiết bị'}</p>
      <p>Phục hồi · {end ? `Giờ thiết bị ${dateText(end)}` : 'Chưa có thời điểm thiết bị'}</p>
      {seconds >= 0 && (
        <p>
          Thời lượng · {Math.floor(seconds / 60)} phút {seconds % 60} giây
        </p>
      )}
      <details>
        <summary>Chi tiết kỹ thuật</summary>
        <p>ID · {incident.id}</p>
        <p>Nguồn · {incident.origin}</p>
        <p>Server quan sát đầu tiên · {dateText(incident.first_observed_at)}</p>
        {events.map((e) => (
          <p key={e.id}>
            {e.transition === 'started' ? 'Bắt đầu' : 'Phục hồi'} · Server nhận{' '}
            {dateText(e.received_at)} · seq {e.seq}
          </p>
        ))}
      </details>
    </section>
  );
}
