import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { UpdateBanner } from './UpdateBanner';
import { useGlobalShortcuts } from '../hooks/useKeyboardShortcuts';
import { useElectron } from '../hooks/useElectron';
import { BrandIcon } from './BrandIcon';

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

const routeDescriptions: Record<string, string> = {
  '/': 'Live readiness for accounts, devices, installs, and helper automation.',
  '/apple': 'Primary signing accounts, certificate visibility, and App ID pressure.',
  '/devices': 'Connected hardware, pairing health, and target-device readiness.',
  '/apps': 'Upload, curate, and launch installs from your desktop IPA library.',
  '/install': 'Run installs, resolve 2FA, and inspect pipeline logs from one place.',
  '/installed': 'Track active installs, expiry pressure, and reactivation workflows.',
  '/logs': 'Operational logs for debugging, support, and release hardening.',
  '/sources': 'Curated sources, self-hosted feeds, and source app import workflows.',
  '/settings': 'Scheduler, updates, credentials, runtime, and helper configuration.',
};

export default function Layout({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { info } = useElectron();
  const macChromeInset = info.isElectron && info.platform === 'darwin';

  useGlobalShortcuts();

  const pageTitle = useMemo(() => routeTitles[location.pathname] ?? 'SideLink', [location.pathname]);
  const pageDescription = useMemo(() => routeDescriptions[location.pathname] ?? 'Desktop control surface for installs, accounts, devices, and sources.', [location.pathname]);

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
      <div className={`px-4 pb-4 pt-5 ${macChromeInset ? 'md:pt-12' : ''}`}>
        <div className="sl-card-soft flex items-center gap-3 px-3 py-3">
          <BrandIcon className="h-9 w-9" />
          <div>
            <p className="text-sm font-bold tracking-tight text-[var(--sl-text)]">SideLink Command</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--sl-muted)]">Desktop Control Surface</p>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          <div className="rounded-2xl border border-[var(--sl-border)] bg-[rgba(8,16,25,0.45)] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--sl-muted)]">Workspace</p>
            <p className="mt-1 text-[13px] font-semibold text-[var(--sl-text)]">Desktop ready</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--sl-muted)]">Installs, helper automation, and device operations share one shell.</p>
          </div>
          {info.isElectron && (
            <div className="rounded-2xl border border-[var(--sl-border)] bg-[rgba(8,16,25,0.38)] px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--sl-muted)]">Runtime</p>
              <p className="mt-1 text-[12px] font-medium text-[var(--sl-text)]">{info.platform} v{info.version}</p>
            </div>
          )}
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
                      ? 'border border-teal-300/15 bg-[linear-gradient(135deg,rgba(45,212,191,0.24),rgba(20,184,166,0.12))] text-[var(--sl-text)] shadow-[0_14px_30px_rgba(20,184,166,0.12)]'
                      : 'text-[var(--sl-muted)] hover:bg-[rgba(24,39,53,0.8)] hover:text-[var(--sl-text)]'
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
        <div className="mb-3 rounded-2xl border border-[var(--sl-border)] bg-[rgba(8,16,25,0.42)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--sl-muted)]">Fast Actions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <NavLink to="/install" className="sl-btn-primary !px-3 !py-1.5 !text-[11px]">New Install</NavLink>
            <NavLink to="/devices" className="sl-btn-ghost !px-3 !py-1.5 !text-[11px]">Scan Devices</NavLink>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-[13px] font-medium text-[var(--sl-muted)] transition-all hover:bg-red-500/8 hover:text-red-400"
        >
          {icons.logout}
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--sl-bg)] text-[var(--sl-text)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.06),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(251,146,60,0.06),transparent_20%)]" />
      <button
        onClick={() => setMobileOpen(true)}
        className={`fixed left-3 z-40 rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface)] p-2 text-[var(--sl-muted)] shadow-[var(--sl-shadow)] md:hidden ${macChromeInset ? 'top-12' : 'top-3'}`}
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
          fixed inset-y-0 left-0 z-50 flex w-[290px] flex-col border-r border-[var(--sl-border)]
          bg-[linear-gradient(180deg,rgba(10,18,26,0.96),rgba(6,11,17,0.98))] transition-transform duration-200
          md:static md:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {sidebar}
      </aside>

      <main className={`relative z-10 flex-1 overflow-y-auto pt-14 md:pt-0 ${macChromeInset ? 'md:pt-8' : ''}`}>
        <header className={`sticky top-0 z-20 border-b border-[var(--sl-border)] bg-[rgba(8,16,25,0.82)] px-6 py-4 backdrop-blur-xl md:px-8 ${macChromeInset ? 'md:pt-10' : ''}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="sl-section-label">Desktop Workflow</p>
              <h2 className="mt-1 text-[1.3rem] font-semibold tracking-tight text-[var(--sl-text)]">{pageTitle}</h2>
              <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[var(--sl-muted)]">{pageDescription}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <NavLink to="/install" className="sl-btn-primary !px-3.5 !py-2 !text-[12px]">Quick Install</NavLink>
              <NavLink to="/apple" className="sl-btn-ghost !px-3.5 !py-2 !text-[12px]">Signing</NavLink>
              <NavLink to="/settings" className="sl-btn-ghost !px-3.5 !py-2 !text-[12px]">System</NavLink>
            </div>
          </div>
        </header>

        <UpdateBanner />

        <div className="mx-auto max-w-[1440px] px-6 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}