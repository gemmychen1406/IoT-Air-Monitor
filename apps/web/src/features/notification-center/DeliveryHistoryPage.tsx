import { useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import {
  deliveryStatuses,
  type DeliveryHistoryView,
  type DeviceView,
  type UserView,
} from '@iot/contracts';
import { conditionText, dateText, LoadState, PageTitle } from '../../components/FeatureUI.js';
import { apiPage } from '../../lib/api.js';
import { EnvironmentHistory } from './EnvironmentHistory.js';
import './styles.css';

const statusLabels = {
  pending: 'Đang chờ',
  sending: 'Đang thử gửi',
  sent: 'Dịch vụ đã chấp nhận',
  failed: 'Gửi thất bại',
  expired: 'Hết hạn',
  skipped: 'Đã bỏ qua',
};
const attemptLabels: Record<string, string> = {
  ...statusLabels,
  retry: 'Lỗi, chờ thử lại',
  unknown: 'Chưa rõ kết quả lần gửi',
};

function deliveryStatus(row: DeliveryHistoryView) {
  return row.status === 'pending' && row.attempt_count && row.last_error_code
    ? 'Lỗi, chờ thử lại'
    : statusLabels[row.status];
}

function DeliveryItem({ row, scoped }: { row: DeliveryHistoryView; scoped: boolean }) {
  const label = (
    <strong>
      {conditionText[row.condition]} · {row.device_name}
    </strong>
  );
  return (
    <li className="panel ag-delivery-row">
      <div>
        {scoped ? label : <Link to={`/app/alerts/${row.incident_id}`}>{label}</Link>}
        <p>
          {row.channel === 'telegram' ? 'Telegram' : 'Web Push'} · {row.severity.toUpperCase()} ·{' '}
          {row.round ? `Nhắc lần ${row.round} · ` : ''} {dateText(row.created_at)}
        </p>
        <p>
          {row.simulator ? 'Mô phỏng' : 'Thiết bị thật'} ·{' '}
          {row.ended ? 'Sự cố đã kết thúc' : 'Sự cố chưa kết thúc'}
        </p>
        <p>
          {row.location_source === 'legacy' ? (
            'Bản ghi cũ chưa có vị trí lưu lúc tạo tin'
          ) : (
            <>
              Vị trí lúc tạo thông báo · <span>{row.location || 'Chưa có thông tin vị trí'}</span>
            </>
          )}
        </p>
      </div>
      <div>
        <strong>{deliveryStatus(row)}</strong>
        <p>{row.accepted_at ? dateText(row.accepted_at) : row.last_error_code}</p>
        {row.status === 'pending' && row.attempt_count > 0 ? (
          <p>Thử lại từ {dateText(row.next_attempt_at)}</p>
        ) : null}
        {scoped ? null : (
          <p>
            {row.my_receipt
              ? `Bạn đã xác nhận tiếp nhận · ${dateText(row.my_receipt.received_at)}${row.my_receipt.late ? ' · Tiếp nhận muộn' : ''}`
              : 'Bạn chưa xác nhận tiếp nhận'}
          </p>
        )}
        <details>
          <summary>{row.attempt_count} lần thử gửi</summary>
          {row.attempts.length < row.attempt_count ? (
            <p>Một số lần thử cũ thiếu dữ liệu chi tiết.</p>
          ) : null}
          {row.attempts.length ? (
            <ul>
              {row.attempts.map((attempt) => (
                <li key={attempt.number}>
                  Lần {attempt.number} · {attemptLabels[attempt.outcome] ?? attempt.outcome} ·{' '}
                  {dateText(attempt.started_at)}
                  {attempt.finished_at ? ` → ${dateText(attempt.finished_at)}` : ''}
                  {attempt.error_code ? ` · ${attempt.error_code}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      </div>
    </li>
  );
}

function IncidentTargets({ rows }: { rows: DeliveryHistoryView[] }) {
  const groups = new Map<string, DeliveryHistoryView[]>();
  for (const row of rows) {
    const key = row.channel === 'telegram' ? 'telegram' : (row.target_id ?? row.id);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return (
    <ul className="ag-delivery-list">
      {Array.from(groups, ([key, deliveries]) => {
        const latest = deliveries[0]!;
        return (
          <li key={key}>
            <details>
              <summary>
                {key === 'telegram' ? 'Nhóm Telegram' : `Web Push · ${key.slice(0, 8)}`} ·{' '}
                {deliveryStatus(latest)} · {dateText(latest.accepted_at ?? latest.created_at)}
              </summary>
              {deliveries.map((row) => (
                <div key={row.id}>
                  <strong>
                    {row.round ? `Nhắc lần ${row.round}` : 'Lượt ban đầu'} · {deliveryStatus(row)}
                  </strong>
                  <p>
                    Vị trí lúc tạo thông báo · {row.location || 'Chưa ghi nhận'} ·{' '}
                    {dateText(row.created_at)}
                  </p>
                  {row.last_error_code && <p>{row.last_error_code}</p>}
                  {row.attempts.length < row.attempt_count && (
                    <small>Một số lần thử cũ thiếu dữ liệu chi tiết.</small>
                  )}
                  {row.attempts.map((a) => (
                    <p key={a.number}>
                      Lần thử {a.number} · {attemptLabels[a.outcome] ?? a.outcome} ·{' '}
                      {dateText(a.started_at)} {a.error_code}
                    </p>
                  ))}
                </div>
              ))}
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function DeliveryList({
  query,
  user,
  scoped = false,
}: {
  query: string;
  user: UserView;
  scoped?: boolean;
}) {
  const history = useInfiniteQuery({
    queryKey: ['delivery-history', user.id, query],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(query);
      if (pageParam) params.set('cursor', pageParam);
      return apiPage<DeliveryHistoryView[]>(`/alerts/delivery-history?${params}`);
    },
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    refetchInterval: 10000,
  });
  const rows = history.isSuccess ? history.data.pages.flatMap((page) => page.data) : [];
  return (
    <>
      <LoadState
        pending={history.isPending}
        error={history.error}
        retry={() => void history.refetch()}
      />
      {history.isSuccess && !rows.length ? (
        <p className="muted">Chưa có lượt gửi phù hợp.</p>
      ) : null}
      {scoped && rows.length > 0 ? (
        <IncidentTargets rows={rows} />
      ) : rows.length ? (
        <ul className="ag-delivery-list">
          {rows.map((row) => (
            <DeliveryItem key={row.id} row={row} scoped={scoped} />
          ))}
        </ul>
      ) : null}
      {history.hasNextPage ? (
        <button disabled={history.isFetching} onClick={() => void history.fetchNextPage()}>
          Xem thêm lượt gửi
        </button>
      ) : null}
    </>
  );
}

export function IncidentDeliveryHistory({
  incidentId,
  user,
}: {
  incidentId: string;
  user: UserView;
}) {
  return (
    <section className="panel feature-section" aria-label="Lịch sử gửi của sự cố">
      <h2>Lịch sử gửi của sự cố</h2>
      <DeliveryList
        user={user}
        query={new URLSearchParams({ incident_id: incidentId }).toString()}
        scoped
      />
    </section>
  );
}

function IncidentHistory({ devices, user }: { devices: DeviceView[]; user: UserView }) {
  const [query, setQuery] = useState('');
  const [filterError, setFilterError] = useState('');
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(event.currentTarget)) {
      if (!value) continue;
      if (name === 'from' || name === 'to') {
        const date = new Date(String(value));
        if (!Number.isFinite(date.getTime())) {
          setFilterError('Thời gian lọc không hợp lệ.');
          return;
        }
        params.set(name, date.toISOString());
      } else {
        params.set(name, String(value));
      }
    }
    const from = params.get('from');
    const to = params.get('to');
    if (from && to && from >= to) {
      setFilterError('Thời điểm bắt đầu phải trước thời điểm kết thúc.');
      return;
    }
    setFilterError('');
    setQuery(params.toString());
  }
  return (
    <>
      <PageTitle title="Lịch sử gửi">
        <p>
          {user.role === 'admin'
            ? 'Web Push của bạn và Telegram của workspace.'
            : 'Lịch sử Web Push của tài khoản bạn.'}
        </p>
      </PageTitle>
      <form className="panel feature-section ag-delivery-filters" onSubmit={filter}>
        <label>
          Loại cảnh báo
          <select name="condition">
            <option value="">Tất cả</option>
            {Object.entries(conditionText).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kênh
          <select name="channel">
            <option value="">Tất cả</option>
            <option value="webpush">Web Push</option>
            {user.role === 'admin' ? <option value="telegram">Telegram</option> : null}
          </select>
        </label>
        <label>
          Thiết bị
          <select name="device_id">
            <option value="">Tất cả</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trạng thái gửi
          <select name="status">
            <option value="">Tất cả</option>
            {deliveryStatuses.map((value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Từ (giờ máy)
          <input name="from" type="datetime-local" />
        </label>
        <label>
          Đến (giờ máy)
          <input name="to" type="datetime-local" />
        </label>
        <button className="primary">Áp dụng bộ lọc</button>
      </form>
      {filterError ? (
        <p className="notice error" role="alert">
          {filterError}
        </p>
      ) : null}
      <DeliveryList user={user} query={query} />
    </>
  );
}

export default function DeliveryHistoryPage(props: { devices: DeviceView[]; user: UserView }) {
  const [params] = useSearchParams();
  const environment = params.get('view') === 'environment';
  return (
    <>
      <nav className="button-row" aria-label="Loại lịch sử gửi">
        <Link to="/app/notifications" aria-current={!environment ? 'page' : undefined}>
          Cảnh báo sự cố
        </Link>
        <Link
          to="/app/notifications?view=environment"
          aria-current={environment ? 'page' : undefined}
        >
          Tin môi trường & kết nối
        </Link>
      </nav>
      {environment ? (
        <EnvironmentHistory {...props} labels={statusLabels} attemptLabels={attemptLabels} />
      ) : (
        <IncidentHistory {...props} />
      )}
    </>
  );
}
