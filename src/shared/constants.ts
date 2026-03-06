// ─── Shared Constants ───────────────────────────────────────────────

/** Free Apple account limitations */
export const FREE_ACCOUNT_LIMITS = {
  maxAppIds: 10,
  maxNewAppIdsPerWeek: 10,
  maxActiveAppIds: 3,
  maxAppsPerDevice: 3,
  certExpiryDays: 7,
  profileExpiryDays: 7,
} as const;

/** Paid account (Apple Developer Program) */
export const PAID_ACCOUNT_LIMITS = {
  maxAppIds: Infinity,
  maxNewAppIdsPerWeek: Infinity,
  maxActiveAppIds: Infinity,
  maxAppsPerDevice: Infinity,
  certExpiryDays: 365,
  profileExpiryDays: 365,
} as const;

/** Apple API endpoints */
export const APPLE_ENDPOINTS = {
  authInit: 'https://idmsa.apple.com/appleauth/auth/signin/init',
  authComplete: 'https://idmsa.apple.com/appleauth/auth/signin/complete',
  authToken: 'https://idmsa.apple.com/appleauth/auth',
  verify2FA: 'https://idmsa.apple.com/appleauth/auth/verify/trusteddevice/securitycode',
  verifySMS: 'https://idmsa.apple.com/appleauth/auth/verify/phone/securitycode',
  requestSMS: 'https://idmsa.apple.com/appleauth/auth/verify/phone',
  trust: 'https://idmsa.apple.com/appleauth/auth/2sv/trust',
  /** Developer services base for free accounts */
  developerServices: 'https://developerservices2.apple.com/services/QH65B2',
  /** App Store Connect API (paid accounts) */
  appStoreConnect: 'https://appstoreconnect.apple.com',
} as const;

/** Developer services API paths (appended to developerServices base) */
export const DEVELOPER_PATHS = {
  listTeams: '/listTeams.action',
  listDevices: '/ios/listDevices.action',
  addDevice: '/ios/addDevice.action',
  listAppIds: '/ios/listAppIds.action',
  addAppId: '/ios/addAppId.action',
  deleteAppId: '/ios/deleteAppId.action',
  listCertificates: '/ios/listAllDevelopmentCerts.action',
  submitCSR: '/ios/submitDevelopmentCSR.action',
  revokeCertificate: '/ios/revokeDevelopmentCert.action',
  listProvisioningProfiles: '/ios/listProvisioningProfiles.action',
  downloadProfile: '/ios/downloadTeamProvisioningProfile.action',
  deleteProfile: '/ios/deleteProvisioningProfile.action',
} as const;

/** Default Apple auth headers */
export const APPLE_AUTH_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-Apple-App-Info': 'com.apple.gs.xcode.auth',
  'User-Agent': 'Xcode',
  'X-Xcode-Version': '15.2 (15C500b)',
} as const;

/** Pipeline step definitions */
export const PIPELINE_STEPS = [
  { key: 'validate', label: 'Validate IPA & Device' },
  { key: 'authenticate', label: 'Verify Apple Session' },
  { key: 'provision', label: 'Provision Signing Assets' },
  { key: 'sign', label: 'Sign IPA' },
  { key: 'install', label: 'Install to Device' },
  { key: 'register', label: 'Register Lifecycle' },
] as const;

/** Default app configuration values */
export const DEFAULTS = {
  port: 4010,
  host: '0.0.0.0',
  uploadDir: 'tmp/uploads',
  dbPath: 'tmp/sidelink.sqlite',
  helperProjectDir: 'ios-helper/SidelinkHelper',
  helperBundleId: 'com.sidelink.helper',
  schedulerCheckIntervalMs: 30 * 60 * 1000,  // 30 minutes
  schedulerRefreshThresholdHours: 48,
  schedulerInitialBackoffMinutes: 15,
  schedulerMaxBackoffMinutes: 720,
  schedulerWifiWaitRetries: 2,
  authSessionTtlHours: 12,
  logRetentionCount: 5000,
  commandTimeoutMs: 120_000,
  signingTimeoutMs: 180_000,
  bootstrapTimeoutMs: 300_000,
} as const;

/** Client UI limits and intervals */
export const UI_LIMITS = {
  maxJobLogEntries: 250,
  maxVisibleLogs: 500,
  maxIpaFileSizeBytes: 4 * 1024 * 1024 * 1024,
  toastTimeoutMs: 4_000,
  sseMaxBackoffMs: 30_000,
  pairingCodeRefreshMs: 50_000,
} as const;

/** Browser storage keys used by the client UI */
export const STORAGE_KEYS = {
  lastInstallAccountId: 'sidelink:last-install-account-id',
  lastInstallDeviceUdid: 'sidelink:last-install-device-udid',
  wizardStep: 'sidelink_wizard_step',
} as const;

/** Log codes used throughout the system */
export const LOG_CODES = {
  // System
  APP_BOOTED: 'APP_BOOTED',
  APP_SHUTDOWN: 'APP_SHUTDOWN',

  // Apple auth
  APPLE_AUTH_STARTED: 'APPLE_AUTH_STARTED',
  APPLE_AUTH_2FA_REQUIRED: 'APPLE_AUTH_2FA_REQUIRED',
  APPLE_AUTH_2FA_SUBMITTED: 'APPLE_AUTH_2FA_SUBMITTED',
  APPLE_AUTH_SUCCESS: 'APPLE_AUTH_SUCCESS',
  APPLE_AUTH_FAILED: 'APPLE_AUTH_FAILED',
  APPLE_SESSION_REFRESHED: 'APPLE_SESSION_REFRESHED',
  APPLE_SESSION_EXPIRED: 'APPLE_SESSION_EXPIRED',

  // Provisioning
  CERT_CREATED: 'CERT_CREATED',
  CERT_REVOKED: 'CERT_REVOKED',
  CERT_EXPIRING: 'CERT_EXPIRING',
  APP_ID_CREATED: 'APP_ID_CREATED',
  APP_ID_LIMIT_REACHED: 'APP_ID_LIMIT_REACHED',
  PROFILE_CREATED: 'PROFILE_CREATED',
  PROFILE_DOWNLOADED: 'PROFILE_DOWNLOADED',
  DEVICE_REGISTERED: 'DEVICE_REGISTERED',

  // Pipeline
  JOB_CREATED: 'JOB_CREATED',
  JOB_STARTED: 'JOB_STARTED',
  JOB_STEP_STARTED: 'JOB_STEP_STARTED',
  JOB_STEP_COMPLETED: 'JOB_STEP_COMPLETED',
  JOB_STEP_FAILED: 'JOB_STEP_FAILED',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_FAILED: 'JOB_FAILED',
  JOB_RECOVERED: 'JOB_RECOVERED',
  JOB_WAITING_2FA: 'JOB_WAITING_2FA',

  // Devices
  DEVICE_CONNECTED: 'DEVICE_CONNECTED',
  DEVICE_DISCONNECTED: 'DEVICE_DISCONNECTED',
  DEVICE_PAIRED: 'DEVICE_PAIRED',

  // Installation
  APP_INSTALLED: 'APP_INSTALLED',
  APP_INSTALL_FAILED: 'APP_INSTALL_FAILED',
  APP_SIGNED: 'APP_SIGNED',
  APP_SIGN_FAILED: 'APP_SIGN_FAILED',

  // Refresh
  REFRESH_STARTED: 'REFRESH_STARTED',
  REFRESH_COMPLETED: 'REFRESH_COMPLETED',
  REFRESH_FAILED: 'REFRESH_FAILED',
  REFRESH_SCHEDULED: 'REFRESH_SCHEDULED',

  // Admin auth
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  ADMIN_LOGIN_FAILED: 'ADMIN_LOGIN_FAILED',
  ADMIN_LOCKOUT: 'ADMIN_LOCKOUT',
  ADMIN_LOGOUT: 'ADMIN_LOGOUT',
} as const;
