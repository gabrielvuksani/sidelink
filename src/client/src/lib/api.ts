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
interface ApiErrorShape { error?: string; ok?: boolean }

export interface AppleAppIdRecord {
  id: string;
  accountId: string;
  teamId: string;
  portalAppIdId: string;
  bundleId: string;
  name: string;
  originalBundleId: string;
  createdAt: string;
  accountAppleId?: string;
  teamName?: string;
}

export interface AppleAppIdUsageRecord {
  accountId: string;
  appleId: string;
  teamId: string;
  active: number;
  weeklyCreated: number;
  maxActive: number;
  maxWeekly: number;
}

export interface AppleCertificateRecord {
  id: string;
  accountId: string;
  teamId: string;
  serialNumber: string;
  commonName: string;
  expiresAt: string;
  revokedAt?: string | null;
  createdAt: string;
  accountAppleId?: string;
  teamName?: string;
}

export interface TrustedSourceRecord {
  id: string;
  name: string;
  url: string;
  iconURL?: string;
  description?: string;
}

// ── Global 401 listener ──────────────────────────────────────────────
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

// ── CSRF helper —————————————————————————————————
function getCsrfToken(): string | undefined {
  return document.cookie.split('; ').find(c => c.startsWith('_csrf='))?.split('=')[1];
}

function isMutationMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function isLikelySessionExpiryError(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return normalized.includes('session')
    || normalized.includes('authentication required')
    || normalized.includes('invalid or expired session')
    || normalized.includes('not authenticated');
}

function createApiError(status: number, error: string, data?: unknown): Error & { status: number; data?: unknown } {
  return Object.assign(new Error(error), { status, data });
}

async function parseJsonResponse<T>(res: Response): Promise<ApiRes<T> | null> {
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }
  return res.json() as Promise<ApiRes<T>>;
}

async function parseResponsePayload<T>(res: Response): Promise<{ json: ApiRes<T> | null; text: string | null }> {
  const json = await parseJsonResponse<T>(res).catch(() => null);
  if (json) {
    return { json, text: null };
  }

  const text = await res.text().catch(() => '');
  return { json: null, text: text.trim() || null };
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
  if (isMutationMethod(method)) {
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
  const { json, text } = await parseResponsePayload<T>(res);
  const fallbackError = text ?? `HTTP ${res.status}`;
  const payload = json ?? { ok: res.ok, error: res.ok ? undefined : fallbackError };

  // Intercept 401 only when it is truly a session/auth expiration case.
  // Apple credential failures also return 401 and must not force logout.
  if (
    res.status === 401
    && !path.startsWith('/auth/')
    && !opts?.suppressSessionExpiryHandling
  ) {
    const errText = payload.error ?? fallbackError;
    if (isLikelySessionExpiryError(errText)) {
      onSessionExpired?.();
      throw createApiError(401, 'Session expired', payload);
    }
  }
  if (!res.ok || !payload.ok) {
    throw createApiError(res.status, payload.error ?? fallbackError, payload);
  }
  return payload;
}

async function requestRawJson<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { suppressSessionExpiryHandling?: boolean },
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
  };

  const csrfHeaders: Record<string, string> = {};
  if (isMutationMethod(method)) {
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
  const data = await res.json().catch(() => null) as ApiErrorShape | T | null;
  const errorText = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
    ? data.error
    : `HTTP ${res.status}`;

  if (
    res.status === 401
    && !path.startsWith('/auth/')
    && !opts?.suppressSessionExpiryHandling
    && isLikelySessionExpiryError(errorText)
  ) {
    onSessionExpired?.();
    throw createApiError(401, 'Session expired', data);
  }

  if (!res.ok) {
    throw createApiError(res.status, errorText, data);
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
  getAppleAccount: (id: string) => request<AppleAccount>('GET', `/apple/accounts/${encodeURIComponent(id)}`),
  removeAppleAccount: (id: string) => request('DELETE', `/apple/accounts/${encodeURIComponent(id)}`),
  reAuthAccount: (id: string) =>
    request<AppleAccount | { requires2FA: boolean; authType: string }>('POST', `/apple/accounts/${encodeURIComponent(id)}/reauth`, undefined, {
      suppressSessionExpiryHandling: true,
    }),
  reAuthSubmit2FA: (id: string, code: string) =>
    request<AppleAccount>('POST', `/apple/accounts/${encodeURIComponent(id)}/reauth/2fa`, { code }, {
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
        try {
          const json = JSON.parse(xhr.responseText) as ApiRes<IpaArtifact>;
          if (xhr.status === 401 && isLikelySessionExpiryError(json.error ?? '')) {
            onSessionExpired?.();
            return reject(createApiError(401, 'Session expired', json));
          }
          if (xhr.status >= 400 || !json.ok) {
            return reject(createApiError(xhr.status, json.error ?? `Upload failed: ${xhr.status}`, json));
          }
          resolve(json);
        } catch {
          if (xhr.status === 401) {
            onSessionExpired?.();
            reject(createApiError(401, 'Session expired'));
            return;
          }
          reject(createApiError(xhr.status, `Upload failed: ${xhr.status}`));
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
  getIpa: (id: string) => request<IpaArtifact>('GET', `/ipas/${encodeURIComponent(id)}`),
  deleteIpa: (id: string) => request('DELETE', `/ipas/${encodeURIComponent(id)}`),
  importIpaFromUrl: (url: string) => request<IpaArtifact>('POST', '/ipas/import-url', { url }),

  // ── Sources ────────────────────────────────────────────────────────
  listSources: () => request<UserSource[]>('GET', '/sources'),
  addSource: (url: string) => request<UserSource>('POST', '/sources', { url }),
  deleteSource: (id: string) => request('DELETE', `/sources/${encodeURIComponent(id)}`),
  refreshSource: (id: string) => request<UserSource>('POST', `/sources/${encodeURIComponent(id)}/refresh`),
  listSourceApps: (id: string) => request<SourceApp[]>('GET', `/sources/${encodeURIComponent(id)}/apps`),
  getSourceManifest: (id: string) => request<SourceManifest>('GET', `/sources/${encodeURIComponent(id)}/manifest`),
  getCombinedSources: () => request<SourceManifest>('GET', '/sources/combined'),
  listTrustedSources: () => request<TrustedSourceRecord[]>('GET', '/sources/trusted-sources'),
  getSelfHostedSource: async () => ({ ok: true, data: await requestRawJson<SourceManifest>('GET', '/sources/self-hosted') }),
  updateSelfHostedSource: (manifest: SourceManifest) => request('PUT', '/sources/self-hosted', manifest),

  // ── Install / Pipeline ──────────────────────────────────────────────
  startInstall: (params: { accountId: string; ipaId: string; deviceUdid: string; includeExtensions?: boolean }) =>
    request<InstallJob>('POST', '/install', params),
  listJobs: () => request<InstallJob[]>('GET', '/install/jobs'),
  getJob: (id: string) => request<InstallJob>('GET', `/install/jobs/${encodeURIComponent(id)}`),
  getJobLogs: (id: string) => request<JobLogEntry[]>('GET', `/install/jobs/${encodeURIComponent(id)}/logs`),
  submitJob2FA: (jobId: string, code: string) =>
    request('POST', `/install/jobs/${encodeURIComponent(jobId)}/2fa`, { code }),
  listInstalledApps: () => request<InstalledApp[]>('GET', '/install/apps'),
  removeInstalledApp: (id: string) => request('DELETE', `/install/apps/${encodeURIComponent(id)}`),
  deactivateInstalledApp: (id: string) => request<InstalledApp>('POST', `/install/apps/${encodeURIComponent(id)}/deactivate`),
  reactivateInstalledApp: (id: string) => request<InstallJob>('POST', `/install/apps/${encodeURIComponent(id)}/reactivate`),

  // ── System ──────────────────────────────────────────────────────────
  dashboard: () => request<DashboardState>('GET', '/system/dashboard'),
  listLogs: (level?: string) => request<LogEntry[]>('GET', `/system/logs${level ? `?level=${encodeURIComponent(level)}` : ''}`),
  clearLogs: () => request('DELETE', '/system/logs'),
  getScheduler: () => request<SchedulerSnapshot>('GET', '/system/scheduler'),
  updateScheduler: (config: Partial<{ enabled: boolean; checkIntervalMs: number }>) =>
    request<SchedulerSnapshot>('POST', '/system/scheduler', config),
  triggerRefresh: (installedAppId: string) =>
    request('POST', `/system/scheduler/refresh/${encodeURIComponent(installedAppId)}`),
  triggerRefreshAll: () =>
    request<{ triggered: number; skipped: number; errors: string[] }>('POST', '/system/scheduler/refresh-all'),
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
    request<{ code: string; expiresAt: string; ttlMs: number; qrPayload?: string }>('POST', '/system/helper/pairing-code'),

  listAppleAppIds: (sync = false) => request<AppleAppIdRecord[]>('GET', `/apple/app-ids${sync ? '?sync=true' : ''}`),
  listAppleAppIdUsage: () => request<AppleAppIdUsageRecord[]>('GET', '/apple/app-ids/usage'),
  deleteAppleAppId: (id: string) => request('DELETE', `/apple/app-ids/${encodeURIComponent(id)}`),
  listAppleCertificates: () => request<AppleCertificateRecord[]>('GET', '/apple/certificates'),
  health: () => request<{ status: string; uptime: number }>('GET', '/health'),
};
