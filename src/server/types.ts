export type RuntimeMode = 'demo' | 'real';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  at: string;
  level: LogLevel;
  code: string;
  message: string;
  action?: string;
  context?: Record<string, unknown>;
}

export interface IpaArtifact {
  id: string;
  filename: string;
  originalName: string;
  absolutePath: string;
  uploadedAt: string;
  sizeBytes: number;
  bundleId: string;
  displayName: string;
  version: string;
  minIOSVersion?: string;
  entitlements: Record<string, unknown>;
  capabilities: string[];
  warnings: string[];
}

export type DeviceConnectionState = 'online' | 'offline' | 'untrusted';
export type DeviceTransport = 'usb' | 'wifi' | 'unknown';

export interface DeviceStatus {
  id: string;
  name: string;
  osVersion: string;
  model: string;
  connection: DeviceConnectionState;
  transport: DeviceTransport;
  batteryPercent?: number;
  lastSeenAt: string;
  source: 'real' | 'mock';
  ipAddress?: string;
  networkName?: string;
}

export interface DeviceListResult {
  requestedMode: RuntimeMode;
  source: 'real' | 'mock' | 'mock-fallback';
  devices: DeviceStatus[];
  note?: string;
  capturedAt?: string;
}

export type JobStatus = 'queued' | 'running' | 'success' | 'error';
export type JobStepState = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface InstallJobStep {
  key: string;
  label: string;
  state: JobStepState;
  startedAt?: string;
  endedAt?: string;
  detail?: string;
  action?: string;
}

export interface InstallJob {
  id: string;
  mode: RuntimeMode;
  ipaId: string;
  deviceId: string;
  status: JobStatus;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  action?: string;
  steps: InstallJobStep[];
  commandPreview?: string[];
  realExecutionApproved?: boolean;
  helperEnsured?: boolean;
}

export type CommandRunStatus = 'success' | 'error' | 'skipped';

export interface JobCommandRun {
  id: string;
  jobId: string;
  stepKey: string;
  command: string;
  args: string[];
  cwd?: string;
  startedAt: string;
  endedAt: string;
  exitCode?: number;
  status: CommandRunStatus;
  stdout?: string;
  stderr?: string;
  note?: string;
}

export type InstallHealth = 'healthy' | 'expiring' | 'expired' | 'refreshing';
export type InstallKind = 'primary' | 'helper';

export interface AutoRefreshState {
  policy: 'wifi-preferred';
  thresholdHours: number;
  nextAttemptAt: string;
  retryCount: number;
  backoffMinutes: number;
  nextAttemptReason?: string;
  lastDecisionCode?: string;
  wifiWaitRemainingRetries?: number;
  lastAttemptAt?: string;
  lastAttemptTransport?: DeviceTransport;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
}

export interface InstalledAppRecord {
  id: string;
  jobId: string;
  ipaId: string;
  deviceId: string;
  mode: RuntimeMode;
  kind: InstallKind;
  label: string;
  bundleId: string;
  installedAt: string;
  expiresAt: string;
  lastRefreshAt?: string;
  refreshCount: number;
  health: InstallHealth;
  preferredTransport: 'wifi' | 'any';
  autoRefresh: AutoRefreshState;
}

export interface SchedulerSnapshot {
  running: boolean;
  simulatedNow: string;
  tickIntervalMs: number;
  simulatedHoursPerTick: number;
  autoRefreshThresholdHours: number;
  wifiPreferred: boolean;
}

export type UserRole = 'admin';

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface UserSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface AuthSessionResult {
  token: string;
  expiresAt: string;
  user: AuthenticatedUser;
}

export interface HelperArtifactStatus {
  available: boolean;
  ipaPath: string;
  projectPath: string;
  bundleId: string;
  displayName: string;
  xcodebuildAvailable: boolean;
  xcodegenAvailable: boolean;
  message?: string;
  buildCommand: string;
  exportCommand: string;
  checkedAt: string;
}

export interface HelperDoctorCheck {
  ok: boolean;
  detail: string;
  path?: string;
}

export interface HelperDoctorReport {
  checkedAt: string;
  readyForBuild: boolean;
  readyForExport: boolean;
  artifactReady: boolean;
  checks: {
    xcodebuild: HelperDoctorCheck;
    xcodegen: HelperDoctorCheck;
    helperProjectDir: HelperDoctorCheck;
    xcodeProject: HelperDoctorCheck;
    exportOptionsPlist: HelperDoctorCheck;
    helperIpa: HelperDoctorCheck;
    buildScript: HelperDoctorCheck;
    exportScript: HelperDoctorCheck;
    helperArtifactDir: HelperDoctorCheck;
  };
  recommendedActions: string[];
  commands: {
    generateProject: string;
    build: string;
    export: string;
  };
}

export interface AppConfig {
  uploadDir: string;
  dbPath: string;
  defaultMode: RuntimeMode;
  schedulerTickIntervalMs: number;
  schedulerHoursPerTick: number;
  authCookieName: string;
  authSessionTtlHours: number;
  helperProjectDir: string;
  helperIpaPath: string;
  helperBundleId: string;
  helperDisplayName: string;
  helperToken: string;
  autoRefreshThresholdHours: number;
  autoRefreshInitialBackoffMinutes: number;
  autoRefreshMaxBackoffMinutes: number;
  autoRefreshWifiWaitRetries: number;
}
