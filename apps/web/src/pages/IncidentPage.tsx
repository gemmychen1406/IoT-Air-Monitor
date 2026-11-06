import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IncidentDetail, UserView } from '@iot/contracts';
import { api } from '../lib/api.js';
import { PageTitle, LoadState, dateText, conditionText } from '../components/FeatureUI.js';

export default function IncidentPage({ user }: { user: UserView }) {
  const { id } = useParams();
  const client = useQueryClient();
  const [note, setNote] = useState('');
  const detail = useQuery({
    queryKey: ['incident', id],
    queryFn: () => api<IncidentDetail>(`/alerts/incidents/${id}`),
    refetchInterval: 10000,
  });
  const acknowledge = useMutation({
    mutationFn: () =>
      api(`/alerts/incidents/${id}/acknowledgements`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['incident', id] }),
        client.invalidateQueries({ queryKey: ['incidents'] }),
      ]);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    acknowledge.mutate();
  }
  const incident = detail.data;
  return (
    <>
      <Link to="/app/alerts">← Danh sách sự cố</Link>
      <LoadState
        pending={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}
      />
      {incident ? (
        <>
          <PageTitle
            eyebrow="INCIDENT DETAIL"
            title={`Sự cố ${conditionText[incident.condition]} · ${incident.device_name}`}
          >
            <p>ID: {incident.id}</p>
          </PageTitle>
          <section className="panel feature-section">
            <div className="button-row">
              <span className={`badge ${incident.status === 'active' ? 'danger' : ''}`}>
                {incident.status === 'active' ? 'Chưa kết thúc' : 'Đã kết thúc'}
              </span>
              <span className="badge">{incident.severity}</span>
              {incident.source_kind === 'simulator' ? (
                <span className="badge simulation">Dữ liệu mô phỏng</span>
              ) : null}
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Bắt đầu</dt>
                <dd>{dateText(incident.started_at)}</dd>
              </div>
              <div>
                <dt>Kết thúc</dt>
                <dd>{dateText(incident.ended_at)}</dd>
              </div>
              <div>
                <dt>Server quan sát đầu tiên</dt>
                <dd>{dateText(incident.first_observed_at)}</dd>
              </div>
              <div>
                <dt>Nguồn lịch sử</dt>
                <dd>{incident.origin}</dd>
              </div>
            </dl>
            <p className="caption">
              Chưa có sự kiện kết thúc không đồng nghĩa thiết bị vẫn đang đo được nguy hiểm. Kiểm
              tra kết nối và chất lượng dữ liệu. Xác nhận đã xem không tắt còi.
            </p>
          </section>
          <section className="panel feature-section">
            <h2>Xác nhận sự cố</h2>
            {incident.acknowledgement ? (
              <>
                <strong>Đã xác nhận</strong>
                <p>
                  {incident.acknowledgement.user.email} ·{' '}
                  {dateText(incident.acknowledgement.acknowledged_at)}
                </p>
                <p>{incident.acknowledgement.note || 'Không có ghi chú.'}</p>
              </>
            ) : user.role === 'viewer' ? (
              <p className="muted">Chỉ operator/admin được xác nhận đã xem sự cố.</p>
            ) : (
              <form onSubmit={submit} className="stack-form">
                <label>
                  Ghi chú xác nhận
                  <textarea
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={acknowledge.isPending}>
                  Xác nhận đã xem
                </button>
              </form>
            )}
            <LoadState error={acknowledge.error} />
          </section>
          <section className="panel feature-section">
            <h2>Timeline sự kiện</h2>
            <ol className="timeline">
              {incident.events.map((event) => (
                <li key={event.id}>
                  <strong>{event.transition === 'started' ? 'Bắt đầu' : 'Kết thúc'}</strong>
                  <p>Thời điểm thiết bị: {dateText(event.occurred_at)}</p>
                  <small>
                    Server nhận: {dateText(event.received_at)} · seq {event.seq}
                  </small>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </>
  );
}
