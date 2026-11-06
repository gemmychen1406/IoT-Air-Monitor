import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, KeyRound, Plus } from 'lucide-react';
import type { DeviceView, UserView } from '@iot/contracts';
import { api } from '../lib/api.js';
import { PageTitle, LoadState, dateText } from '../components/FeatureUI.js';
import { IssuedKey, type IssuedCredential } from '../components/IssuedKey.js';

const statusText = { online: 'Online', offline: 'Offline', never_seen: 'Chưa kết nối' };
export default function DevicesPage({ devices, user }: { devices: DeviceView[]; user: UserView }) {
  const client = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const all = useQuery({
    queryKey: ['devices', user.id, 'all'],
    queryFn: () => api<DeviceView[]>('/devices?archived=all'),
    enabled: showArchived,
    refetchInterval: 10000,
  });
  const rows = showArchived ? (all.data ?? []) : devices;
  const create = useMutation({
    mutationFn: (input: { name: string; source_kind: string }) =>
      api('/devices', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['devices'] }),
  });
  const issue = useMutation({
    mutationFn: async (deviceId: string) => ({
      ...(await api<{ key: string; key_id: string }>(`/devices/${deviceId}/credentials`, {
        method: 'POST',
      })),
      deviceId,
    }),
    onSuccess: setIssued,
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    create.mutate(
      { name: String(data.get('name')), source_kind: String(data.get('source_kind')) },
      { onSuccess: () => form.reset() },
    );
  }
  return (
    <>
      <PageTitle eyebrow="DEVICE MANAGEMENT" title="Thiết bị">
        <p>
          Metadata, credentials, cấu hình có version và lịch sử kết nối. Source chỉ định lúc đăng
          ký, không đổi nhãn dữ liệu cũ.
        </p>
      </PageTitle>
      {user.role === 'admin' ? (
        <form className="panel inline-form" onSubmit={submit}>
          <label>
            Tên thiết bị
            <input name="name" required maxLength={80} placeholder="Ví dụ: Phòng thí nghiệm 01" />
          </label>
          <label>
            Nguồn dữ liệu
            <select name="source_kind">
              <option value="simulator">Simulator — dữ liệu mô phỏng</option>
              <option value="physical">Thiết bị thật</option>
            </select>
          </label>
          <button className="primary" disabled={create.isPending}>
            <Plus size={16} />
            Thêm thiết bị
          </button>
        </form>
      ) : null}
      <LoadState error={create.error ?? issue.error} />
      {issued ? <IssuedKey issued={issued} close={() => setIssued(null)} /> : null}
      <label className="check-label">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Hiển thị cả thiết bị lưu trữ
      </label>
      {showArchived ? (
        <LoadState pending={all.isPending} error={all.error} retry={() => void all.refetch()} />
      ) : null}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thiết bị</th>
              <th>Vị trí</th>
              <th>Nguồn</th>
              <th>Kết nối</th>
              <th>Liên lạc cuối</th>
              <th>Credential</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`/app/devices/${d.id}`}>
                    <strong>{d.name}</strong>
                  </Link>
                  <small className="device-id">{d.id}</small>
                  {d.archived_at ? <span className="badge">Đã lưu trữ</span> : null}
                </td>
                <td>{d.location || '—'}</td>
                <td>
                  <span className={`badge ${d.source_kind === 'simulator' ? 'simulation' : ''}`}>
                    {d.source_kind === 'simulator' ? 'Mô phỏng' : 'Phần cứng'}
                  </span>
                </td>
                <td>
                  <span className={`status-dot ${d.status}`} />
                  {statusText[d.status]}
                </td>
                <td>{dateText(d.last_seen_at)}</td>
                <td>
                  {user.role === 'admin' ? (
                    <button
                      disabled={issue.isPending || !!issued || !!d.archived_at}
                      onClick={() => issue.mutate(d.id)}
                    >
                      <KeyRound size={15} />
                      Cấp key
                    </button>
                  ) : (
                    'Chỉ admin'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <div className="empty">
            <Cpu size={30} />
            <h3>Chưa có thiết bị</h3>
            <p>Thêm simulator để kiểm thử trước firmware.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
