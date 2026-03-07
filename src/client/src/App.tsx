import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api, setSessionExpiredHandler } from './lib/api';
import { getElectronAPI } from './lib/electron';
import { ToastProvider, useToast } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmModal';
import { InstallModalProvider } from './components/InstallModal';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import SetupWizard from './pages/SetupWizard';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AppleAccountPage from './pages/AppleAccountPage';
import DevicesPage from './pages/DevicesPage';
import AppsPage from './pages/AppsPage';
import InstallPage from './pages/InstallPage';
import InstalledPage from './pages/InstalledPage';
import LogsPage from './pages/LogsPage';
import SettingsPage from './pages/SettingsPage';
import SourcesPage from './pages/SourcesPage';

export default function App() {
  const [authState, setAuthState] = useState<{
    loading: boolean;
    setupComplete: boolean;
    authenticated: boolean;
  }>({ loading: true, setupComplete: false, authenticated: false });
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState(false);

  // Register global 401 handler
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAuthState(s => ({ ...s, authenticated: false }));
      setSessionExpiredMsg(true);
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
        <SetupWizard onComplete={() => setAuthState(s => ({ ...s, setupComplete: true, authenticated: true }))} />
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
        <Layout onLogout={() => setAuthState(s => ({ ...s, authenticated: false }))}>
          <ErrorBoundary>
            <DeepLinkHandler />
            <NativeNotifications />
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/apple" element={<AppleAccountPage />} />
              <Route path="/devices" element={<DevicesPage />} />
              <Route path="/apps" element={<AppsPage />} />
              <Route path="/install" element={<InstallPage />} />
              <Route path="/installed" element={<InstalledPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/sources" element={<SourcesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </Layout>
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
