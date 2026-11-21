import { useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import type { DeviceView, IncidentView } from '@iot/contracts';
import { apiPage } from '../lib/api.js';
import { PageTitle, LoadState, dateText, conditionText } from '../components/FeatureUI.js';

const fieldFilters = ['device_id', 'condition', 'severity', 'status', 'acknowledged'] as const;
const dateFilters = ['from', 'to'] as const;

function dateInputValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
}

export default function AlertsPage({ devices }: { devices: DeviceView[] }) {
  const [search, setSearch] = useSearchParams();
  const [filterError, setFilterError] = useState('');
  const params = new URLSearchParams();
  for (const name of [...fieldFilters, ...dateFilters]) {
    const value = search.get(name);
    if (value) params.set(name, value);
  }
  const filters = params.toString();
  const selectedDevice = params.get('device_id');
  const selectedDeviceExists = devices.some((device) => device.id === selectedDevice);
  const list = useInfiniteQuery({
    queryKey: ['incidents', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<IncidentView[]>(
        `/alerts/incidents?limit=30&${filters}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    refetchInterval: 10000,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const key of fieldFilters)
      if (data.get(key)) query.set(key, String(data.get(key)));
    for (const key of dateFilters) {
      const value = data.get(key);
      if (!value) continue;
      const date = new Date(String(value));
      if (!Number.isFinite(date.getTime())) {
        setFilterError('Thời gian lọc không hợp lệ.');
        return;
      }
      query.set(key, date.toISOString());
    }
    const from = query.get('from');
    const to = query.get('to');
    if ((from || to) && (!from || !to || from >= to)) {
      setFilterError('Chọn cả hai thời điểm và đặt thời điểm bắt đầu trước thời điểm kết thúc.');
      return;
    }
    setFilterError('');
    setSearch(query);
  }
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <PageTitle title="Cảnh báo & sự cố">
        <p>Lịch sử sự cố gas, CO và lửa.</p>
      </PageTitle>
      <form key={`${filters}:${selectedDeviceExists}`} className="panel filter-grid" onSubmit={submit}>
        <label>
          Thiết bị
          <select name="device_id" defaultValue={selectedDevice ?? ''}>
            <option value="">Tất cả</option>
            {selectedDevice && !selectedDeviceExists ? (
              <option value={selectedDevice}>Thiết bị đã chọn</option>
            ) : null}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Điều kiện
          <select name="condition" defaultValue={params.get('condition') ?? ''}>
            <option value="">Tất cả</option>
            <option value="gas">Gas</option>
            <option value="co">CO</option>
            <option value="flame">Flame</option>
          </select>
        </label>
        <label>
          Trạng thái
          <select name="status" defaultValue={params.get('status') ?? ''}>
            <option value="">Tất cả</option>
            <option value="active">Chưa kết thúc</option>
            <option value="ended">Đã kết thúc</option>
          </select>
        </label>
        <label>
          Mức độ
          <select name="severity" defaultValue={params.get('severity') ?? ''}>
            <option value="">Tất cả</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>
          Xác nhận
          <select name="acknowledged" defaultValue={params.get('acknowledged') ?? ''}>
            <option value="">Tất cả</option>
            <option value="false">Chưa xác nhận</option>
            <option value="true">Đã xác nhận</option>
          </select>
        </label>
        <label>
          Từ thời điểm
          <input name="from" type="datetime-local" defaultValue={dateInputValue(params.get('from'))} />
        </label>
        <label>
          Đến thời điểm
          <input name="to" type="datetime-local" defaultValue={dateInputValue(params.get('to'))} />
        </label>
        <button className="primary">Lọc sự cố</button>
      </form>
      {filterError ? <p role="alert">{filterError}</p> : null}
      <LoadState pending={list.isPending} error={list.error} retry={() => void list.refetch()} />
      {list.data ? (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thiết bị</th>
                <th>Điều kiện</th>
                <th>Mức độ</th>
                <th>Trạng thái</th>
                <th>Bắt đầu / nhận đầu tiên</th>
                <th>Xác nhận</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.device_name}
                    {i.source_kind === 'simulator' ? (
                      <span className="badge simulation">Mô phỏng</span>
                    ) : null}
                  </td>
                  <td>{conditionText[i.condition]}</td>
                  <td>
                    <span className={`badge ${i.severity === 'critical' ? 'danger' : ''}`}>
                      {i.severity}
                    </span>
                  </td>
                  <td>{i.status === 'active' ? 'Chưa kết thúc' : 'Đã kết thúc'}</td>
                  <td>
                    {dateText(i.started_at ?? i.first_observed_at)}
                    {!i.started_at ? (
                      <small className="device-id">
                        Thời điểm server quan sát, chưa biết lúc bắt đầu
                      </small>
                    ) : null}
                  </td>
                  <td>{i.acknowledgement ? 'Đã xác nhận' : 'Chưa xác nhận'}</td>
                  <td>
                    <Link to={`/app/alerts/${i.id}`}>Chi tiết</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <div className="empty">Không có sự cố phù hợp bộ lọc.</div> : null}
        </div>
      ) : null}
      {list.hasNextPage ? (
        <button
          className="load-more"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Tải thêm sự cố
        </button>
      ) : null}
    </>
  );
}
