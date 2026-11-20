import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import type { UserView } from '@iot/contracts';
import { api } from '../lib/api.js';

export type SessionView = { user: UserView; expires_at: string };
export default function LoginPage({ onLogin }: { onLogin: (session: SessionView) => void }) {
  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<SessionView>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: onLogin,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    login.mutate({
      email: String(data.get('email')),
      password: String(data.get('password')),
    });
  }
  return (
    <main className="login-layout">
      <section className="login-brand">
        <div className="brand">
          <span className="brand-icon">
            <Activity />
          </span>{' '}
          AirGuard<span className="brand-sub">MONITOR</span>
        </div>
        <h1>
          Giám sát khí gas
          <br />
          <span>và chất lượng không khí.</span>
        </h1>
        <p>Theo dõi nồng độ khí, nhiệt độ và độ ẩm theo thời gian thực.</p>
      </section>
      <section className="login-form-area">
        <form onSubmit={submit} className="login-form panel">
          <h2>Đăng nhập</h2>
          <p className="muted">Dùng tài khoản do quản trị viên cấp.</p>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="ban@example.com"
            />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              placeholder="Nhập mật khẩu"
            />
          </label>
          {login.isError ? (
            <p className="error" role="alert">
              {login.error.message}
            </p>
          ) : null}
          <button className="primary full" disabled={login.isPending}>
            {login.isPending ? 'Đang xác thực…' : 'Đăng nhập'}
          </button>
        </form>
      </section>
    </main>
  );
}
