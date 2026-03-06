// ─── Scheduler Service ───────────────────────────────────────────────
// Automatically refreshes (re-signs + re-installs) apps before they
// expire. For free accounts the 7-day certificate lifespan means apps
// need to be refreshed every ~6 days.
//
// The scheduler runs a periodic check (default: every 30 minutes) and
// enqueues refresh jobs for any installed apps approaching expiration.

import type { Database } from '../state/database';
import type { LogService } from '../services/log-service';
import type { DeviceService } from '../services/device-service';
import { startInstallPipeline } from '../pipeline/pipeline';
import type { PipelineDeps } from '../pipeline/pipeline';
import type { InstalledApp, SchedulerConfig, SchedulerSnapshot, AutoRefreshState } from '../../shared/types';
import { LOG_CODES, FREE_ACCOUNT_LIMITS, DEFAULTS } from '../../shared/constants';
import { NotFoundError } from '../utils/errors';

const DEFAULT_CHECK_INTERVAL_MS = DEFAULTS.schedulerCheckIntervalMs;
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // Refresh if expiring within 24 hours

interface RetryBackoffState {
  attempt: number;
  nextRetryAtMs: number;
}

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private config: SchedulerConfig;
  private refreshInProgress = new Set<string>(); // track by installed_app id
  private retryBackoff = new Map<string, RetryBackoffState>();
  private lastCheckAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private pipelineDeps: PipelineDeps,
    private db: Database,
    private logs: LogService,
    private devices: DeviceService,
  ) {
    this.config = this.loadConfig();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  /**
   * Start the automatic refresh scheduler.
   */
  start(): void {
    if (this.timer) return;
    if (!this.config.enabled) {
      this.logs.info(LOG_CODES.REFRESH_SCHEDULED, 'Scheduler disabled — not starting');
      return;
    }

    this.logs.info(LOG_CODES.REFRESH_SCHEDULED, 'Scheduler started', {
      intervalMs: this.config.checkIntervalMs,
    });

    this.timer = setInterval(() => this.tick(), this.config.checkIntervalMs);
    // Immediate first check
    this.tick();
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logs.info(LOG_CODES.REFRESH_SCHEDULED, 'Scheduler stopped');
    }
  }

  /**
   * Get a snapshot of the scheduler state.
   */
  getSnapshot(): SchedulerSnapshot {
    return {
      enabled: this.config.enabled,
      running: this.timer !== null,
      checkIntervalMs: this.config.checkIntervalMs,
      refreshThresholdMs: this.config.refreshThresholdMs ?? REFRESH_THRESHOLD_MS,
      lastCheckAt: this.lastCheckAt,
      lastError: this.lastError,
      pendingRefreshCount: this.refreshInProgress.size,
    };
  }

  /**
   * Update scheduler configuration.
   */
  updateConfig(updates: Partial<SchedulerConfig>): SchedulerConfig {
    this.config = { ...this.config, ...updates };
    this.saveConfig();

    // Restart if running to pick up new interval
    if (this.timer) {
      this.stop();
      if (this.config.enabled) this.start();
    }

    return this.config;
  }

  /**
   * Get auto-refresh state for each installed app.
   */
  getAutoRefreshStates(): AutoRefreshState[] {
    const installed = this.db.listInstalledApps();
    const now = Date.now();

    return installed.map(app => {
      const expiresMs = new Date(app.expiresAt).getTime();
      const msUntilExpiry = expiresMs - now;
      const isExpired = msUntilExpiry <= 0;
      const needsRefresh = msUntilExpiry <= (this.config.refreshThresholdMs ?? REFRESH_THRESHOLD_MS);

      return {
        installedAppId: app.id,
        bundleId: app.bundleId,
        appName: app.appName,
        deviceUdid: app.deviceUdid,
        expiresAt: app.expiresAt,
        isExpired,
        needsRefresh,
        msUntilExpiry: Math.max(0, msUntilExpiry),
        refreshInProgress: this.refreshInProgress.has(app.id!),
        lastRefreshAt: app.lastRefreshAt ?? null,
        lastError: null,
      };
    });
  }

  /**
   * Manually trigger a refresh for a specific installed app.
   */
  async triggerRefresh(installedAppId: string): Promise<void> {
    const app = this.db.getInstalledApp(installedAppId);
    if (!app) throw new NotFoundError('Installed app', installedAppId);
    await this.refreshApp(app);
  }

  // ─── Tick Logic ─────────────────────────────────────────────────

  private async tick(): Promise<void> {
    try {
      this.lastCheckAt = new Date().toISOString();
      this.lastError = null;
      const nowMs = Date.now();

      const states = this.getAutoRefreshStates();
      const needRefresh = states.filter(s => s.needsRefresh && !s.refreshInProgress);

      if (needRefresh.length === 0) return;

      this.logs.info(LOG_CODES.REFRESH_SCHEDULED, `${needRefresh.length} app(s) need refresh`, {
        apps: needRefresh.map(s => s.bundleId),
      });

      // Only refresh apps whose device is currently connected
      const connectedDevices = new Set(this.devices.list().map(d => d.udid));

      for (const state of needRefresh) {
        if (!connectedDevices.has(state.deviceUdid)) {
          const backoff = this.retryBackoff.get(state.installedAppId);
          if (backoff && nowMs < backoff.nextRetryAtMs) {
            this.logs.debug(
              LOG_CODES.REFRESH_SCHEDULED,
              `Skipping ${state.appName} — waiting for retry backoff window`,
              {
                bundleId: state.bundleId,
                deviceUdid: state.deviceUdid,
                retryAt: new Date(backoff.nextRetryAtMs).toISOString(),
                attempt: backoff.attempt,
              },
            );
            continue;
          }

          const nextAttempt = (backoff?.attempt ?? 0) + 1;
          const retryDelayMinutes = Math.min(
            DEFAULTS.schedulerInitialBackoffMinutes * 2 ** (nextAttempt - 1),
            DEFAULTS.schedulerMaxBackoffMinutes,
          );
          const nextRetryAtMs = nowMs + retryDelayMinutes * 60_000;
          this.retryBackoff.set(state.installedAppId, { attempt: nextAttempt, nextRetryAtMs });

          this.logs.debug(LOG_CODES.REFRESH_SCHEDULED, 
            `Skipping ${state.appName} — device not connected`, {
            bundleId: state.bundleId,
            deviceUdid: state.deviceUdid,
            retryDelayMinutes,
            retryAt: new Date(nextRetryAtMs).toISOString(),
            attempt: nextAttempt,
          });
          continue;
        }

        this.retryBackoff.delete(state.installedAppId);

        const app = this.db.getInstalledApp(state.installedAppId);
        if (app) {
          this.refreshApp(app).catch(err => {
            this.logs.error(LOG_CODES.REFRESH_FAILED, 
              `Auto-refresh failed: ${app.appName}`, {
              installedAppId: app.id, error: String(err),
            });
          });
        }
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logs.error(LOG_CODES.REFRESH_SCHEDULED, `Scheduler tick error: ${this.lastError}`);
    }
  }

  // ─── Refresh Logic ─────────────────────────────────────────────

  private async refreshApp(app: InstalledApp): Promise<void> {
    if (this.refreshInProgress.has(app.id!)) return;

    this.refreshInProgress.add(app.id!);
    this.logs.info(LOG_CODES.REFRESH_SCHEDULED, `Starting refresh: ${app.appName}`, {
      installedAppId: app.id, bundleId: app.bundleId, deviceUdid: app.deviceUdid,
    });

    try {
      // Re-run the install pipeline with the same IPA + account + device
      await startInstallPipeline(this.pipelineDeps, {
        accountId: app.accountId,
        ipaId: app.ipaId,
        deviceUdid: app.deviceUdid,
      });
    } catch (err) {
      // Detect 2FA / auth errors and surface to user via logs
      const msg = err instanceof Error ? err.message : String(err);
      if (/2fa|two.?factor|verification code|session.*expired|auth.*required/i.test(msg)) {
        this.logs.warn(LOG_CODES.REFRESH_FAILED,
          `Refresh blocked — Apple session expired or 2FA required for ${app.appName}. Please re-authenticate via the Apple Account page.`,
          { installedAppId: app.id, bundleId: app.bundleId },
        );
      }
      throw err;
    } finally {
      this.refreshInProgress.delete(app.id!);
    }
  }

  // ─── Config Persistence ─────────────────────────────────────────

  private loadConfig(): SchedulerConfig {
    const row = this.db.getSetting('scheduler_config');
    if (row) {
      try {
        return JSON.parse(row);
      } catch (err) {
        console.warn('[scheduler] Failed to parse stored config, using defaults:', err);
      }
    }
    return {
      enabled: true,
      checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
      refreshThresholdMs: REFRESH_THRESHOLD_MS,
    };
  }

  private saveConfig(): void {
    this.db.setSetting('scheduler_config', JSON.stringify(this.config));
  }
}
