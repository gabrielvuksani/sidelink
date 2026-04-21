import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { setUiSnapshot } from '../lib/ui-snapshot-cache';
import { UpdateBanner } from './UpdateBanner';
import { useInstallModal } from './InstallModal';
import { useToast } from './Toast';
import { useGlobalShortcuts } from '../hooks/useKeyboardShortcuts';
import { useElectron } from '../hooks/useElectron';
import { useDesktopHealth } from '../hooks/useDesktopHealth';
import { BrandIcon } from './BrandIcon';
import {
  DashboardIcon,
  KeyIcon,
  PhoneIcon,
  ArchiveIcon,
  DownloadIcon,
  CheckCircleIcon,
  DocumentIcon,
  CogIcon,
  SourcesIcon,
  LogoutIcon,
} from './Icons';

const icons: Record<string, ReactNode> = {
  dashboard: <DashboardIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
  apple: <KeyIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
  device: <PhoneIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
  apps: <ArchiveIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
  install: <DownloadIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
  installed: <CheckCircleIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
  logs: <DocumentIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
  settings: <CogIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
  sources: <SourcesIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
  logout: <LogoutIcon className="h-[17px] w-[17px]" aria-hidden="true" />,
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
  '/': 'Your apps, devices, and signing status at a glance.',
  '/apple': 'Manage signing accounts, certificates, and App IDs.',
  '/devices': 'View connected devices and manage pairing.',
  '/apps': 'Upload and manage your IPA files.',
  '/install': 'Track active and completed installations.',
  '/installed': 'Monitor installed apps and auto-refresh status.',
  '/logs': 'View system logs and debug issues.',
  '/sources': 'Browse and manage app sources.',
  '/settings': 'Configure scheduling, security, and updates.',
};

export default function Layout({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scanningDevices, setScanningDevices] = useState(false);
  const { info } = useElectron();
  const { data: desktopHealth } = useDesktopHealth({
    autoRefreshMs: 15_000,
    snapshotKey: 'desktop-health',
    warmTtlMs: 15_000,
  });
  const { openInstall } = useInstallModal();
  const { toast } = useToast();
  const macChromeInset = info.isElectron && info.platform === 'darwin';
  const workspaceReady = desktopHealth?.readiness.overall ?? false;

  useGlobalShortcuts();

  const pageTitle = useMemo(() => routeTitles[location.pathname] ?? 'SideLink', [location.pathname]);
  const pageDescription = useMemo(() => routeDescriptions[location.pathname] ?? '', [location.pathname]);

  const badges = useMemo(() => {
    if (!desktopHealth) return {};
    const result: Record<string, { count: number; tone: 'danger' | 'warning' | 'accent' }> = {};

    // Accounts needing attention
    const accountIssues = desktopHealth.accounts?.needsAttention ?? 0;
    if (accountIssues > 0) result['/apple'] = { count: accountIssues, tone: 'danger' };

    // Expiring apps (pending refresh count from scheduler)
    const expiring = desktopHealth.scheduler?.pendingRefreshCount ?? 0;
    if (expiring > 0) result['/installed'] = { count: expiring, tone: 'warning' };

    // Active jobs (running + waiting for 2FA)
    const activeJobs = (desktopHealth.installs?.running ?? 0) + (desktopHealth.installs?.waitingFor2FA ?? 0);
    if (activeJobs > 0) result['/install'] = { count: activeJobs, tone: 'accent' };

    return result;
  }, [desktopHealth]);

  const handleLogout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    onLogout();
    navigate('/');
  };

  const handleOpenInstall = () => {
    setMobileOpen(false);
    openInstall();
  };

  const handleScanDevices = async () => {
    if (scanningDevices) return;
    setMobileOpen(false);
    setScanningDevices(true);
    try {
      const response = await api.refreshDevices();
      const devices = response.data ?? [];
      setUiSnapshot('page:devices', devices);
      toast('success', `Found ${devices.length} device(s)`);
    } catch (error: unknown) {
      toast('error', getErrorMessage(error, 'Failed to refresh devices'));
    } finally {
      setScanningDevices(false);
    }
  };

  const sidebar = (
    <>
      {/* Brand header - compact */}
      <div className={`px-4 pb-3 pt-4 pl-[max(1rem,env(safe-area-inset-left))] ${macChromeInset ? 'md:pt-11' : ''}`}>
        <div className="flex items-center gap-2.5 px-2">
          <BrandIcon className="h-7 w-7" />
          <div>
            <p className="text-[13px] font-bold tracking-tight text-[var(--sl-text)]">SideLink</p>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${workspaceReady ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
              <p className="text-[11px] font-medium text-[var(--sl-muted)]">{workspaceReady ? 'Ready' : 'Needs setup'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
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
                      ? 'border border-[var(--sl-accent)]/15 bg-[var(--sl-accent)]/12 text-[var(--sl-text)]'
                      : 'text-[var(--sl-muted)] hover:bg-[rgba(24,39,53,0.8)] hover:text-[var(--sl-text)]'
                    }`
                  }
                >
                  <span className="shrink-0">{icons[item.icon]}</span>
                  <span>{item.label}</span>
                  {badges[item.to] && (
                    <span className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                      badges[item.to].tone === 'danger' ? 'bg-red-500/20 text-red-400' :
                      badges[item.to].tone === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-teal-500/20 text-teal-400'
                    }`}>
                      {badges[item.to].count}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-[var(--sl-border)] px-3 py-3">
        <div className="mb-2 flex flex-wrap gap-2">
          <button onClick={handleOpenInstall} className="sl-btn-primary sl-btn-sm flex-1">New Install</button>
          <button onClick={() => { void handleScanDevices(); }} disabled={scanningDevices} className="sl-btn-ghost sl-btn-sm flex-1 disabled:opacity-50">
            {scanningDevices ? 'Scanning...' : 'Scan Devices'}
          </button>
        </div>
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
          className="mb-2 flex w-full items-center justify-between rounded-lg border border-[var(--sl-border)] bg-[rgba(8,16,25,0.4)] px-3 py-2 text-left text-[11px] text-[var(--sl-muted)] transition-colors hover:border-[var(--sl-border-hover)] hover:text-[var(--sl-text)]"
        >
          <span className="flex items-center gap-2">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            Search commands
          </span>
          <kbd className="rounded border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-1.5 py-0.5 text-[9px] font-semibold">{navigator.platform?.toLowerCase().includes('mac') ? '\u2318K' : 'Ctrl+K'}</kbd>
        </button>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-[7px] text-[13px] font-medium text-[var(--sl-muted)] transition-all hover:bg-red-500/8 hover:text-red-400"
        >
          {icons.logout}
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--sl-bg)] text-[var(--sl-text)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-[var(--sl-accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg">Skip to content</a>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className={`fixed left-[max(0.75rem,env(safe-area-inset-left))] z-40 rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface)] p-2 text-[var(--sl-muted)] shadow-[var(--sl-shadow)] md:hidden ${macChromeInset ? 'top-12' : 'top-[max(0.75rem,env(safe-area-inset-top))]'}`}
        aria-label="Open menu"
      >
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <button
        onClick={() => setMobileOpen(false)}
        className={`fixed z-[52] right-[max(0.75rem,env(safe-area-inset-right))] rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface)] p-2 text-[var(--sl-muted)] shadow-[var(--sl-shadow)] md:hidden transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        } ${macChromeInset ? 'top-12' : 'top-[max(0.75rem,env(safe-area-inset-top))]'}`}
        aria-label="Close menu"
      >
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-[var(--sl-border)]
          bg-[var(--sl-bg)] transition-transform duration-200
          md:static md:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {sidebar}
      </aside>

      {/* Main content */}
      <main id="main-content" className={`relative z-10 flex-1 overflow-y-auto pt-16 md:pt-0 ${macChromeInset ? 'md:pt-8' : ''}`}>
        <header className={`sticky top-0 z-20 border-b border-[var(--sl-border)] bg-[rgba(8,16,25,0.85)] px-4 py-3.5 backdrop-blur-xl sm:px-6 md:px-8 ${macChromeInset ? 'md:pt-10' : ''}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[1.1rem] font-semibold tracking-tight text-[var(--sl-text)] sm:text-[1.2rem] truncate">{pageTitle}</h2>
              <p className="mt-0.5 text-[12px] text-[var(--sl-muted)] truncate">{pageDescription}</p>
            </div>

            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <button onClick={handleOpenInstall} className="sl-btn-primary sl-btn-sm flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                Install
              </button>
            </div>
          </div>
        </header>

        <UpdateBanner />

        <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
