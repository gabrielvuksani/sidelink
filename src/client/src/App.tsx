import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useState, useEffect, lazy, Suspense } from 'react';
import { api, setSessionExpiredHandler } from './lib/api';
import { getElectronAPI } from './lib/electron';
import { ToastProvider, useToast } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmModal';
import { InstallModalProvider } from './components/InstallModal';
import { DesktopReadinessGate } from './components/DesktopReadinessGate';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommandPalette } from './components/CommandPalette';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

const SetupWizard = lazy(() => import('./pages/SetupWizard'));
const AppleAccountPage = lazy(() => import('./pages/AppleAccountPage'));
const DevicesPage = lazy(() => import('./pages/DevicesPage'));
const AppsPage = lazy(() => import('./pages/AppsPage'));
const InstallPage = lazy(() => import('./pages/InstallPage'));
const InstalledPage = lazy(() => import('./pages/InstalledPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SourcesPage = lazy(() => import('./pages/SourcesPage'));

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--sl-accent)]/70 border-t-transparent" />
          <span className="text-sm text-[var(--sl-muted)]">Loading...</span>
        </div>
      </div>
    }>
      {children}
    </Suspense>
  );
}

export default function App() {
  const [authState, setAuthState] = useState<{
    loading: boolean;
    setupComplete: boolean;
    authenticated: boolean;
  }>({ loading: true, setupComplete: false, authenticated: false });
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState(false);

  // Register global 401 handler
  useEffect(() => {
    setSessionExpiredHandler((reason) => {
      setAuthState(s => ({ ...s, authenticated: false }));
      setSessionExpiredMsg(reason === 'session-expired');
    });
  }, []);

  useEffect(() => {
    api.authStatus()
      .then(res => setAuthState({ loading: false, ...(res.data ?? { setupComplete: false, authenticated: false }) }))
      .catch(() => setAuthState({ loading: false, setupComplete: false, authenticated: false }));
  }, []);

  if (authState.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--sl-bg)]">
        <div className="sl-page-hero max-w-md">
          <div className="sl-page-hero-inner !grid-cols-1">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--sl-accent)]/70 border-t-transparent" />
            <div>
              <p className="text-sm font-medium text-[var(--sl-text)]">Loading SideLink</p>
              <p className="text-xs text-[var(--sl-muted)]">Preparing the desktop control surface...</p>
            </div>
          </div>
          </div>
        </div>
      </div>
    );
  }

  // Not yet set up → force setup
  if (!authState.setupComplete) {
    return (
      <ToastProvider>
        <PageSuspense>
          <SetupWizard onComplete={() => setAuthState(s => ({ ...s, setupComplete: true, authenticated: true }))} />
        </PageSuspense>
      </ToastProvider>
    );
  }

  // Not authenticated → login
  if (!authState.authenticated) {
    return (
      <ToastProvider>
        <LoginPage
          onLogin={() => { setAuthState(s => ({ ...s, authenticated: true })); setSessionExpiredMsg(false); }}
          sessionExpired={sessionExpiredMsg}
        />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <ConfirmProvider>
        <InstallModalProvider>
          <DesktopReadinessGate>
            <Layout onLogout={() => setAuthState(s => ({ ...s, authenticated: false }))}>
              <ErrorBoundary>
                <CommandPalette />
                <DeepLinkHandler />
                <NativeNotifications />
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/apple" element={<PageSuspense><AppleAccountPage /></PageSuspense>} />
                  <Route path="/devices" element={<PageSuspense><DevicesPage /></PageSuspense>} />
                  <Route path="/apps" element={<PageSuspense><AppsPage /></PageSuspense>} />
                  <Route path="/install" element={<PageSuspense><InstallPage /></PageSuspense>} />
                  <Route path="/installed" element={<PageSuspense><InstalledPage /></PageSuspense>} />
                  <Route path="/logs" element={<PageSuspense><LogsPage /></PageSuspense>} />
                  <Route path="/sources" element={<PageSuspense><SourcesPage /></PageSuspense>} />
                  <Route path="/settings" element={<PageSuspense><SettingsPage /></PageSuspense>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </ErrorBoundary>
            </Layout>
          </DesktopReadinessGate>
        </InstallModalProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

/** Map sidelink:// deep link actions to client routes */
const DEEP_LINK_ROUTES: Record<string, string> = {
  install: '/install',
  apps: '/apps',
  devices: '/devices',
  apple: '/apple',
  settings: '/settings',
  logs: '/logs',
  sources: '/sources',
  installed: '/installed',
  dashboard: '/',
};

function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.onDeepLink) return;

    const unsub = api.onDeepLink(({ action, params }) => {
      const route = DEEP_LINK_ROUTES[action];
      if (route) {
        const qs = new URLSearchParams(params).toString();
        navigate(qs ? `${route}?${qs}` : route);
      }
    });
    api.markRendererReady?.();

    return unsub;
  }, [navigate]);

  return null;
}

/** Register Electron IPC listeners for native notifications (U-02). */
function NativeNotifications() {
  const { toast } = useToast();
  useEffect(() => {
    const electronApi = getElectronAPI();
    if (!electronApi) return;

    const unsubs: Array<() => void> = [];

    if (electronApi.onInstallComplete) {
      unsubs.push(electronApi.onInstallComplete(({ appName }) => {
        toast('success', `Install complete: ${appName}`);
      }));
    }
    if (electronApi.onDeviceConnected) {
      unsubs.push(electronApi.onDeviceConnected(({ name }) => {
        toast('info', `Device connected: ${name}`);
      }));
    }

    return () => unsubs.forEach(fn => fn());
  }, [toast]);

  return null;
}
