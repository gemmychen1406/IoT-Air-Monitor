import { useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { DeviceView, IncidentView } from '@iot/contracts';
import { apiPage } from '../lib/api.js';
import { PageTitle, LoadState, dateText, conditionText } from '../components/FeatureUI.js';

export default function AlertsPage({ devices }: { devices: DeviceView[] }) {
  const [filters, setFilters] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['incidents', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<IncidentView[]>(
        `/alerts/incidents?limit=30&${filters}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    refetchInterval: 10000,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    for (const key of ['device_id', 'condition', 'severity', 'status', 'acknowledged'])
      if (data.get(key)) query.set(key, String(data.get(key)));
    for (const key of ['from', 'to'])
      if (data.get(key)) query.set(key, new Date(String(data.get(key))).toISOString());
    setFilters(query.toString());
  }
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <PageTitle eyebrow="INCIDENT MANAGEMENT" title="Cảnh báo & sự cố">
        <p>
          Lịch sử có bắt đầu/kết thúc và xác nhận độc lập. Mất Internet hoặc acknowledge không đóng
          sự cố.
        </p>
      </PageTitle>
      <form className="panel filter-grid" onSubmit={submit}>
        <label>
          Thiết bị
          <select name="device_id">
            <option value="">Tất cả</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Điều kiện
          <select name="condition">
            <option value="">Tất cả</option>
            <option value="gas">Gas</option>
            <option value="co">CO</option>
            <option value="flame">Flame</option>
          </select>
        </label>
        <label>
          Trạng thái
          <select name="status">
            <option value="">Tất cả</option>
            <option value="active">Chưa kết thúc</option>
            <option value="ended">Đã kết thúc</option>
          </select>
        </label>
        <label>
          Mức độ
          <select name="severity">
            <option value="">Tất cả</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>
          Xác nhận
          <select name="acknowledged">
            <option value="">Tất cả</option>
            <option value="false">Chưa xác nhận</option>
            <option value="true">Đã xác nhận</option>
          </select>
        </label>
        <label>
          Từ thời điểm
          <input name="from" type="datetime-local" />
        </label>
        <label>
          Đến thời điểm
          <input name="to" type="datetime-local" />
        </label>
        <button className="primary">Lọc sự cố</button>
      </form>
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
      <p className="caption">
        Nguồn snapshot chỉ phát hiện các chuyển trạng thái đã quan sát. Event có ID ổn định giúp
        khôi phục sự cố ngắn xảy ra khi offline. Không diễn giải mức độ thành nồng độ khí.
      </p>
    </>
  );
}
