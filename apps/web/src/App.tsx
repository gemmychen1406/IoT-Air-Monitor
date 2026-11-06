import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  Activity,
  LayoutDashboard,
  Radio,
  Cpu,
  Settings,
  LogOut,
  Bell,
  Sun,
  Moon,
  Server,
  ChartNoAxesCombined,
  Users,
  ScrollText,
} from 'lucide-react';
import type { DeviceView } from '@iot/contracts';
import { api, HttpError } from './lib/api.js';
import { createRefetchBatcher } from './lib/refetch-batcher.js';
import { clearBrowserPush } from './lib/web-push.js';
import LoginPage, { type SessionView } from './pages/LoginPage.js';
import OverviewPage from './pages/OverviewPage.js';
import SettingsPage from './pages/SettingsPage.js';
const DevicesPage = lazy(() => import('./pages/DevicesPage.js'));
const DeviceDetailPage = lazy(() => import('./pages/DeviceDetailPage.js'));
const MonitoringPage = lazy(() => import('./pages/MonitoringPage.js'));
const AlertsPage = lazy(() => import('./pages/AlertsPage.js'));
const IncidentPage = lazy(() => import('./pages/IncidentPage.js'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.js'));
const UsersPage = lazy(() => import('./pages/UsersPage.js'));
const AuditPage = lazy(() => import('./pages/AuditPage.js'));
const navigation = [
  { path: '/app/overview', icon: LayoutDashboard, label: 'Tổng quan' },
  { path: '/app/monitoring', icon: Radio, label: 'Giám sát trực tiếp' },
  { path: '/app/alerts', icon: Bell, label: 'Cảnh báo & sự cố' },
  { path: '/app/analytics', icon: ChartNoAxesCombined, label: 'Analytics & lịch sử' },
  { path: '/app/devices', icon: Cpu, label: 'Thiết bị' },
  { path: '/app/settings', icon: Settings, label: 'Cài đặt' },
];

export function App() {
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState(false);
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('airguard.theme.v1') === 'light' ? 'light' : 'dark',
  );
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api<SessionView>('/auth/session');
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60000,
    refetchInterval: 60000,
  });
  const session = sessionQuery.data ?? null;
  const devicesQuery = useQuery({
    queryKey: ['devices', session?.user.id],
    queryFn: () => api<DeviceView[]>('/devices'),
    enabled: !!session,
    refetchInterval: 5000,
  });
  const states = useQuery({
    queryKey: ['alert-states'],
    queryFn: () => api<{ device_id: string; unresolved: boolean }[]>('/alerts/states'),
    enabled: !!session,
    refetchInterval: 10000,
  });
  const devices = devicesQuery.data ?? [];
  const deviceIds = devices.map((d) => d.id).join(',');
  const userId = session?.user.id;
  const expiresAt = session?.expires_at;
  useEffect(() => {
    if (sessionQuery.data === null) {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      void clearBrowserPush().catch(() => {});
    }
  }, [sessionQuery.data, queryClient]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: ['session'] }),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, queryClient]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('airguard.theme.v1', theme);
  }, [theme]);
  useEffect(() => {
    if (!userId) return;
    // Vercel external rewrites reliably proxy HTTP; use Socket.IO polling on Cloud.
    // Local Vite proxy can still use the regular transport negotiation.
    const socket = io('/monitoring', {
      withCredentials: true,
      autoConnect: false,
      transports: import.meta.env.PROD ? ['polling'] : undefined,
    });
    const batcher = createRefetchBatcher((key) => {
      void queryClient.invalidateQueries({ queryKey: [key] });
    });
    const invalidate = batcher.request;
    const refreshAlerts = () => invalidate('incidents', 'incident', 'alert-states');
    const refreshDevice = () =>
      invalidate('devices', 'device', 'credentials', 'config', 'status-history');
    socket.on('connect', () => {
      setConnected(true);
      if (deviceIds) {
        const ids = deviceIds.split(',');
        socket.emit(
          'devices.subscribe',
          { device_ids: ids },
          (ack: { accepted_device_ids?: string[]; error?: string }) => {
            setConnected(!ack.error && ids.every((id) => ack.accepted_device_ids?.includes(id)));
          },
        );
      }
      invalidate(
        'devices',
        'readings',
        'incidents',
        'incident',
        'alert-states',
        'config',
        'credentials',
        'status-history',
      );
    });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      if (reason === 'io server disconnect') invalidate('session');
    });
    socket.on('connect_error', () => setConnected(false));
    socket.on('telemetry.created', () => invalidate('devices', 'device', 'readings'));
    socket.on('alert.state.changed', refreshAlerts);
    socket.on('alert.event.created', () => {
      refreshAlerts();
      setNotice(true);
    });
    socket.on('alert.acknowledged', refreshAlerts);
    for (const event of [
      'device.updated',
      'device.status.changed',
      'device.config.updated',
      'device.config.applied',
    ])
      socket.on(event, refreshDevice);
    socket.connect();
    return () => {
      batcher.cancel();
      socket.disconnect();
    };
  }, [userId, deviceIds, queryClient]);
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 401)) {
        setLogoutError('Chưa đăng xuất được khỏi server. Vui lòng kiểm tra kết nối và thử lại.');
        return;
      }
    }
    await queryClient.cancelQueries();
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    queryClient.setQueryData(['session'], null);
    setSelectedId('');
    setLogoutError(null);
    setNotice(false);
  }
  if (sessionQuery.isPending)
    return (
      <main className="login-form-area">
        <div role="status">Đang kiểm tra phiên đăng nhập…</div>
      </main>
    );
  if (sessionQuery.isError)
    return (
      <main className="login-form-area">
        <section className="panel settings-panel">
          <p role="alert">Không kiểm tra được phiên: {sessionQuery.error.message}</p>
          <button onClick={() => void sessionQuery.refetch()}>Thử lại</button>
        </section>
      </main>
    );
  if (!session)
    return <LoginPage onLogin={(value) => queryClient.setQueryData(['session'], value)} />;
  const activeIncidents =
    states.isError || states.isPending
      ? null
      : (states.data?.filter((s) => s.unresolved && devices.some((d) => d.id === s.device_id))
          .length ?? 0);
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link to="/app/overview" className="brand">
          <span className="brand-icon">
            <Activity />
          </span>
          AirGuard
        </Link>
        <span className="sidebar-label">KHÔNG GIAN GIÁM SÁT</span>
        <nav aria-label="Điều hướng chính">
          {navigation.map(({ path, icon: Icon, label }) => (
            <NavLink key={path} to={path}>
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
          {session.user.role === 'admin' ? (
            <>
              <NavLink to="/app/users">
                <Users size={19} />
                Tài khoản
              </NavLink>
              <NavLink to="/app/audit">
                <ScrollText size={19} />
                Nhật ký quản trị
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-tag">
            <Server size={16} />
            <span>{import.meta.env.PROD ? 'Website trực tuyến' : 'Môi trường local'}</span>
          </div>
          <p>
            Dự án nghiên cứu IoT
            <br />
            Không dùng thay hệ thống an toàn đạt chứng nhận.
          </p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <span>/</span> Giám sát môi trường
          </span>
          <div className="topbar-actions">
            <span className={`badge ${connected ? 'success' : ''}`}>
              <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
              {connected ? 'Realtime kết nối' : 'Đang dùng REST / mất realtime'}
            </span>
            <button
              aria-label="Đổi giao diện"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button aria-label="Đăng xuất" onClick={() => void logout()}>
              <LogOut size={18} />
            </button>
            <div className="avatar">{session.user.email.slice(0, 1).toUpperCase()}</div>
          </div>
        </header>
        <main className="content">
          {logoutError ? (
            <p className="notice error" role="alert">
              {logoutError}
            </p>
          ) : null}
          {notice ? (
            <div className="notice" role="status">
              Có cập nhật sự cố. <Link to="/app/alerts">Xem cảnh báo & sự cố</Link>
              <button onClick={() => setNotice(false)} aria-label="Đóng thông báo">
                Đóng
              </button>
            </div>
          ) : null}
          {devicesQuery.isError ? (
            <div className="notice error" role="alert">
              Không tải được dữ liệu: {devicesQuery.error.message}. Trạng thái kết nối chưa được xác
              minh. <button onClick={() => void devicesQuery.refetch()}>Thử lại</button>
              <button onClick={() => void logout()}>Đăng nhập lại</button>
            </div>
          ) : null}
          {states.isError ? (
            <div className="notice error" role="alert">
              Chưa xác minh được số sự cố chưa kết thúc.{' '}
              <button onClick={() => void states.refetch()}>Thử lại</button>
            </div>
          ) : null}
          {devicesQuery.isPending ? (
            <div className="skeleton" aria-label="Đang tải thiết bị" />
          ) : null}
          <Suspense
            fallback={<div className="skeleton" role="status" aria-label="Đang tải màn hình" />}
          >
            <Routes>
              <Route
                path="/app/overview"
                element={
                  <OverviewPage
                    devices={devices}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    activeIncidents={activeIncidents}
                  />
                }
              />
              <Route
                path="/app/devices"
                element={<DevicesPage devices={devices} user={session.user} />}
              />
              <Route path="/app/devices/:id" element={<DeviceDetailPage user={session.user} />} />
              <Route path="/app/monitoring" element={<MonitoringPage devices={devices} />} />
              <Route
                path="/app/monitoring/:deviceId"
                element={<MonitoringPage devices={devices} />}
              />
              <Route path="/app/alerts" element={<AlertsPage devices={devices} />} />
              <Route path="/app/alerts/:id" element={<IncidentPage user={session.user} />} />
              <Route path="/app/analytics" element={<AnalyticsPage devices={devices} />} />
              <Route path="/app/users" element={<UsersPage user={session.user} />} />
              <Route path="/app/audit" element={<AuditPage user={session.user} />} />
              <Route
                path="/app/settings"
                element={
                  <SettingsPage
                    user={session.user}
                    theme={theme}
                    changeTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/app/overview" replace />} />
            </Routes>
          </Suspense>
          <footer>
            AirGuard Monitor <span>•</span> Nghiên cứu & học tập <span>•</span> Firmware tích hợp
            sau
          </footer>
        </main>
      </div>
    </div>
  );
}
