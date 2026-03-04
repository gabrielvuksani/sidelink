import { describe, expect, test } from 'vitest';
import { DeviceAdapter } from '../src/server/adapters/device-adapter';
import { MockDeviceAdapter } from '../src/server/adapters/mock-device-adapter';
import { AppStore } from '../src/server/state/store';
import { DeviceService } from '../src/server/services/device-service';
import { LogService } from '../src/server/services/log-service';
import { SchedulerService } from '../src/server/services/scheduler-service';

class UnavailableRealAdapter implements DeviceAdapter {
  public readonly name = 'unavailable-real';

  public async isAvailable(): Promise<boolean> {
    return false;
  }

  public async listDevices() {
    return {
      source: 'real' as const,
      devices: []
    };
  }
}

describe('SchedulerService real-source guardrails', () => {
  test('blocks real-mode auto-refresh when discovery falls back to mock devices', async () => {
    const store = new AppStore('demo');
    const logs = new LogService(store);
    const devices = new DeviceService(store, logs, new UnavailableRealAdapter(), new MockDeviceAdapter());
    const scheduler = new SchedulerService(store, logs, devices, 99999, 6, {
      autoRefreshThresholdHours: 48,
      initialBackoffMinutes: 15,
      maxBackoffMinutes: 720,
      wifiWaitRetries: 2
    });

    scheduler.registerInstall({
      jobId: 'job_real_guard',
      ipaId: 'ipa_real_guard',
      deviceId: 'mock-iphone-15-pro',
      mode: 'real',
      kind: 'primary',
      label: 'Real Guard App',
      bundleId: 'com.demo.realguard',
      preferredTransport: 'wifi'
    });

    await scheduler.advanceHours(121, 'manual');

    const [install] = scheduler.listInstalled();
    expect(install).toBeDefined();
    if (!install) {
      throw new Error('Expected real-mode install to exist');
    }

    expect(install.refreshCount).toBe(0);
    expect(install.autoRefresh.retryCount).toBe(1);
    expect(install.autoRefresh.lastDecisionCode).toBe('AUTO_REFRESH_REAL_SOURCE_REQUIRED');
    expect(install.autoRefresh.lastFailureReason).toContain('requires real device discovery source');

    const guardLog = logs.list().find((entry) => entry.code === 'AUTO_REFRESH_REAL_SOURCE_REQUIRED');
    expect(guardLog).toBeDefined();

    scheduler.stop();
    store.close();
  });

  test('blocks manual refresh when real-mode discovery source is not real', async () => {
    const store = new AppStore('demo');
    const logs = new LogService(store);
    const devices = new DeviceService(store, logs, new UnavailableRealAdapter(), new MockDeviceAdapter());
    const scheduler = new SchedulerService(store, logs, devices, 99999, 6, {
      autoRefreshThresholdHours: 48,
      initialBackoffMinutes: 15,
      maxBackoffMinutes: 720,
      wifiWaitRetries: 2
    });

    const install = scheduler.registerInstall({
      jobId: 'job_manual_guard',
      ipaId: 'ipa_manual_guard',
      deviceId: 'mock-iphone-15-pro',
      mode: 'real',
      kind: 'primary',
      label: 'Manual Guard App',
      bundleId: 'com.demo.manualguard',
      preferredTransport: 'wifi'
    });

    await expect(scheduler.refreshInstall(install.id, 'manual')).rejects.toThrow(
      'Real mode refresh requires real device discovery source; mock fallback is blocked.'
    );

    scheduler.stop();
    store.close();
  });
});
