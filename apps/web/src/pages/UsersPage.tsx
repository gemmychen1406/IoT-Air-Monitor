import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import type { AccountView, UserView } from '@iot/contracts';
import { api, apiPage } from '../lib/api.js';
import { PageTitle, LoadState, dateText } from '../components/FeatureUI.js';

export default function UsersPage({ user }: { user: UserView }) {
  const client = useQueryClient();
  const users = useInfiniteQuery({
    queryKey: ['users'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<AccountView[]>(`/users?limit=30${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    enabled: user.role === 'admin',
  });
  const create = useMutation({
    mutationFn: (input: object) => api('/users', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['users'] }),
  });
  const update = useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      role?: string;
      active?: boolean;
      password?: string;
    }) => api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['users'] }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    create.mutate(Object.fromEntries(data), { onSuccess: () => form.reset() });
  }
  if (user.role !== 'admin') return <p role="alert">Chỉ admin được quản lý tài khoản.</p>;
  return (
    <>
      <PageTitle eyebrow="ACCESS MANAGEMENT" title="Tài khoản">
        <p>
          Admin quản lý quyền và khóa tài khoản. Thay đổi quyền/mật khẩu thu hồi mọi phiên của tài
          khoản đó.
        </p>
      </PageTitle>
      <form className="panel inline-form" onSubmit={submit}>
        <label>
          Email tài khoản mới
          <input name="email" type="email" required maxLength={254} autoComplete="off" />
        </label>
        <label>
          Mật khẩu ban đầu
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        <label>
          Quyền ban đầu
          <select name="role" defaultValue="viewer">
            <option value="viewer">viewer — chỉ đọc</option>
            <option value="operator">operator — xác nhận sự cố</option>
            <option value="admin">admin — quản trị</option>
          </select>
        </label>
        <button className="primary" disabled={create.isPending}>
          Tạo tài khoản
        </button>
      </form>
      <LoadState
        pending={users.isPending}
        error={users.error ?? create.error ?? update.error}
        retry={() => void users.refetch()}
      />
      {create.isSuccess ? <p role="status">Đã tạo tài khoản.</p> : null}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Quyền</th>
              <th>Trạng thái</th>
              <th>Tạo lúc</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.pages
              .flatMap((p) => p.data)
              .map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    {u.id === user.id ? ' (bạn)' : ''}
                  </td>
                  <td>
                    <select
                      aria-label={`Quyền ${u.email}`}
                      disabled={update.isPending || u.id === user.id}
                      value={u.role}
                      onChange={(e) => update.mutate({ id: u.id, role: e.target.value })}
                    >
                      <option value="viewer">viewer</option>
                      <option value="operator">operator</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>{u.active ? 'Hoạt động' : 'Đã khóa'}</td>
                  <td>{dateText(u.created_at)}</td>
                  <td>
                    <button
                      disabled={update.isPending || u.id === user.id}
                      onClick={() => update.mutate({ id: u.id, active: !u.active })}
                    >
                      {u.active ? 'Khóa' : 'Mở khóa'}
                    </button>
                    <details>
                      <summary>Đặt lại mật khẩu</summary>
                      <form
                        className="stack-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          update.mutate(
                            { id: u.id, password: String(new FormData(form).get('password')) },
                            { onSuccess: () => form.reset() },
                          );
                        }}
                      >
                        <label>
                          Mật khẩu mới cho {u.email}
                          <input
                            name="password"
                            type="password"
                            minLength={12}
                            maxLength={128}
                            required
                            autoComplete="new-password"
                          />
                        </label>
                        <button disabled={update.isPending}>Đặt lại</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {users.hasNextPage ? (
        <button
          className="load-more"
          disabled={users.isFetchingNextPage}
          onClick={() => void users.fetchNextPage()}
        >
          Tải thêm tài khoản
        </button>
      ) : null}
      <p className="caption">
        Không được tự khóa/hạ quyền tài khoản đang dùng hoặc loại bỏ admin cuối cùng. Không xóa tài
        khoản để giữ liên kết audit và xác nhận sự cố. Mật khẩu tối thiểu 12 ký tự, không được ghi
        vào log.
      </p>
    </>
  );
}
