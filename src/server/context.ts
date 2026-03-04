import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { AppConfig } from './types';
import { AppStore } from './state/store';
import { LogService } from './services/log-service';
import { IpaService } from './services/ipa-service';
import { DeviceService } from './services/device-service';
import { SchedulerService } from './services/scheduler-service';
import { PipelineService } from './services/pipeline-service';
import { AuthService } from './services/auth-service';
import { HelperService } from './services/helper-service';
import { readEnv, readNumberEnv } from './utils/env';

export interface AppContext {
  config: AppConfig;
  store: AppStore;
  logs: LogService;
  authService: AuthService;
  ipaService: IpaService;
  deviceService: DeviceService;
  helperService: HelperService;
  schedulerService: SchedulerService;
  pipelineService: PipelineService;
  startedAt: string;
  shutdown: () => void;
}

const parsePositiveNumber = (value: number, fallback: number): number => (Number.isFinite(value) && value > 0 ? value : fallback);

const defaultConfig = (): AppConfig => {
  const helperToken = readEnv('SIDELINK_HELPER_API_TOKEN', 'ALTSTORE_HELPER_API_TOKEN') ?? '';

  return {
    uploadDir: readEnv('SIDELINK_UPLOAD_DIR', 'ALTSTORE_UPLOAD_DIR') || path.resolve(process.cwd(), 'tmp/uploads'),
    dbPath: readEnv('SIDELINK_DB_PATH', 'ALTSTORE_DB_PATH') || path.resolve(process.cwd(), 'tmp/sidelink.sqlite'),
    defaultMode: (readEnv('SIDELINK_MODE', 'ALTSTORE_MODE') === 'real' ? 'real' : 'demo'),
    schedulerTickIntervalMs: parsePositiveNumber(readNumberEnv(['SIDELINK_SCHEDULER_TICK_MS', 'ALTSTORE_SCHEDULER_TICK_MS'], 6000), 6000),
    schedulerHoursPerTick: parsePositiveNumber(readNumberEnv(['SIDELINK_SCHEDULER_HOURS_PER_TICK', 'ALTSTORE_SCHEDULER_HOURS_PER_TICK'], 6), 6),
    authCookieName: readEnv('SIDELINK_AUTH_COOKIE_NAME', 'ALTSTORE_AUTH_COOKIE_NAME') || 'sidelink_session',
    authSessionTtlHours: parsePositiveNumber(readNumberEnv(['SIDELINK_SESSION_TTL_HOURS', 'ALTSTORE_SESSION_TTL_HOURS'], 12), 12),
    helperProjectDir: readEnv('SIDELINK_HELPER_PROJECT_DIR', 'ALTSTORE_HELPER_PROJECT_DIR') || path.resolve(process.cwd(), 'ios-helper/SidelinkHelper'),
    helperIpaPath: readEnv('SIDELINK_HELPER_IPA_PATH', 'ALTSTORE_HELPER_IPA_PATH') || path.resolve(process.cwd(), 'tmp/helper/SidelinkHelper.ipa'),
    helperBundleId: readEnv('SIDELINK_HELPER_BUNDLE_ID', 'ALTSTORE_HELPER_BUNDLE_ID') || 'com.sidelink.helper',
    helperDisplayName: readEnv('SIDELINK_HELPER_DISPLAY_NAME', 'ALTSTORE_HELPER_DISPLAY_NAME') || 'Sidelink Helper',
    helperToken,
    autoRefreshThresholdHours: parsePositiveNumber(
      readNumberEnv(['SIDELINK_AUTO_REFRESH_THRESHOLD_HOURS', 'ALTSTORE_AUTO_REFRESH_THRESHOLD_HOURS'], 48),
      48
    ),
    autoRefreshInitialBackoffMinutes: parsePositiveNumber(
      readNumberEnv(['SIDELINK_AUTO_REFRESH_INITIAL_BACKOFF_MINUTES', 'ALTSTORE_AUTO_REFRESH_INITIAL_BACKOFF_MINUTES'], 15),
      15
    ),
    autoRefreshMaxBackoffMinutes: parsePositiveNumber(
      readNumberEnv(['SIDELINK_AUTO_REFRESH_MAX_BACKOFF_MINUTES', 'ALTSTORE_AUTO_REFRESH_MAX_BACKOFF_MINUTES'], 720),
      720
    ),
    autoRefreshWifiWaitRetries: parsePositiveNumber(
      readNumberEnv(['SIDELINK_AUTO_REFRESH_WIFI_WAIT_RETRIES', 'ALTSTORE_AUTO_REFRESH_WIFI_WAIT_RETRIES'], 2),
      2
    )
  };
};

export const createAppContext = (overrides: Partial<AppConfig> = {}): AppContext => {
  const config = {
    ...defaultConfig(),
    ...overrides
  };

  const startedAt = new Date().toISOString();

  mkdirSync(config.uploadDir, { recursive: true });
  mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const store = new AppStore(config.defaultMode, { dbPath: config.dbPath });
  const logs = new LogService(store);
  const authService = new AuthService(store, logs, {
    cookieName: config.authCookieName,
    sessionTtlHours: config.authSessionTtlHours
  });
  const ipaService = new IpaService(store, logs);
  const deviceService = new DeviceService(store, logs);
  const helperService = new HelperService(store, logs, {
    helperToken: config.helperToken,
    helperProjectDir: config.helperProjectDir,
    helperIpaPath: config.helperIpaPath,
    helperBundleId: config.helperBundleId,
    helperDisplayName: config.helperDisplayName
  });
  const schedulerService = new SchedulerService(
    store,
    logs,
    deviceService,
    config.schedulerTickIntervalMs,
    config.schedulerHoursPerTick,
    {
      autoRefreshThresholdHours: config.autoRefreshThresholdHours,
      initialBackoffMinutes: config.autoRefreshInitialBackoffMinutes,
      maxBackoffMinutes: config.autoRefreshMaxBackoffMinutes,
      wifiWaitRetries: config.autoRefreshWifiWaitRetries
    }
  );
  const pipelineService = new PipelineService(store, ipaService, deviceService, schedulerService, logs, helperService);

  authService.bootstrapAdminFromEnv();
  schedulerService.start();

  logs.push({
    level: 'info',
    code: 'APP_BOOTED',
    message: 'Sidelink server booted.',
    action: 'Sign in, upload an IPA, and run the install pipeline. Helper auto-ensure and auto-refresh planner are active.'
  });

  return {
    config,
    store,
    logs,
    authService,
    ipaService,
    deviceService,
    helperService,
    schedulerService,
    pipelineService,
    startedAt,
    shutdown: () => {
      schedulerService.stop();
      store.close();
    }
  };
};
