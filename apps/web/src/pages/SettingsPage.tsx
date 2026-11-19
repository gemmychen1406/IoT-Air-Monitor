import type { UserView } from '@iot/contracts';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { PageTitle, LoadState } from '../components/FeatureUI.js';
import { PushSettings } from '../components/PushSettings.js';
export default function SettingsPage({
  user,
  theme,
  changeTheme,
}: {
  user: UserView;
  theme: string;
  changeTheme: () => void;
}) {
  const client = useQueryClient();
  const [mismatch, setMismatch] = useState('');
  async function signedOut() {
    await client.cancelQueries();
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    client.setQueryData(['session'], null);
  }
  const password = useMutation({
    mutationFn: (input: object) =>
      api('/users/me/password', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: signedOut,
  });
  const email = useMutation({
    mutationFn: (input: object) =>
      api('/users/me', { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: signedOut,
  });
  function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (data.get('new_password') !== data.get('confirmation')) {
      setMismatch('Hai mật khẩu mới chưa khớp.');
      return;
    }
    setMismatch('');
    password.mutate({
      current_password: data.get('current_password'),
      new_password: data.get('new_password'),
    });
  }
  return (
    <>
      <PageTitle eyebrow="PREFERENCES" title="Cài đặt">
        <p>Tài khoản và giao diện làm việc.</p>
      </PageTitle>
      <PushSettings />
      <section className="panel settings-panel">
        <h2>Tài khoản</h2>
        <p>{user.email}</p>
        <span className="badge">Quyền: {user.role}</span>
        <h2>Đổi mật khẩu</h2>
        <p className="caption">
          Sau khi đổi, mọi phiên đăng nhập sẽ bị thu hồi. Đăng nhập lại bằng mật khẩu mới.
        </p>
        <form className="stack-form" onSubmit={changePassword}>
          <label>
            Mật khẩu hiện tại
            <input
              name="current_password"
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          <label>
            Mật khẩu mới
            <input
              name="new_password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <label>
            Nhập lại mật khẩu mới
            <input
              name="confirmation"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <button className="primary" disabled={password.isPending}>
            Đổi mật khẩu
          </button>
        </form>
        {mismatch ? (
          <p className="error" role="alert">
            {mismatch}
          </p>
        ) : null}
        <LoadState error={password.error} />
        <h2>Đổi email đăng nhập</h2>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            email.mutate(Object.fromEntries(new FormData(e.currentTarget)));
          }}
        >
          <label>
            Email mới
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              defaultValue={user.email}
              autoComplete="email"
            />
          </label>
          <label>
            Mật khẩu xác nhận email
            <input
              name="current_password"
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          <button disabled={email.isPending}>Đổi email và đăng xuất</button>
        </form>
        <LoadState error={email.error} />
        <h2>Giao diện</h2>
        <button onClick={changeTheme}>
          Chuyển sang chế độ {theme === 'dark' ? 'sáng' : 'tối'}
        </button>
        <h2>Chính sách cảnh báo</h2>
        <p className="muted">
          Không cung cấp lệnh tắt còi từ dashboard. Ngưỡng gas/CO chưa được cấu hình khi chưa có căn
          cứ đo lường. Chu kỳ truyền dữ liệu được quản lý riêng tại chi tiết thiết bị.
        </p>
        <h2>Phiên đăng nhập</h2>
        <p className="muted">
          Phiên dùng cookie HttpOnly, hết hạn sau 8 giờ. Refresh trang không cần đăng nhập lại. Đăng
          xuất thu hồi phiên trên server.
        </p>
      </section>
    </>
  );
}
