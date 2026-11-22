import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation, Navigate, Route, Routes } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { LogOut, Sun, Moon } from 'lucide-react';
import { AppShell } from './components/AppShell.js';
import type { DeviceView } from '@iot/contracts';
import { api, HttpError } from './lib/api.js';
import { createRefetchBatcher } from './lib/refetch-batcher.js';
import { clearBrowserPush } from './lib/web-push.js';
import { useIncidentNotices } from './features/incident-response/IncidentNotices.js';
import LoginPage, { type SessionView } from './pages/LoginPage.js';
import OverviewPage, { type OverviewAlert } from './pages/OverviewPage.js';
import SettingsPage from './pages/SettingsPage.js';
const DevicesPage = lazy(() => import('./pages/DevicesPage.js'));
const DeviceDetailPage = lazy(() => import('./pages/DeviceDetailPage.js'));
const MonitoringPage = lazy(() => import('./pages/MonitoringPage.js'));
const AlertsPage = lazy(() => import('./pages/AlertsPage.js'));
const IncidentPage = lazy(() => import('./pages/IncidentPage.js'));
const DeliveryHistoryPage = lazy(() => import('./features/notification-center/DeliveryHistoryPage.js'));
const EnvironmentSettingsPage = lazy(() => import('./features/notification-center/EnvironmentSettingsPage.js'));
const NotificationSettingsPage = lazy(() => import('./features/notification-center/NotificationSettingsPage.js'));
const UsersPage = lazy(() => import('./pages/UsersPage.js'));
const AuditPage = lazy(() => import('./pages/AuditPage.js'));
const MonitoringSpacesPage = lazy(() => import('./features/monitoring-spaces/MonitoringSpacesPage.js'));
const SupportContactsPage = lazy(() => import('./features/incident-response/SupportContactsPage.js'));
const DeviceDiagnosticsPage = lazy(() => import('./features/device-diagnostics/DeviceDiagnosticsPage.js'));
const SmartMonitoringHub = lazy(() => import('./features/smart-monitoring/SmartMonitoringHub.js'));
// [FORECAST - SUA FILE CHUNG] Nap lazy trang Forecast, khong thay doi trang khac.
const ForecastPage = lazy(() => import('./features/forecast-trends/ForecastPage.js'));
const ComparisonReportingPage = lazy(
  () => import('./features/comparison-reporting/ComparisonReportingPage.js'),
);
export function App() {
  const path = useLocation().pathname;
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
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
    queryFn: () => api<OverviewAlert[]>('/alerts/states'),
    enabled: !!session,
    refetchInterval: 10000,
  });
  const devices = devicesQuery.data ?? [];
  const deviceIds = devices.map((d) => d.id).join(',');
  const userId = session?.user.id;
  const expiresAt = session?.expires_at;
  const { refresh: refreshIncidentNotices, banner: incidentBanner } = useIncidentNotices(
    userId ? `${userId}:${expiresAt}` : undefined, path,
  );
  useEffect(() => {
    if (sessionQuery.data === null) {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });

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
      // Vercel forwards /socket.io and serves the SPA for /socket.io/.
      addTrailingSlash: !import.meta.env.PROD,
    });
    const batcher = createRefetchBatcher((key) => {
      void queryClient.invalidateQueries({ queryKey: [key] });
    });
    const invalidate = batcher.request;
    const refreshAlerts = () => invalidate('incidents', 'incident', 'alert-states', 'space-map', 'area-summary');
    const refreshDevice = () =>
      invalidate('devices', 'device', 'credentials', 'config', 'status-history', 'space-map');
    socket.on('connect', () => {
      setConnected(true);
      if (deviceIds) {
        const ids = deviceIds.split(',');
        socket.emit(
          'devices.subscribe',
          { device_ids: ids },
          (ack: { accepted_device_ids?: string[]; error?: string }) => {
            const subscribed = !ack.error && ids.every((id) => ack.accepted_device_ids?.includes(id));
            setConnected(subscribed);
            if (subscribed) refreshIncidentNotices.current?.();
          },
        );
      }
      invalidate(
        'devices',
        'readings',
        'incidents',
        'incident',
        'alert-states',
        'space-map',
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
    socket.on('telemetry.created', () => invalidate('devices', 'device', 'readings', 'space-map'));
    socket.on('alert.state.changed', refreshAlerts);
    socket.on('alert.event.created', () => {
      refreshAlerts();
      refreshIncidentNotices.current?.();
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
  }, [userId, deviceIds, queryClient, refreshIncidentNotices]);
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 401)) {
        setLogoutError('Chưa đăng xuất được khỏi server. Vui lòng kiểm tra kết nối và thử lại.');
        return;
      }
    }
    await clearBrowserPush().catch(() => {});
    await queryClient.cancelQueries();
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    queryClient.setQueryData(['session'], null);
    setLogoutError(null);
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
  return (
    <AppShell
      role={session.user.role}
      headerActions={
          <div className="topbar-actions">
            <span className={`badge ${connected ? 'success' : ''}`}>
              <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
              {connected ? 'Trực tiếp' : 'Cập nhật chậm'}
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
      }
    >
        <main className="content">
          {logoutError ? (
            <p className="notice error" role="alert">
              {logoutError}
            </p>
          ) : null}
          {incidentBanner}
          {devicesQuery.isError ? (
            <div className="notice error" role="alert">
              Không tải được dữ liệu: {devicesQuery.error.message}. <button onClick={() => void devicesQuery.refetch()}>Thử lại</button>
              <button onClick={() => void logout()}>Đăng nhập lại</button>
            </div>
          ) : null}
          {states.isError ? (
            <div className="notice error" role="alert">
              Không tải được số sự cố.{' '}
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
                    devices={devicesQuery.isError ? undefined : devicesQuery.data}
                    alerts={states.isError ? undefined : states.data}
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
              <Route
                path="/app/smart-monitoring"
                element={<SmartMonitoringHub devices={devices} />}
              />
              <Route path="/app/notifications" element={<DeliveryHistoryPage devices={devices} user={session.user} />} />
              <Route path="/app/environment-settings" element={<EnvironmentSettingsPage devices={devices} user={session.user} />} />
              <Route path="/app/settings/notifications" element={<NotificationSettingsPage devices={devices} user={session.user} />} />
              <Route path="/app/alerts/:id" element={<IncidentPage user={session.user} />} />
              <Route path="/app/analytics" element={<Navigate to="/app/comparison-reporting" replace />} />
              {/* [FORECAST - SUA FILE CHUNG] Route ca nhan, dung devices va API chung cua nhom. */}
              <Route path="/app/forecast" element={<ForecastPage devices={devices} />} />
              <Route
                path="/app/comparison-reporting"
                element={<ComparisonReportingPage devices={devices} user={session.user} />}
              />
              <Route path="/app/device-diagnostics" element={<DeviceDiagnosticsPage key={session.user.id} devices={devices} userId={session.user.id} />} />
              <Route path="/app/spaces/:areaId?" element={<MonitoringSpacesPage user={session.user} />} />
              <Route path="/app/support-contacts" element={<SupportContactsPage user={session.user} />} />
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
        </main>
    </AppShell>
  );
}
