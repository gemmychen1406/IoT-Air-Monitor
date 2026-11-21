import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IncidentDetail, UserView } from '@iot/contracts';
import { api } from '../lib/api.js';
import { LoadState, dateText } from '../components/FeatureUI.js';
import { IncidentDetails } from '../features/incident-response/IncidentDetails.js';

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
      <Link to={detail.data ? `/app/alerts?device_id=${detail.data.device_id}` : '/app/alerts'}>
        ← Danh sách sự cố
      </Link>
      <LoadState
        pending={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}
      />
      {incident ? (
        <>
          <IncidentDetails key={`${incident.id}:${user.id}`} incident={incident} user={user} />
          <p className="caption">Chưa thấy kết thúc chưa chắc là còn nguy hiểm, hãy kiểm tra kết nối thiết bị. Xác nhận đã xem không tắt còi.</p>
          <section className="panel feature-section">
            <h2>Xác nhận nghiệp vụ</h2>
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
        </>
      ) : null}
    </>
  );
}
