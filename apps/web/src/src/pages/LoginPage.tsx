import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Activity, Radio, ShieldCheck } from 'lucide-react';
import type { UserView } from '@iot/contracts';
import { api } from '../lib/api.js';

export type SessionView = { user: UserView; expires_at: string };
export default function LoginPage({ onLogin }: { onLogin: (session: SessionView) => void }) {
  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<SessionView>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: onLogin,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    login.mutate({ email: String(data.get('email')), password: String(data.get('password')) });
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
        <span className="eyebrow">IOT OBSERVABILITY PLATFORM</span>
        <h1>
          Dữ liệu rõ ràng.
          <br />
          <span>Giám sát chủ động.</span>
        </h1>
        <p>Theo dõi thiết bị và tín hiệu cảm biến trên một không gian làm việc thống nhất.</p>
        <div className="login-feature">
          <Radio size={20} />
          <span>Telemetry thời gian thực</span>
        </div>
        <div className="login-feature">
          <ShieldCheck size={20} />
          <span>Truy cập được phân quyền</span>
        </div>
        <div className="research-note">
          Dự án nghiên cứu và học tập. Không thay thế thiết bị cảnh báo an toàn đạt chứng nhận.
        </div>
      </section>
      <section className="login-form-area">
        <form onSubmit={submit} className="login-form panel">
          <span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span>
          <h2>Đăng nhập</h2>
          <p className="muted">Sử dụng tài khoản được quản trị viên cấp.</p>
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
          <p className="caption">
            Giữ đăng nhập tối đa 8 giờ bằng cookie bảo mật. Refresh trang không cần đăng nhập lại.
          </p>
        </form>
      </section>
    </main>
  );
}
