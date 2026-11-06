import { useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditView, UserView } from '@iot/contracts';
import { apiPage } from '../lib/api.js';
import { PageTitle, LoadState, dateText } from '../components/FeatureUI.js';

export default function AuditPage({ user }: { user: UserView }) {
  const [filter, setFilter] = useState('');
  const logs = useInfiniteQuery({
    queryKey: ['audit', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<AuditView[]>(
        `/audit-logs?limit=30&${filter}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    enabled: user.role === 'admin',
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = new URLSearchParams();
    for (const [key, value] of new FormData(e.currentTarget)) if (value) q.set(key, String(value));
    setFilter(q.toString());
  }
  if (user.role !== 'admin') return <p role="alert">Chỉ admin được đọc nhật ký quản trị.</p>;
  return (
    <>
      <PageTitle eyebrow="AUDIT TRAIL" title="Nhật ký quản trị">
        <p>Lịch sử thay đổi và người thực hiện; không chứa raw key hoặc mật khẩu.</p>
      </PageTitle>
      <form className="panel filter-grid" onSubmit={submit}>
        <label>
          Loại tài nguyên
          <select name="resource_type">
            <option value="">Tất cả</option>
            <option value="user">Tài khoản</option>
            <option value="device">Thiết bị</option>
            <option value="maintenance">Bảo trì</option>
          </select>
        </label>
        <label>
          Resource ID
          <input name="resource_id" maxLength={100} />
        </label>
        <label>
          Hành động
          <input name="action" placeholder="Ví dụ: user.updated" maxLength={100} />
        </label>
        <button>Lọc nhật ký</button>
      </form>
      <LoadState pending={logs.isPending} error={logs.error} retry={() => void logs.refetch()} />
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Người thực hiện</th>
              <th>Hành động</th>
              <th>Tài nguyên</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.pages
              .flatMap((p) => p.data)
              .map((a) => (
                <tr key={a.id}>
                  <td>{dateText(a.created_at)}</td>
                  <td>{a.user?.email ?? 'Tác vụ hệ thống'}</td>
                  <td>{a.action}</td>
                  <td>
                    {a.resource_type}
                    <small className="device-id">{a.resource_id ?? '—'}</small>
                  </td>
                  <td>
                    <code>{JSON.stringify(a.metadata)}</code>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {logs.hasNextPage ? (
        <button
          className="load-more"
          disabled={logs.isFetchingNextPage}
          onClick={() => void logs.fetchNextPage()}
        >
          Tải thêm nhật ký
        </button>
      ) : null}
    </>
  );
}
