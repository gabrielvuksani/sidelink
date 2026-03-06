// ─── API Client ──────────────────────────────────────────────────────
// Typed fetch wrapper for the Sidelink REST API with 401 interception.

import type {
  AppleAccount,
  DeviceInfo,
  IpaArtifact,
  InstallJob,
  InstalledApp,
  JobLogEntry,
  LogEntry,
  DashboardState,
  SchedulerSnapshot,
  AutoRefreshState,
  UserSession,
  SourceManifest,
  SourceApp,
  UserSource,
} from '../../../shared/types';

const BASE = '/api';

interface ApiRes<T = unknown> { ok: boolean; data?: T; error?: string }

// ── Global 401 listener ──────────────────────────────────────────────
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

// ── CSRF helper —————————————————————————————————
function getCsrfToken(): string | undefined {
  return document.cookie.split('; ').find(c => c.startsWith('_csrf='))?.split('=')[1];
}

// ── Core request ─────────────────────────────────────────────────────
async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { signal?: AbortSignal; suppressSessionExpiryHandling?: boolean },
): Promise<ApiRes<T>> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    signal: opts?.signal,
  };
  const csrfHeaders: Record<string, string> = {};
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = getCsrfToken();
    if (csrf) csrfHeaders['X-CSRF-Token'] = csrf;
  }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...csrfHeaders };
    init.body = JSON.stringify(body);
  } else if (Object.keys(csrfHeaders).length) {
    init.headers = csrfHeaders;
  }

  const res = await fetch(`${BASE}${path}`, init);
  const json: ApiRes<T> = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));

  // Intercept 401 only when it is truly a session/auth expiration case.
  // Apple credential failures also return 401 and must not force logout.
  if (
    res.status === 401
    && !path.startsWith('/auth/')
    && !opts?.suppressSessionExpiryHandling
  ) {
    const errText = (json.error ?? '').toLowerCase();
    const likelySessionError =
      errText.includes('session')
      || errText.includes('authentication required')
      || errText.includes('invalid or expired session')
      || errText.includes('not authenticated');

    if (likelySessionError) {
      onSessionExpired?.();
      throw Object.assign(new Error('Session expired'), { status: 401, data: json });
    }
  }
  if (!json.ok) {
    const err = Object.assign(new Error(json.error ?? 'Request failed'), {
      data: json,
      status: res.status,
    });
    throw err;
  }
  return json;
}

async function requestRawJson<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
  };

  const csrfHeaders: Record<string, string> = {};
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = getCsrfToken();
    if (csrf) csrfHeaders['X-CSRF-Token'] = csrf;
  }

  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...csrfHeaders };
    init.body = JSON.stringify(body);
  } else if (Object.keys(csrfHeaders).length) {
    init.headers = csrfHeaders;
  }

  const res = await fetch(`${BASE}${path}`, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = Object.assign(new Error(`HTTP ${res.status}`), {
      status: res.status,
      data,
    });
    throw err;
  }
  return data as T;
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────
  authStatus: () => request<{ setupComplete: boolean; authenticated: boolean }>('GET', '/auth/status'),
  setup: (username: string, password: string) =>
    request<UserSession>('POST', '/auth/setup', { username, password }),
  login: (username: string, password: string) =>
    request<UserSession>('POST', '/auth/login', { username, password }),
  logout: () => request('POST', '/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request('POST', '/auth/password', { currentPassword, newPassword }),

  // ── Apple Accounts ──────────────────────────────────────────────────
  appleSignIn: (appleId: string, password: string) =>
    request<AppleAccount | { requires2FA: boolean; authType: string }>('POST', '/apple/signin', { appleId, password }, {
      suppressSessionExpiryHandling: true,
    }),
  submitApple2FA: (data: { appleId: string; password: string; code: string }) =>
    request<AppleAccount>('POST', '/apple/2fa', data, {
      suppressSessionExpiryHandling: true,
    }),
  requestAppleSMS: (appleId: string, phoneNumberId: number) =>
    request('POST', '/apple/2fa/sms', { appleId, phoneNumberId }, {
      suppressSessionExpiryHandling: true,
    }),
  listAppleAccounts: () => request<AppleAccount[]>('GET', '/apple/accounts'),
  getAppleAccount: (id: string) => request<AppleAccount>('GET', `/apple/accounts/${id}`),
  removeAppleAccount: (id: string) => request('DELETE', `/apple/accounts/${id}`),
  reAuthAccount: (id: string) =>
    request<AppleAccount | { requires2FA: boolean; authType: string }>('POST', `/apple/accounts/${id}/reauth`, undefined, {
      suppressSessionExpiryHandling: true,
    }),
  reAuthSubmit2FA: (id: string, code: string) =>
    request<AppleAccount>('POST', `/apple/accounts/${id}/reauth/2fa`, { code }, {
      suppressSessionExpiryHandling: true,
    }),

  // ── Devices ─────────────────────────────────────────────────────────
  listDevices: () => request<DeviceInfo[]>('GET', '/devices'),
  refreshDevices: () => request<DeviceInfo[]>('POST', '/devices/refresh'),
  pairDevice: (udid: string) => request('POST', `/devices/${encodeURIComponent(udid)}/pair`),

  // ── IPAs ────────────────────────────────────────────────────────────
  listIpas: () => request<IpaArtifact[]>('GET', '/ipas'),
  uploadIpa: async (file: File, onProgress?: (pct: number) => void): Promise<ApiRes<IpaArtifact>> => {
    const form = new FormData();
    form.append('ipa', file);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          onSessionExpired?.();
          return reject(Object.assign(new Error('Session expired'), { status: 401 }));
        }
        try {
          const json = JSON.parse(xhr.responseText) as ApiRes<IpaArtifact>;
          if (json.ok) resolve(json);
          else reject(new Error(json.error ?? `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.ontimeout = () => reject(new Error('Upload timed out'));
      xhr.timeout = 10 * 60 * 1000; // 10 minutes
      xhr.open('POST', `${BASE}/ipas/upload`);
      xhr.withCredentials = true;
      const csrf = getCsrfToken();
      if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
      xhr.send(form);
    });
  },
  getIpa: (id: string) => request<IpaArtifact>('GET', `/ipas/${id}`),
  deleteIpa: (id: string) => request('DELETE', `/ipas/${id}`),
  importIpaFromUrl: (url: string) => request<IpaArtifact>('POST', '/ipas/import-url', { url }),

  // ── Sources ────────────────────────────────────────────────────────
  listSources: () => request<UserSource[]>('GET', '/sources'),
  addSource: (url: string) => request<UserSource>('POST', '/sources', { url }),
  deleteSource: (id: string) => request('DELETE', `/sources/${encodeURIComponent(id)}`),
  refreshSource: (id: string) => request<UserSource>('POST', `/sources/${encodeURIComponent(id)}/refresh`),
  listSourceApps: (id: string) => request<SourceApp[]>('GET', `/sources/${encodeURIComponent(id)}/apps`),
  getSourceManifest: (id: string) => request<SourceManifest>('GET', `/sources/${encodeURIComponent(id)}/manifest`),
  getCombinedSources: () => request<SourceManifest>('GET', '/sources/combined'),
  getSelfHostedSource: async () => ({ ok: true, data: await requestRawJson<SourceManifest>('GET', '/sources/self-hosted') }),
  updateSelfHostedSource: (manifest: SourceManifest) => request('PUT', '/sources/self-hosted', manifest),

  // ── Install / Pipeline ──────────────────────────────────────────────
  startInstall: (params: { accountId: string; ipaId: string; deviceUdid: string; includeExtensions?: boolean }) =>
    request<InstallJob>('POST', '/install', params),
  listJobs: () => request<InstallJob[]>('GET', '/install/jobs'),
  getJob: (id: string) => request<InstallJob>('GET', `/install/jobs/${id}`),
  getJobLogs: (id: string) => request<JobLogEntry[]>('GET', `/install/jobs/${id}/logs`),
  submitJob2FA: (jobId: string, code: string) =>
    request('POST', `/install/jobs/${encodeURIComponent(jobId)}/2fa`, { code }),
  listInstalledApps: () => request<InstalledApp[]>('GET', '/install/apps'),
  removeInstalledApp: (id: string) => request('DELETE', `/install/apps/${id}`),

  // ── System ──────────────────────────────────────────────────────────
  dashboard: () => request<DashboardState>('GET', '/system/dashboard'),
  listLogs: (level?: string) => request<LogEntry[]>('GET', `/system/logs${level ? `?level=${level}` : ''}`),
  clearLogs: () => request('DELETE', '/system/logs'),
  getScheduler: () => request<SchedulerSnapshot>('GET', '/system/scheduler'),
  updateScheduler: (config: Partial<{ enabled: boolean; checkIntervalMs: number }>) =>
    request<SchedulerSnapshot>('POST', '/system/scheduler', config),
  triggerRefresh: (installedAppId: string) =>
    request('POST', `/system/scheduler/refresh/${encodeURIComponent(installedAppId)}`),
  getAutoRefreshStates: () => request<AutoRefreshState[]>('GET', '/system/scheduler/states'),
  helperDoctor: () => request<{
    platform: string;
    helperIpaPath: string;
    helperIpaExists: boolean;
    helperProjectDir: string;
    xcodeProjectExists: boolean;
    projectYmlExists: boolean;
    hasXcodebuild: boolean;
    hasXcodegen: boolean;
    helperPaired?: boolean;
    detectedTeamId?: string | null;
    detectedTeamIdSource?: 'request' | 'env' | 'apple-account-authenticated' | 'apple-account-any' | 'xcode-signing-identity' | 'none';
  }>('GET', '/system/helper/doctor'),
  ensureHelperIpa: (teamId?: string) =>
    request<{
      built: boolean;
      helperIpaPath: string;
      importedIpa: IpaArtifact;
      teamId?: string | null;
      teamIdSource?: 'request' | 'env' | 'apple-account-authenticated' | 'apple-account-any' | 'xcode-signing-identity' | 'none';
    }>('POST', '/system/helper/ensure', teamId ? { teamId } : {}),
  createHelperPairingCode: () =>
    request<{ code: string; expiresAt: string; ttlMs: number }>('POST', '/system/helper/pairing-code'),
  health: () => request<{ status: string; uptime: number }>('GET', '/health'),
};
