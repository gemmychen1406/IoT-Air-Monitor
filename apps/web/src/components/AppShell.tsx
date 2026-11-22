import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Link, NavLink } from 'react-router';
import {
  Activity,
  Bell,
  Building2,
  ContactRound,
  Cpu,
  GitCompareArrows,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  Radio,
  ScrollText,
  Settings,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import type { UserView } from '@iot/contracts';
import './app-navigation.css';

const navigation = [
  {
    title: 'Giám sát',
    links: [
      { path: 'overview', icon: LayoutDashboard, label: 'Tổng quan' },
      { path: 'monitoring', icon: Radio, label: 'Giám sát trực tiếp' },
      {
        path: 'smart-monitoring',
        icon: Sparkles,
        label: 'Giám sát thông minh',
      },
      { path: 'alerts', icon: Bell, label: 'Cảnh báo & sự cố' },
      { path: 'notifications', icon: ScrollText, label: 'Lịch sử gửi' },
    ],
  },
  {
    title: 'Không gian & thiết bị',
    links: [
      { path: 'spaces', icon: Building2, label: 'Khu vực & phòng' },
      {
        path: 'device-diagnostics',
        icon: Activity,
        label: 'Kiểm tra thiết bị',
      },
      { path: 'devices', icon: Cpu, label: 'Thiết bị' },
    ],
  },
  {
    title: 'Phân tích',
    links: [
      // [FORECAST - SUA FILE CHUNG] Them muc menu vao nhom Phan tich.
      { path: 'forecast', icon: TrendingUp, label: 'Giám sát & Dự báo' },
      {
        path: 'comparison-reporting',
        icon: GitCompareArrows,
        label: 'Phân tích & báo cáo',
      },
    ],
  },
  {
    title: 'Cấu hình & quản trị',
    links: [
      { path: 'settings', icon: Settings, label: 'Cài đặt' },
      {
        path: 'support-contacts',
        icon: ContactRound,
        label: 'Danh bạ hỗ trợ',
        admin: true,
      },
      { path: 'users', icon: Users, label: 'Tài khoản', admin: true },
      {
        path: 'audit',
        icon: ScrollText,
        label: 'Nhật ký quản trị',
        admin: true,
      },
    ],
  },
];

function NavigationMenu({
  role,
  onNavigate,
}: {
  role: UserView['role'];
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <nav className="app-shell-navigation" aria-label="Điều hướng chính">
      {navigation.map((group) => (
        <div
          role="group"
          aria-label={group.title}
          className="nav-group"
          key={group.title}
        >
          <span className="sidebar-label">{group.title}</span>
          {group.links
            .filter((item) => !('admin' in item) || role === 'admin')
            .map(({ path, icon: Icon, label }) => (
              <NavLink key={path} to={`/app/${path}`} onClick={onNavigate}>
                <Icon size={19} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
        </div>
      ))}
    </nav>
  );
}

function Brand({
  onNavigate,
}: {
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link to="/app/overview" className="brand" onClick={onNavigate}>
      <span className="brand-icon">
        <Activity aria-hidden="true" />
      </span>
      AirGuard
    </Link>
  );
}

export function AppShell({
  role,
  headerActions,
  children,
}: {
  role: UserView['role'];
  headerActions: ReactNode;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    const mobile = window.matchMedia('(max-width: 760px)');
    const closeOnDesktop = () => {
      if (!mobile.matches) drawer.current?.close();
    };
    mobile.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => mobile.removeEventListener('change', closeOnDesktop);
  }, [drawerOpen]);

  function openDrawer() {
    if (!drawer.current || drawer.current.open) return;
    drawer.current.showModal();
    setDrawerOpen(true);
    closeButton.current?.focus();
  }

  function closeAfterNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      drawer.current?.close();
    }
  }

  return (
    <div className="app-layout" data-sidebar-open={sidebarOpen}>
      <aside className="sidebar" id="app-desktop-sidebar">
        <Brand />
        <NavigationMenu role={role} />
      </aside>
      <dialog
        ref={drawer}
        className="app-nav-drawer"
        id="app-mobile-sidebar"
        aria-label="Menu điều hướng"
        onClose={() => setDrawerOpen(false)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX >= bounds.right ||
            event.clientY < bounds.top ||
            event.clientY >= bounds.bottom
          ) {
            event.currentTarget.close();
          }
        }}
      >
        <div className="app-nav-drawer-header">
          <Brand onNavigate={closeAfterNavigation} />
          <button
            ref={closeButton}
            type="button"
            className="app-nav-icon-button"
            aria-label="Đóng menu điều hướng"
            onClick={() => drawer.current?.close()}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <NavigationMenu role={role} onNavigate={closeAfterNavigation} />
      </dialog>
      <div className="workspace">
        <header className="topbar app-shell-topbar">
          <div className="app-nav-topbar-start">
            <button
              type="button"
              className="app-nav-icon-button app-nav-desktop-toggle"
              aria-label={sidebarOpen ? 'Thu gọn thanh bên' : 'Mở thanh bên'}
              title={sidebarOpen ? 'Thu gọn thanh bên' : 'Mở thanh bên'}
              aria-controls="app-desktop-sidebar"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              {sidebarOpen ? (
                <PanelLeftClose size={19} aria-hidden="true" />
              ) : (
                <Menu size={19} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="app-nav-icon-button app-nav-mobile-toggle"
              aria-label="Mở menu điều hướng"
              aria-controls="app-mobile-sidebar"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              onClick={openDrawer}
            >
              <Menu size={19} aria-hidden="true" />
            </button>
            <span className="app-nav-wordmark">AirGuard</span>
          </div>
          {headerActions}
        </header>
        {children}
      </div>
    </div>
  );
}
