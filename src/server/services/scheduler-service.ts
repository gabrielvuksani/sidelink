import { AppStore } from '../state/store';
import { DeviceService } from './device-service';
import { LogService } from './log-service';
import { DeviceListResult, DeviceStatus, InstalledAppRecord, RuntimeMode, SchedulerSnapshot } from '../types';
import { addDays, addHours, addMinutes, hoursBetween, isPastOrEqual, subtractHours } from '../utils/time';
import { AppError } from '../utils/errors';

const EXPIRE_SOON_HOURS = 24;

interface RegisterInstallInput {
  jobId: string;
  ipaId: string;
  deviceId: string;
  mode: RuntimeMode;
  kind: InstalledAppRecord['kind'];
  label: string;
  bundleId: string;
  preferredTransport?: InstalledAppRecord['preferredTransport'];
}

interface SchedulerPolicyOptions {
  autoRefreshThresholdHours: number;
  initialBackoffMinutes: number;
  maxBackoffMinutes: number;
  wifiWaitRetries: number;
}

export class SchedulerService {
  private timer?: NodeJS.Timeout;
  private running = true;
  private simulatedNow = new Date().toISOString();
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: AppStore,
    private readonly logs: LogService,
    private readonly devices: DeviceService,
    private readonly tickIntervalMs: number,
    private readonly simulatedHoursPerTick: number,
    private readonly policy: SchedulerPolicyOptions
  ) {
    const restored = this.store.getSchedulerState({
      running: true,
      simulatedNow: new Date().toISOString(),
      tickIntervalMs: this.tickIntervalMs,
      simulatedHoursPerTick: this.simulatedHoursPerTick,
      autoRefreshThresholdHours: this.policy.autoRefreshThresholdHours,
      wifiPreferred: true
    });

    this.running = restored.running;
    this.simulatedNow = restored.simulatedNow;
    this.persistSnapshot();
  }

  public start(): void {
    this.stop();
    this.timer = setInterval(() => {
      if (!this.running) {
        return;
      }

      void this.advanceHours(this.simulatedHoursPerTick, 'tick');
    }, this.tickIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public setRunning(running: boolean): SchedulerSnapshot {
    this.running = running;
    this.persistSnapshot();

    this.logs.push({
      level: 'info',
      code: running ? 'SCHEDULER_STARTED' : 'SCHEDULER_PAUSED',
      message: running ? 'Auto-refresh engine resumed.' : 'Auto-refresh engine paused.'
    });

    return this.snapshot();
  }

  public snapshot(): SchedulerSnapshot {
    return {
      running: this.running,
      simulatedNow: this.simulatedNow,
      tickIntervalMs: this.tickIntervalMs,
      simulatedHoursPerTick: this.simulatedHoursPerTick,
      autoRefreshThresholdHours: this.policy.autoRefreshThresholdHours,
      wifiPreferred: true
    };
  }

  public registerInstall(input: RegisterInstallInput): InstalledAppRecord {
    const existing = this.findInstall(input.deviceId, input.bundleId, input.kind);
    const installedAt = this.simulatedNow;
    const expiresAt = addDays(installedAt, 7);

    const autoRefresh = {
      policy: 'wifi-preferred' as const,
      thresholdHours: this.policy.autoRefreshThresholdHours,
      nextAttemptAt: subtractHours(expiresAt, this.policy.autoRefreshThresholdHours),
      retryCount: 0,
      backoffMinutes: 0,
      nextAttemptReason: `Waiting for ${this.policy.autoRefreshThresholdHours}h pre-expiry auto-refresh window.`,
      lastDecisionCode: 'AUTO_REFRESH_WINDOW_PENDING',
      wifiWaitRemainingRetries: this.policy.wifiWaitRetries
    };

    const record: InstalledAppRecord = {
      id: existing?.id ?? this.store.newId('install'),
      jobId: input.jobId,
      ipaId: input.ipaId,
      deviceId: input.deviceId,
      mode: input.mode,
      kind: input.kind,
      label: input.label,
      bundleId: input.bundleId,
      preferredTransport: input.preferredTransport ?? 'wifi',
      installedAt,
      expiresAt,
      lastRefreshAt: existing?.lastRefreshAt,
      refreshCount: existing?.refreshCount ?? 0,
      health: 'healthy',
      autoRefresh
    };

    this.store.saveInstall(record);
    this.logs.push({
      level: 'info',
      code: input.kind === 'helper' ? 'HELPER_INSTALL_REGISTERED' : 'INSTALL_REGISTERED',
      message: `${input.kind === 'helper' ? 'Helper' : 'App'} install ${record.id} registered with 7-day lifecycle.`,
      action: `Auto-refresh window opens ${this.policy.autoRefreshThresholdHours}h before expiry.`
    });

    return record;
  }

  public listInstalled(): InstalledAppRecord[] {
    return Array.from(this.store.installedApps.values()).sort(
      (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
    );
  }

  public async refreshInstall(installId: string, reason: 'manual' | 'auto' | 'helper' = 'manual'): Promise<InstalledAppRecord> {
    return this.runExclusive(async () => {
      const install = this.store.installedApps.get(installId);
      if (!install) {
        throw new AppError('INSTALL_NOT_FOUND', 'Install record not found.', 404, 'Refresh dashboard data and try again.');
      }

      const discovery = await this.devices.list(install.mode, true);
      if (install.mode === 'real' && discovery.source !== 'real') {
        throw new AppError(
          'REAL_DEVICE_SOURCE_REQUIRED',
          'Real mode refresh requires real device discovery source; mock fallback is blocked.',
          400,
          'Install/repair libimobiledevice, reconnect + trust your iPhone, then rescan devices in real mode.'
        );
      }

      const device = discovery.devices.find((entry) => entry.id === install.deviceId);
      if (!device) {
        throw new AppError(
          'DEVICE_NOT_AVAILABLE',
          'Device no longer available for refresh.',
          400,
          'Reconnect device and refresh device list before retrying.'
        );
      }

      if (device.connection !== 'online') {
        throw new AppError(
          'DEVICE_NOT_ONLINE',
          `Device ${device.name} is ${device.connection}.`,
          400,
          'Unlock and trust the device, then run refresh again.'
        );
      }

      this.applySuccessfulRefresh(install, reason, device.transport);

      this.logs.push({
        level: 'info',
        code: reason === 'manual' ? 'MANUAL_REFRESH_SUCCESS' : reason === 'helper' ? 'HELPER_REFRESH_SUCCESS' : 'AUTO_REFRESH_SUCCESS',
        message: `Refresh succeeded for ${install.id} (${reason}).`,
        action: `Next auto-refresh attempt scheduled for ${install.autoRefresh.nextAttemptAt}.`
      });

      return install;
    });
  }

  public async advanceHours(hours: number, trigger: 'tick' | 'manual' = 'manual'): Promise<SchedulerSnapshot> {
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new AppError('SCHEDULER_ADVANCE_INVALID', 'Scheduler advance requires a positive number of hours.', 400);
    }

    return this.runExclusive(async () => {
      this.simulatedNow = addHours(this.simulatedNow, hours);

      try {
        await this.evaluateInstallHealth(trigger);
      } catch (error) {
        this.logs.push({
          level: 'error',
          code: 'SCHEDULER_EVALUATION_FAILED',
          message: error instanceof Error ? error.message : String(error),
          action: 'Inspect logs, then rerun scheduler advance.'
        });
      }

      this.persistSnapshot();
      return this.snapshot();
    });
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async evaluateInstallHealth(trigger: 'tick' | 'manual'): Promise<void> {
    const installs = this.listInstalled();
    const discoveryCache = new Map<RuntimeMode, DeviceListResult>();

    const getDiscovery = async (mode: RuntimeMode) => {
      if (!discoveryCache.has(mode)) {
        const discovery = await this.devices.list(mode, true);
        discoveryCache.set(mode, discovery);
      }

      return discoveryCache.get(mode)!;
    };

    for (const install of installs) {
      const remainingHours = hoursBetween(this.simulatedNow, install.expiresAt);

      if (remainingHours <= 0) {
        if (install.health !== 'expired') {
          install.health = 'expired';
          this.store.saveInstall(install);
          this.logs.push({
            level: 'error',
            code: 'INSTALL_EXPIRED',
            message: `${install.label} (${install.id}) expired.`,
            action: 'Reconnect device and trigger refresh to restore the app.'
          });
        }
        continue;
      }

      if (remainingHours <= EXPIRE_SOON_HOURS) {
        if (install.health !== 'expiring') {
          install.health = 'expiring';
          this.store.saveInstall(install);
          this.logs.push({
            level: 'warn',
            code: 'INSTALL_EXPIRING_SOON',
            message: `${install.label} expires in ${Math.floor(remainingHours)}h.`,
            action: 'Auto-refresh is active; manual refresh is available as fallback.'
          });
        }
      } else if (install.health !== 'healthy') {
        install.health = 'healthy';
        this.store.saveInstall(install);
      }

      const auto = install.autoRefresh;
      const thresholdBoundary = subtractHours(install.expiresAt, this.policy.autoRefreshThresholdHours);

      if (remainingHours > this.policy.autoRefreshThresholdHours) {
        if (
          auto.nextAttemptAt !== thresholdBoundary ||
          auto.retryCount !== 0 ||
          auto.backoffMinutes !== 0 ||
          !auto.nextAttemptReason ||
          !auto.lastDecisionCode ||
          auto.wifiWaitRemainingRetries !== this.policy.wifiWaitRetries
        ) {
          install.autoRefresh = {
            ...auto,
            nextAttemptAt: thresholdBoundary,
            retryCount: 0,
            backoffMinutes: 0,
            nextAttemptReason: `Waiting for ${this.policy.autoRefreshThresholdHours}h pre-expiry auto-refresh window.`,
            lastDecisionCode: 'AUTO_REFRESH_WINDOW_PENDING',
            wifiWaitRemainingRetries: this.policy.wifiWaitRetries,
            lastFailureReason: undefined,
            lastFailureAt: undefined
          };
          this.store.saveInstall(install);
        }
        continue;
      }

      if (!isPastOrEqual(this.simulatedNow, auto.nextAttemptAt)) {
        continue;
      }

      const discovery = await getDiscovery(install.mode);
      const device = discovery.devices.find((entry) => entry.id === install.deviceId);
      await this.attemptAutoRefresh(install, device, discovery.source);
    }

    if (installs.length && trigger === 'manual') {
      this.logs.push({
        level: 'debug',
        code: 'SCHEDULER_ADVANCED',
        message: `Scheduler advanced to ${this.simulatedNow}.`
      });
    }
  }

  private async attemptAutoRefresh(
    install: InstalledAppRecord,
    device: DeviceStatus | undefined,
    discoverySource: DeviceListResult['source']
  ): Promise<void> {
    const now = this.simulatedNow;
    install.autoRefresh.lastAttemptAt = now;
    install.autoRefresh.lastAttemptTransport = device?.transport ?? 'unknown';
    install.autoRefresh.lastDecisionCode = 'AUTO_REFRESH_ATTEMPT';
    install.autoRefresh.nextAttemptReason = 'Attempting auto-refresh now.';
    this.store.saveInstall(install);

    this.logs.push({
      level: 'debug',
      code: 'AUTO_REFRESH_ATTEMPT',
      message: `Auto-refresh attempt started for ${install.label}.`,
      context: this.autoLogContext(install, {
        transport: install.autoRefresh.lastAttemptTransport,
        preferredTransport: install.preferredTransport,
        discoverySource
      })
    });

    if (install.mode === 'real' && discoverySource !== 'real') {
      this.markAutoFailure(
        install,
        'Real mode auto-refresh requires real device discovery source; mock fallback is blocked.',
        'AUTO_REFRESH_REAL_SOURCE_REQUIRED'
      );
      return;
    }

    if (!device) {
      this.markAutoFailure(install, 'Device not found in latest discovery snapshot.', 'AUTO_REFRESH_DEVICE_MISSING');
      return;
    }

    if (device.connection !== 'online') {
      this.markAutoFailure(install, `Device ${device.name} is ${device.connection}.`, 'AUTO_REFRESH_DEVICE_OFFLINE');
      return;
    }

    if (install.preferredTransport === 'wifi' && device.transport !== 'wifi') {
      const wifiWaitRemainingRetries = this.resolveWifiWaitRemainingRetries(install);

      if (wifiWaitRemainingRetries > 0) {
        this.markAutoFailure(
          install,
          `Waiting for Wi‑Fi transport (currently ${device.transport.toUpperCase() || 'UNKNOWN'}).`,
          'AUTO_REFRESH_WIFI_WAIT'
        );
        return;
      }

      install.autoRefresh.lastDecisionCode = 'AUTO_REFRESH_WIFI_FALLBACK';
      install.autoRefresh.nextAttemptReason = `Wi‑Fi wait retries exhausted; using ${device.transport.toUpperCase()} fallback.`;
      install.autoRefresh.wifiWaitRemainingRetries = 0;
      this.store.saveInstall(install);

      this.logs.push({
        level: 'info',
        code: 'AUTO_REFRESH_WIFI_FALLBACK',
        message: `Wi‑Fi unavailable for ${install.label}; falling back to ${device.transport} refresh path.`,
        action: 'Fallback path opened after Wi‑Fi wait retries were exhausted.',
        context: this.autoLogContext(install, {
          transport: device.transport,
          wifiWaitRetries: this.policy.wifiWaitRetries
        })
      });
    }

    try {
      this.applySuccessfulRefresh(install, 'auto', device.transport);

      this.logs.push({
        level: 'info',
        code: 'AUTO_REFRESH_SUCCESS',
        message: `Auto-refresh succeeded for ${install.label}.`,
        action: `Next attempt: ${install.autoRefresh.nextAttemptAt}.`,
        context: this.autoLogContext(install, {
          transport: device.transport,
          refreshedAt: this.simulatedNow
        })
      });
    } catch (error) {
      this.markAutoFailure(
        install,
        error instanceof Error ? error.message : String(error),
        'AUTO_REFRESH_EXECUTION_FAILED'
      );
    }
  }

  private applySuccessfulRefresh(
    install: InstalledAppRecord,
    reason: 'manual' | 'auto' | 'helper',
    transport: InstalledAppRecord['autoRefresh']['lastAttemptTransport']
  ): void {
    install.health = 'refreshing';
    this.store.saveInstall(install);

    install.lastRefreshAt = this.simulatedNow;
    install.refreshCount += 1;
    install.expiresAt = addDays(this.simulatedNow, 7);
    install.health = 'healthy';
    install.autoRefresh = {
      ...install.autoRefresh,
      nextAttemptAt: subtractHours(install.expiresAt, this.policy.autoRefreshThresholdHours),
      retryCount: 0,
      backoffMinutes: 0,
      nextAttemptReason: `Waiting for ${this.policy.autoRefreshThresholdHours}h pre-expiry auto-refresh window.`,
      lastDecisionCode: reason === 'auto' ? 'AUTO_REFRESH_SUCCESS' : reason === 'helper' ? 'HELPER_REFRESH_SUCCESS' : 'MANUAL_REFRESH_SUCCESS',
      wifiWaitRemainingRetries: this.policy.wifiWaitRetries,
      lastSuccessAt: this.simulatedNow,
      lastFailureAt: undefined,
      lastFailureReason: undefined,
      lastAttemptAt: this.simulatedNow,
      lastAttemptTransport: transport
    };

    this.store.saveInstall(install);

    if (reason === 'helper') {
      this.logs.push({
        level: 'info',
        code: 'HELPER_REFRESH_TRIGGERED',
        message: `Helper-triggered refresh completed for ${install.label}.`,
        context: this.autoLogContext(install, {
          transport,
          refreshedAt: this.simulatedNow
        })
      });
    }
  }

  private markAutoFailure(install: InstalledAppRecord, reason: string, code = 'AUTO_REFRESH_RETRY_SCHEDULED'): void {
    const now = this.simulatedNow;
    const nextRetryCount = install.autoRefresh.retryCount + 1;
    const backoffMinutes = Math.min(
      this.policy.initialBackoffMinutes * 2 ** (nextRetryCount - 1),
      this.policy.maxBackoffMinutes
    );

    const currentWifiWaitRemainingRetries = this.resolveWifiWaitRemainingRetries(install);
    const wifiWaitRemainingRetries = code === 'AUTO_REFRESH_WIFI_WAIT'
      ? Math.max(currentWifiWaitRemainingRetries - 1, 0)
      : currentWifiWaitRemainingRetries;

    install.autoRefresh = {
      ...install.autoRefresh,
      retryCount: nextRetryCount,
      backoffMinutes,
      nextAttemptReason: reason,
      lastDecisionCode: code,
      wifiWaitRemainingRetries,
      lastFailureAt: now,
      lastFailureReason: reason,
      nextAttemptAt: addMinutes(now, backoffMinutes)
    };

    this.store.saveInstall(install);

    const retryAction = code === 'AUTO_REFRESH_WIFI_WAIT'
      ? `Wi‑Fi preferred retry #${nextRetryCount} scheduled at ${install.autoRefresh.nextAttemptAt} (remaining Wi‑Fi wait retries: ${wifiWaitRemainingRetries}).`
      : `Retry #${nextRetryCount} scheduled at ${install.autoRefresh.nextAttemptAt} (backoff ${backoffMinutes}m).`;

    this.logs.push({
      level: 'warn',
      code,
      message: `Auto-refresh deferred for ${install.label}: ${reason}`,
      action: retryAction,
      context: this.autoLogContext(install, {
        retryCount: nextRetryCount,
        backoffMinutes,
        reason,
        wifiWaitRemainingRetries
      })
    });
  }

  private resolveWifiWaitRemainingRetries(install: InstalledAppRecord): number {
    const raw = install.autoRefresh.wifiWaitRemainingRetries;

    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return this.policy.wifiWaitRetries;
    }

    return Math.max(0, Math.floor(raw));
  }

  private autoLogContext(install: InstalledAppRecord, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      installId: install.id,
      deviceId: install.deviceId,
      bundleId: install.bundleId,
      kind: install.kind,
      retryCount: install.autoRefresh.retryCount,
      nextAttemptAt: install.autoRefresh.nextAttemptAt,
      nextAttemptReason: install.autoRefresh.nextAttemptReason,
      lastDecisionCode: install.autoRefresh.lastDecisionCode,
      wifiWaitRemainingRetries: install.autoRefresh.wifiWaitRemainingRetries,
      ...extra
    };
  }

  private findInstall(deviceId: string, bundleId: string, kind: InstalledAppRecord['kind']): InstalledAppRecord | undefined {
    return Array.from(this.store.installedApps.values()).find(
      (install) => install.deviceId === deviceId && install.bundleId === bundleId && install.kind === kind
    );
  }

  private persistSnapshot(): void {
    this.store.saveSchedulerState(this.snapshot());
  }
}
