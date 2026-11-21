import { useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  environmentKindLabels, environmentKinds, deliveryStatuses,
  type DeviceView, type EnvironmentHistoryView, type UserView,
} from '@iot/contracts';
import { dateText, LoadState, PageTitle } from '../../components/FeatureUI.js';
import { apiPage } from '../../lib/api.js';

type Labels = Record<EnvironmentHistoryView['status'], string>;
const reasons: Record<string, string> = {
  QUIET_HOURS: 'Đang hoãn vì giờ yên lặng',
  CONNECTION_FLAPPED: 'Thiết bị đã phục hồi trước khi gửi tin mất kết nối',
  WAITING_FOR_OUTAGE: 'Đang chờ kết quả gửi tin mất kết nối',
  SUPERSEDED: 'Đã có tin mới hơn',
  NO_SUBSCRIPTION: 'Chưa có trình duyệt đăng ký phù hợp',
  CHANNEL_DISABLED: 'Kênh chưa sẵn sàng',
  PUSH_AUTH_REVOKED: 'Phiên hoặc đăng ký Web Push không còn hiệu lực',
  POLICY_OR_DEVICE_DISABLED: 'Cấu hình hoặc thiết bị đã tắt',
  OUTAGE_NOT_SENT: 'Tin mất kết nối chưa được gửi thành công',
  SIMULATOR_NOT_ALLOWED: 'Kênh không nhận dữ liệu mô phỏng',
};

export function EnvironmentHistory({ devices, user, labels, attemptLabels }: {
  devices: DeviceView[]; user: UserView; labels: Labels; attemptLabels: Record<string, string>;
}) {
  const [filters, setFilters] = useState('');
  const [error, setError] = useState('');
  const results = useInfiniteQuery({
    queryKey: ['environment-history', user.id, filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(filters);
      if (pageParam) params.set('cursor', pageParam);
      return apiPage<EnvironmentHistoryView[]>(`/environment/history?${params}`);
    },
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    refetchInterval: 10000,
  });
  const rows = results.data?.pages.flatMap((page) => page.data) ?? [];
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    for (const [name, raw] of new FormData(event.currentTarget)) {
      if (!raw) continue;
      if (name === 'from' || name === 'to') {
        const date = new Date(String(raw));
        if (!Number.isFinite(date.getTime())) { setError('Thời điểm lọc không hợp lệ.'); return; }
        query.set(name, date.toISOString());
      } else query.set(name, String(raw));
    }
    const from = query.get('from');
    const to = query.get('to');
    if (from && to && from >= to) { setError('Thời điểm bắt đầu phải trước thời điểm kết thúc.'); return; }
    setError('');
    setFilters(query.toString());
  }
  return <>
    <PageTitle title="Tin môi trường & kết nối">
      <Link to="/app/settings/notifications">Cài đặt thông báo</Link>
    </PageTitle>
    <form className="panel feature-section ag-delivery-filters" onSubmit={filter}>
      <label>Loại tin<select name="kind"><option value="">Tất cả</option>
        {environmentKinds.map((kind) => <option key={kind} value={kind}>{environmentKindLabels[kind]}</option>)}
      </select></label>
      <label>Kênh<select name="channel"><option value="">Tất cả</option>
        <option value="webpush">Web Push</option>
        {user.role === 'admin' ? <option value="telegram">Telegram</option> : null}
      </select></label>
      <label>Thiết bị<select name="device_id"><option value="">Tất cả</option>
        {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
      </select></label>
      <label>Trạng thái<select name="status"><option value="">Tất cả</option>
        {deliveryStatuses.map((status) => <option key={status} value={status}>{labels[status]}</option>)}
      </select></label>
      <label>Từ (giờ máy)<input name="from" type="datetime-local" /></label>
      <label>Đến (giờ máy)<input name="to" type="datetime-local" /></label>
      <button className="primary">Áp dụng bộ lọc</button>
    </form>
    {error ? <p role="alert" className="notice error">{error}</p> : null}
    <LoadState pending={results.isPending} error={results.error} retry={() => void results.refetch()} />
    {results.isSuccess && !rows.length ? <p className="panel feature-section">Chưa có lượt gửi phù hợp.</p> : null}
    <ul className="ag-delivery-list">{rows.map((row) => <li key={row.id} className="panel ag-delivery-row">
      <div>
        <strong>{environmentKindLabels[row.kind]} · {row.device_name}</strong>
        <p>{row.channel === 'telegram' ? 'Telegram' : 'Web Push'} · {row.simulator ? 'Mô phỏng' : 'Thiết bị thật'} · {dateText(row.occurred_at)}</p>
        {row.location ? <p>{row.location}</p> : null}
        <p>{row.summary}</p>
        <small>Mã tin: {row.id}</small>
      </div>
      <div>
        <strong>{row.status === 'pending' && row.attempts.at(-1)?.outcome === 'retry' ? 'Lỗi, chờ thử lại' : labels[row.status]}</strong>
        {row.last_error_code ? <p>{reasons[row.last_error_code] ?? row.last_error_code}</p> : null}
        {row.accepted_at ? <p>{dateText(row.accepted_at)}</p> : null}
        {row.status === 'pending' ? <p>Kiểm tra lại từ {dateText(row.next_attempt_at)}</p> : null}
        {row.attempts.length ? <details><summary>{row.attempts.length} lần thử gửi</summary><ul>
          {row.attempts.map((attempt) => <li key={attempt.number}>
            Lần {attempt.number} · {attemptLabels[attempt.outcome] ?? attempt.outcome} · {dateText(attempt.started_at)}
            {attempt.error_code ? ` · ${attempt.error_code}` : ''}
          </li>)}
        </ul></details> : null}
      </div>
    </li>)}</ul>
    {results.hasNextPage ? <button disabled={results.isFetching} onClick={() => void results.fetchNextPage()}>Xem thêm lượt gửi</button> : null}
  </>;
}
