// ─── API Client ──────────────────────────────────────────────────────
// Typed fetch wrapper for the SideLink REST API with 401 interception.

import type {
  AppleAccount,
  DesktopHealthSnapshot,
  DeviceInfo,
  HelperDoctorSnapshot,
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
const DEFAULT_GET_CACHE_TTL_MS = 1500;

interface ApiRes<T = unknown> { ok: boolean; data?: T; error?: string }
interface ApiErrorShape { error?: string; ok?: boolean }

type RequestOptions = {
  signal?: AbortSignal;
  suppressSessionExpiryHandling?: boolean;
  cacheTtlMs?: number;
  cacheKey?: string;
  bypassCache?: boolean;
};

export type ReadRequestOptions = Pick<RequestOptions, 'signal' | 'bypassCache' | 'cacheTtlMs' | 'cacheKey'>;

type CacheEntry = {
  expiresAt: number;
  value?: ApiRes<unknown>;
  promise?: Promise<ApiRes<unknown>>;
};

const responseCache = new Map<string, CacheEntry>();

export interface AppleTrustedPhoneNumber {
  id: number;
  numberWithDialCode: string;
}

export interface Apple2FAChallenge {
  requires2FA: true;
  authType?: string;
  trustedPhoneNumbers?: AppleTrustedPhoneNumber[];
}

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

export type AuthStateResetReason = 'session-expired' | 'password-changed';

let onSessionExpired: ((reason: AuthStateResetReason) => void) | null = null;

export function setSessionExpiredHandler(handler: (reason: AuthStateResetReason) => void) {
  onSessionExpired = handler;
}

export function notifyAuthStateReset(reason: AuthStateResetReason = 'password-changed') {
  onSessionExpired?.(reason);
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

function getCacheKey(method: string, path: string, body: unknown, explicitKey?: string): string {
  if (explicitKey) return explicitKey;
  if (body === undefined) return `${method}:${path}`;
  return `${method}:${path}:${JSON.stringify(body)}`;
}

function invalidateResponseCache(prefix?: string): void {
  if (!prefix) {
    responseCache.clear();
    return;
  }

  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) {
      responseCache.delete(key);
    }
  }
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
  opts?: RequestOptions,
): Promise<ApiRes<T>> {
  const isGet = method === 'GET';
  const cacheTtlMs = isGet ? (opts?.cacheTtlMs ?? DEFAULT_GET_CACHE_TTL_MS) : 0;
  const cacheable = isGet && cacheTtlMs > 0 && !opts?.signal;
  const cacheKey = cacheable ? getCacheKey(method, path, body, opts?.cacheKey) : null;

  if (cacheKey && !opts?.bypassCache) {
    const existing = responseCache.get(cacheKey);
    if (existing?.value && existing.expiresAt > Date.now()) {
      return existing.value as ApiRes<T>;
    }
    if (existing?.promise) {
      return existing.promise as Promise<ApiRes<T>>;
    }
  }

  const fetchPromise = (async () => {
  const init: RequestInit = {
    method,
    credentials: 'include',
    signal: opts?.signal,
    cache: 'no-store',
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
        onSessionExpired?.('session-expired');
        throw createApiError(401, 'Session expired', payload);
      }
    }

    if (!res.ok || !payload.ok) {
      throw createApiError(res.status, payload.error ?? fallbackError, payload);
    }

    if (cacheKey) {
      responseCache.set(cacheKey, {
        value: payload,
        expiresAt: Date.now() + cacheTtlMs,
      });
    } else if (!isGet) {
      invalidateResponseCache();
    }

    return payload;
  })();

  if (cacheKey) {
    responseCache.set(cacheKey, {
      expiresAt: Date.now() + cacheTtlMs,
      value: responseCache.get(cacheKey)?.value,
      promise: fetchPromise as Promise<ApiRes<unknown>>,
    });
  }

  try {
    return await fetchPromise;
  } finally {
    if (cacheKey) {
      const current = responseCache.get(cacheKey);
      if (current?.promise === fetchPromise) {
        if (current.value && current.expiresAt > Date.now()) {
          responseCache.set(cacheKey, { value: current.value, expiresAt: current.expiresAt });
        } else {
          responseCache.delete(cacheKey);
        }
      }
    }
  }
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
    cache: 'no-store',
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
    onSessionExpired?.('session-expired');
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
    request<AppleAccount | Apple2FAChallenge>('POST', '/apple/signin', { appleId, password }, {
      suppressSessionExpiryHandling: true,
    }),
  submitApple2FA: (data: { appleId: string; password: string; code: string; method?: 'totp' | 'sms'; phoneId?: number }) =>
    request<AppleAccount>('POST', '/apple/2fa', data, {
      suppressSessionExpiryHandling: true,
    }),
  requestAppleSMS: (appleId: string, phoneNumberId: number) =>
    request('POST', '/apple/2fa/sms', { appleId, phoneNumberId }, {
      suppressSessionExpiryHandling: true,
    }),
  listAppleAccounts: (opts?: ReadRequestOptions) => request<AppleAccount[]>('GET', '/apple/accounts', undefined, { cacheTtlMs: 2_000, cacheKey: 'GET:/apple/accounts', ...opts }),
  getAppleAccount: (id: string) => request<AppleAccount>('GET', `/apple/accounts/${encodeURIComponent(id)}`),
  removeAppleAccount: (id: string) => request('DELETE', `/apple/accounts/${encodeURIComponent(id)}`),
  reAuthAccount: (id: string) =>
    request<AppleAccount | Apple2FAChallenge>('POST', `/apple/accounts/${encodeURIComponent(id)}/reauth`, undefined, {
      suppressSessionExpiryHandling: true,
    }),
  reAuthSubmit2FA: (id: string, code: string) =>
    request<AppleAccount>('POST', `/apple/accounts/${encodeURIComponent(id)}/reauth/2fa`, { code }, {
      suppressSessionExpiryHandling: true,
    }),

  // ── Devices ─────────────────────────────────────────────────────────
  listDevices: (opts?: ReadRequestOptions) => request<DeviceInfo[]>('GET', '/devices', undefined, { cacheTtlMs: 2_000, cacheKey: 'GET:/devices', ...opts }),
  refreshDevices: () => request<DeviceInfo[]>('POST', '/devices/refresh'),
  pairDevice: (udid: string) => request('POST', `/devices/${encodeURIComponent(udid)}/pair`),

  // ── IPAs ────────────────────────────────────────────────────────────
  listIpas: (opts?: ReadRequestOptions) => request<IpaArtifact[]>('GET', '/ipas', undefined, { cacheTtlMs: 2_500, cacheKey: 'GET:/ipas', ...opts }),
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
  importLocalIpaPath: (filepath: string) => request<IpaArtifact>('POST', '/ipas/import-path', { path: filepath }),

  // ── Sources ────────────────────────────────────────────────────────
  listSources: (opts?: ReadRequestOptions) => request<UserSource[]>('GET', '/sources', undefined, { cacheTtlMs: 5_000, cacheKey: 'GET:/sources', ...opts }),
  addSource: (url: string) => request<UserSource>('POST', '/sources', { url }),
  deleteSource: (id: string) => request('DELETE', `/sources/${encodeURIComponent(id)}`),
  refreshSource: (id: string) => request<UserSource>('POST', `/sources/${encodeURIComponent(id)}/refresh`),
  listSourceApps: (id: string) => request<SourceApp[]>('GET', `/sources/${encodeURIComponent(id)}/apps`),
  getSourceManifest: (id: string) => request<SourceManifest>('GET', `/sources/${encodeURIComponent(id)}/manifest`),
  getCombinedSources: (opts?: ReadRequestOptions) => request<SourceManifest>('GET', '/sources/combined', undefined, { cacheTtlMs: 5_000, cacheKey: 'GET:/sources/combined', ...opts }),
  listTrustedSources: (opts?: ReadRequestOptions) => request<TrustedSourceRecord[]>('GET', '/sources/trusted-sources', undefined, { cacheTtlMs: 5_000, cacheKey: 'GET:/sources/trusted-sources', ...opts }),
  getSelfHostedSource: async () => ({ ok: true, data: await requestRawJson<SourceManifest>('GET', '/sources/self-hosted') }),
  updateSelfHostedSource: (manifest: SourceManifest) => request('PUT', '/sources/self-hosted', manifest),

  // ── Install / Pipeline ──────────────────────────────────────────────
  startInstall: (params: { accountId: string; ipaId: string; deviceUdid: string; includeExtensions?: boolean; bundleIdStrategy?: string; customDisplayName?: string }) =>
    request<InstallJob>('POST', '/install', params),
  listJobs: (opts?: ReadRequestOptions) => request<InstallJob[]>('GET', '/install/jobs', undefined, { cacheTtlMs: 2_000, cacheKey: 'GET:/install/jobs', ...opts }),
  getJob: (id: string, opts?: ReadRequestOptions) => request<InstallJob>('GET', `/install/jobs/${encodeURIComponent(id)}`, undefined, { cacheTtlMs: 1_000, ...opts }),
  getJobLogs: (id: string, opts?: ReadRequestOptions) => request<JobLogEntry[]>('GET', `/install/jobs/${encodeURIComponent(id)}/logs`, undefined, { cacheTtlMs: 1_000, ...opts }),
  submitJob2FA: (jobId: string, code: string) =>
    request('POST', `/install/jobs/${encodeURIComponent(jobId)}/2fa`, { code }),
  listInstalledApps: (opts?: ReadRequestOptions) => request<InstalledApp[]>('GET', '/install/apps', undefined, { cacheTtlMs: 2_000, cacheKey: 'GET:/install/apps', ...opts }),
  removeInstalledApp: (id: string) => request('DELETE', `/install/apps/${encodeURIComponent(id)}`),
  deactivateInstalledApp: (id: string) => request<InstalledApp>('POST', `/install/apps/${encodeURIComponent(id)}/deactivate`),
  reactivateInstalledApp: (id: string) => request<InstallJob>('POST', `/install/apps/${encodeURIComponent(id)}/reactivate`),

  // ── System ──────────────────────────────────────────────────────────
  dashboard: (opts?: ReadRequestOptions) => request<DashboardState>('GET', '/system/dashboard', undefined, { cacheTtlMs: 2_000, cacheKey: 'GET:/system/dashboard', ...opts }),
  listLogs: (level?: string) => request<LogEntry[]>('GET', `/system/logs${level ? `?level=${encodeURIComponent(level)}` : ''}`),
  clearLogs: () => request('DELETE', '/system/logs'),
  getScheduler: (opts?: ReadRequestOptions) => request<SchedulerSnapshot>('GET', '/system/scheduler', undefined, { cacheTtlMs: 2_000, cacheKey: 'GET:/system/scheduler', ...opts }),
  updateScheduler: (config: Partial<{ enabled: boolean; checkIntervalMs: number }>) =>
    request<SchedulerSnapshot>('POST', '/system/scheduler', config),
  triggerRefresh: (installedAppId: string) =>
    request('POST', `/system/scheduler/refresh/${encodeURIComponent(installedAppId)}`),
  triggerRefreshAll: () =>
    request<{ triggered: number; skipped: number; errors: string[] }>('POST', '/system/scheduler/refresh-all'),
  getAutoRefreshStates: (opts?: ReadRequestOptions) => request<AutoRefreshState[]>('GET', '/system/scheduler/states', undefined, { cacheTtlMs: 2_000, cacheKey: 'GET:/system/scheduler/states', ...opts }),
  desktopHealth: (opts?: ReadRequestOptions) => request<DesktopHealthSnapshot>('GET', '/system/desktop-health', undefined, { cacheTtlMs: 2_000, cacheKey: 'GET:/system/desktop-health', ...opts }),
  helperDoctor: (opts?: ReadRequestOptions) => request<HelperDoctorSnapshot & {
    appleRuntime?: {
      isPackaged: boolean;
      hasBundledPython: boolean;
      pythonBinaryPath: string;
      scriptsPath: string;
      ready: boolean;
      checks: {
        helperBinary: boolean;
        selfCheck: boolean;
        anisette: boolean;
        gsaDispatch: boolean;
      };
      error?: string;
    };
  }>('GET', '/system/helper/doctor', undefined, { cacheTtlMs: 2_500, cacheKey: 'GET:/system/helper/doctor', ...opts }),
  ensureHelperIpa: (teamId?: string) =>
    request<{
      built: boolean;
      helperIpaPath: string;
      importedIpa: IpaArtifact;
      teamId?: string | null;
      teamIdSource?: 'request' | 'env' | 'apple-account-authenticated' | 'apple-account-any' | 'xcode-signing-identity' | 'none';
    }>('POST', '/system/helper/ensure', teamId ? { teamId } : {}),
  createHelperPairingCode: () =>
    request<{ code: string; expiresAt: string; ttlMs: number; qrPayload?: string; backendUrl?: string; apiBasePath?: string | null; candidateAddresses?: string[]; serverName?: string; serverVersion?: string }>('POST', '/system/helper/pairing-code'),

  listAppleAppIds: (sync = false, opts?: ReadRequestOptions) => request<AppleAppIdRecord[]>('GET', `/apple/app-ids${sync ? '?sync=true' : ''}`, undefined, { cacheTtlMs: sync ? 0 : 2_500, cacheKey: sync ? undefined : 'GET:/apple/app-ids', ...opts }),
  listAppleAppIdUsage: (opts?: ReadRequestOptions) => request<AppleAppIdUsageRecord[]>('GET', '/apple/app-ids/usage', undefined, { cacheTtlMs: 2_500, cacheKey: 'GET:/apple/app-ids/usage', ...opts }),
  deleteAppleAppId: (id: string) => request('DELETE', `/apple/app-ids/${encodeURIComponent(id)}`),
  listAppleCertificates: (opts?: ReadRequestOptions) => request<AppleCertificateRecord[]>('GET', '/apple/certificates', undefined, { cacheTtlMs: 2_500, cacheKey: 'GET:/apple/certificates', ...opts }),
  rotateCertificate: (accountId: string) => request<{ newCertificate: { id: string; serialNumber: string; commonName: string; expiresAt: string; createdAt: string }; revokedCount: number }>('POST', `/apple/accounts/${encodeURIComponent(accountId)}/rotate-certificate`),
  health: (opts?: ReadRequestOptions) => request<{ status: string; uptime: number }>('GET', '/health', undefined, { cacheTtlMs: 2_500, cacheKey: 'GET:/health', ...opts }),
};
