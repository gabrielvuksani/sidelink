import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { UpdateBanner } from './UpdateBanner';
import { useGlobalShortcuts } from '../hooks/useKeyboardShortcuts';
import { useElectron } from '../hooks/useElectron';

const icons: Record<string, ReactNode> = {
  dashboard: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
  apple: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>,
  device: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>,
  apps: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>,
  install: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>,
  installed: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  logs: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>,
  settings: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  sources: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-6-6h12" /><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5h15v15h-15z" /></svg>,
  logout: <svg aria-hidden="true" className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>,
};

interface NavSection {
  title?: string;
  items: { to: string; label: string; icon: string; end?: boolean }[];
}

const navSections: NavSection[] = [
  { items: [{ to: '/', label: 'Overview', icon: 'dashboard', end: true }] },
  {
    title: 'Library',
    items: [
      { to: '/apps', label: 'IPAs', icon: 'apps' },
      { to: '/install', label: 'Install', icon: 'install' },
      { to: '/installed', label: 'Installed', icon: 'installed' },
    ],
  },
  {
    title: 'Manage',
    items: [
      { to: '/devices', label: 'Devices', icon: 'device' },
      { to: '/apple', label: 'Apple ID', icon: 'apple' },
      { to: '/sources', label: 'Sources', icon: 'sources' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/logs', label: 'Logs', icon: 'logs' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

const routeTitles: Record<string, string> = {
  '/': 'Overview',
  '/apple': 'Apple ID',
  '/devices': 'Devices',
  '/apps': 'IPAs',
  '/install': 'Install',
  '/installed': 'Installed',
  '/logs': 'Logs',
  '/sources': 'Sources',
  '/settings': 'Settings',
};

export default function Layout({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { info } = useElectron();

  useGlobalShortcuts();

  const pageTitle = useMemo(() => routeTitles[location.pathname] ?? 'Sidelink', [location.pathname]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Keep local logout behavior even if backend call fails.
    }
    onLogout();
    navigate('/');
  };

  const sidebar = (
    <>
      {/* Logo / header */}
      <div className="px-4 pb-3 pt-5">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--sl-accent)]">
            <svg aria-label="Sidelink logo" className="h-4.5 w-4.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="4" y="7" width="11" height="11" rx="4.2" />
              <rect x="9" y="6" width="11" height="11" rx="4.2" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-[var(--sl-text)]">Sidelink</p>
            <p className="text-[10px] font-medium text-[var(--sl-muted)]">Desktop Hub</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-2" aria-label="Main navigation">
        {navSections.map((section, sectionIndex) => (
          <div key={sectionIndex} className={sectionIndex > 0 ? 'mt-4' : ''}>
            {section.title && <p className="sl-section-label mb-1 px-3">{section.title}</p>}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 rounded-[10px] px-3 py-[7px] text-[13px] font-medium transition-all duration-150 ${isActive
                      ? 'bg-[var(--sl-accent)] text-white shadow-[0_2px_12px_rgba(99,102,241,0.3)]'
                      : 'text-[var(--sl-muted)] hover:bg-[var(--sl-surface-soft)] hover:text-[var(--sl-text)]'
                    }`
                  }
                >
                  <span className="shrink-0">{icons[item.icon]}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-[var(--sl-border)] px-3 py-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-[7px] text-[13px] font-medium text-[var(--sl-muted)] transition-all hover:bg-red-500/8 hover:text-red-400"
        >
          {icons.logout}
          Sign Out
        </button>
        {info.isElectron && (
          <p className="mt-2 px-3 text-[10px] font-medium text-[var(--sl-muted)] opacity-50">
            {info.platform} v{info.version}
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--sl-bg)] text-[var(--sl-text)]">
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-40 rounded-lg border border-[var(--sl-border)] bg-[var(--sl-surface)] p-2 text-[var(--sl-muted)] md:hidden"
        aria-label="Open menu"
      >
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex w-[232px] flex-col border-r border-[var(--sl-border)]
          bg-[var(--sl-surface)] transition-transform duration-200
          md:static md:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {sidebar}
      </aside>

      <main className="relative z-10 flex-1 overflow-y-auto pt-14 md:pt-0">
        <header className="sticky top-0 z-20 border-b border-[var(--sl-border)] bg-[var(--sl-bg)]/80 px-6 py-3 backdrop-blur-xl md:px-8">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--sl-text)]">{pageTitle}</h2>
        </header>

        <UpdateBanner />

        <div className="mx-auto max-w-5xl px-6 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}