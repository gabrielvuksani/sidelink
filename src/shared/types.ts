// ─── Shared Types ───────────────────────────────────────────────────
// All types shared between server, client, and helper app.
// This is the single source of truth for the entire Sidelink system.

// ─── Apple Account ──────────────────────────────────────────────────

export type AppleAccountStatus =
  | 'unauthenticated'
  | 'requires_2fa'
  | 'active'
  | 'session_expired'
  | 'locked';

export interface AppleAccount {
  id: string;
  appleId: string;            // email
  teamId: string;
  teamName: string;
  accountType: 'free' | 'paid' | 'unknown';
  status: AppleAccountStatus;
  /** Encrypted password stored for re-auth */
  passwordEncrypted?: string;
  /** JSON-serialized auth cookies */
  cookiesJson?: string;
  lastAuthAt: string | null;  // ISO
  createdAt: string;
}

export interface AppleAuthInit {
  appleId: string;
  password: string;
}

export interface Apple2FASubmit {
  appleId: string;
  password: string;
  code: string;
  method?: 'totp' | 'sms';
  phoneId?: number;           // for SMS fallback
}

// ─── Certificates ───────────────────────────────────────────────────

export interface CertificateRecord {
  id: string;
  accountId: string;
  teamId: string;
  serialNumber: string;
  commonName: string;
  /** PEM-encoded certificate from Apple */
  certificatePem: string;
  /** PEM-encoded private key (encrypted at rest in DB) */
  privateKeyPem: string;
  portalCertificateId: string;
  expiresAt: string;         // ISO
  revokedAt: string | null;
  createdAt: string;
}

// ─── App IDs ────────────────────────────────────────────────────────

export interface AppIdRecord {
  id: string;
  accountId: string;
  teamId: string;
  portalAppIdId: string;
  bundleId: string;          // e.g. com.sidelink.XXXX
  name: string;
  originalBundleId: string;  // the original bundle ID from the IPA
  createdAt: string;
}

// ─── Provisioning Profiles ──────────────────────────────────────────

export interface ProvisioningProfileRecord {
  id: string;
  accountId: string;
  teamId: string;
  portalProfileId: string;
  appIdId: string;
  bundleId: string;
  /** Base64-encoded .mobileprovision data */
  profileData: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Devices ────────────────────────────────────────────────────────

export type DeviceConnectionState = 'online' | 'offline' | 'unpaired';
export type DeviceTransport = 'usb' | 'wifi' | 'unknown';

export interface DeviceInfo {
  udid: string;
  name: string;
  model: string;
  productType: string;        // e.g. iPhone15,2
  iosVersion: string;
  connection: DeviceConnectionState;
  transport: DeviceTransport;
  wifiAddress: string | null;
  paired: boolean;
}

export interface DeviceRegistration {
  id: string;
  accountId: string;
  teamId: string;
  udid: string;
  portalDeviceId: string;
  deviceName: string;
  registeredAt: string;
}

// ─── IPA Artifacts ──────────────────────────────────────────────────

export interface IpaArtifact {
  id: string;
  filename: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  bundleId: string;
  bundleName: string;
  bundleVersion: string;
  bundleShortVersion: string;
  minOsVersion: string | null;
  /** Base64-encoded app icon (if extracted) */
  iconData: string | null;
  entitlements: Record<string, unknown>;
  warnings: string[];
  /** App extensions found in the IPA (PlugIns/*.appex) */
  extensions: Array<{ bundleId: string; name: string }>;
  uploadedAt: string;
}

// ─── Install Jobs ───────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'waiting_2fa' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type PipelineStepName =
  | 'validate'
  | 'authenticate'
  | 'provision'
  | 'sign'
  | 'install'
  | 'register';

export interface PipelineStep {
  name: PipelineStepName;
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface InstallJob {
  id: string;
  ipaId: string;
  deviceUdid: string;
  accountId: string;
  /** Whether extensions should be included in signing */
  includeExtensions: boolean;
  status: JobStatus;
  currentStep: string | null;
  steps: PipelineStep[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Installed Apps ─────────────────────────────────────────────────

export interface InstalledApp {
  id: string;
  deviceUdid: string;
  accountId: string;
  ipaId: string;
  bundleId: string;
  originalBundleId: string;
  appName: string;
  appVersion: string;
  certificateId: string;
  profileId: string;
  signedIpaPath: string;
  installedAt: string;
  expiresAt: string;
  lastRefreshAt?: string | null;
  refreshCount?: number;
}

// ─── Scheduler ──────────────────────────────────────────────────────

export interface SchedulerConfig {
  enabled: boolean;
  checkIntervalMs: number;
  refreshThresholdMs?: number;
}

export interface SchedulerSnapshot {
  enabled: boolean;
  running: boolean;
  checkIntervalMs: number;
  refreshThresholdMs: number;
  lastCheckAt: string | null;
  lastError: string | null;
  pendingRefreshCount: number;
}

export interface AutoRefreshState {
  installedAppId: string;
  bundleId: string;
  appName: string;
  deviceUdid: string;
  expiresAt: string;
  isExpired: boolean;
  needsRefresh: boolean;
  msUntilExpiry: number;
  refreshInProgress: boolean;
  lastRefreshAt: string | null;
  lastError: string | null;
}

// ─── Logs ───────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  level: LogLevel;
  code: string;
  message: string;
  meta: Record<string, unknown> | null;
  at: string;
}

export interface JobLogEntry {
  id: string;
  jobId: string;
  step: PipelineStepName | null;
  level: LogLevel;
  message: string;
  meta: Record<string, unknown> | null;
  at: string;
}

// ─── Local Auth (admin dashboard) ───────────────────────────────────

export interface UserRecord {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

export interface UserSession {
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Config ─────────────────────────────────────────────────────────

export interface AppConfig {
  port: number;
  host: string;
  uploadDir: string;
  dbPath: string;
  encryptionSecret: string;
}

// ─── API DTOs ───────────────────────────────────────────────────────

export interface ApiResponse<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface DashboardState {
  accounts: AppleAccount[];
  devices: DeviceInfo[];
  ipas: IpaArtifact[];
  jobs: InstallJob[];
  installedApps: InstalledApp[];
  scheduler: SchedulerSnapshot;
  weeklyAppIdUsage?: Record<string, {
    accountId: string;
    teamId: string;
    used: number;
    limit: number;
    windowDays: number;
  }>;
}

export interface InstallRequest {
  ipaId: string;
  deviceUdid: string;
  accountId: string;
}

// ─── Sources ─────────────────────────────────────────────────────────

export type SourceAppCategory =
  | 'developer'
  | 'entertainment'
  | 'games'
  | 'lifestyle'
  | 'photo-video'
  | 'social'
  | 'utilities'
  | 'other';

export interface SourceScreenshot {
  imageURL: string;
  width?: number;
  height?: number;
}

export interface SourceScreenshots {
  iphone?: SourceScreenshot[];
  ipad?: SourceScreenshot[];
}

export interface SourceAppVersion {
  version: string;
  buildVersion?: string;
  marketingVersion?: string;
  date?: string;
  localizedDescription?: string;
  downloadURL: string;
  size?: number;
  minOSVersion?: string;
  maxOSVersion?: string;
  assetURLs?: Record<string, string>;
}

export interface SourceAppPermissions {
  entitlements?: string[];
  privacy?: Record<string, string>;
}

export interface SourceAppPatreon {
  pledge?: number;
  currency?: string;
  benefit?: string;
  tiers?: string[];
}

export interface SourceApp {
  name: string;
  bundleIdentifier: string;
  developerName?: string;
  subtitle?: string;
  localizedDescription?: string;
  iconURL?: string;
  tintColor?: string;
  category?: SourceAppCategory;
  screenshots?: SourceScreenshots;
  versions?: SourceAppVersion[];
  appPermissions?: SourceAppPermissions;
  patreon?: SourceAppPatreon;
  // Legacy/simplified compatibility fields.
  version?: string;
  versionDate?: string;
  versionDescription?: string;
  downloadURL?: string;
  size?: number;
}

export interface SourceNews {
  identifier?: string;
  title: string;
  caption?: string;
  date?: string;
  tintColor?: string;
  imageURL?: string;
  notify?: boolean;
  url?: string;
  appID?: string;
}

export interface SourceManifest {
  name: string;
  identifier?: string;
  subtitle?: string;
  description?: string;
  iconURL?: string;
  headerURL?: string;
  website?: string;
  tintColor?: string;
  sourceURL?: string;
  patreonURL?: string;
  featuredApps?: string[];
  news?: SourceNews[];
  apps: SourceApp[];
}

export interface UserSource {
  id: string;
  name: string;
  url: string;
  identifier: string | null;
  iconURL: string | null;
  enabled: boolean;
  isBuiltIn: boolean;
  appCount: number;
  lastFetchedAt: string | null;
  createdAt: string;
}

export interface UserSourceWithManifest extends UserSource {
  cachedManifest: SourceManifest | null;
}

// ─── SSE Events ─────────────────────────────────────────────────────

export type SSEEventType =
  | 'device-update'
  | 'job-update'
  | 'job-log'
  | 'app-update'
  | 'account-update'
  | 'log'
  | 'scheduler-update';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}
