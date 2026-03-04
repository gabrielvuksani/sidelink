import { describe, expect, test } from 'vitest';
import { DeviceAdapter } from '../src/server/adapters/device-adapter';
import { MockDeviceAdapter } from '../src/server/adapters/mock-device-adapter';
import { DeviceService } from '../src/server/services/device-service';
import { LogService } from '../src/server/services/log-service';
import { SchedulerService } from '../src/server/services/scheduler-service';
import { AppStore } from '../src/server/state/store';
import { hoursBetween } from '../src/server/utils/time';

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

class SlowMockAdapter implements DeviceAdapter {
  public readonly name = 'slow-mock';
  public inFlight = 0;
  public maxInFlight = 0;

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async listDevices() {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);

    await new Promise((resolve) => setTimeout(resolve, 60));

    this.inFlight -= 1;

    return {
      source: 'mock' as const,
      devices: [
        {
          id: 'slow-device',
          name: 'Slow Mock Device',
          osVersion: '17.0',
          model: 'iPhone15,3',
          connection: 'online' as const,
          transport: 'wifi' as const,
          source: 'mock' as const,
          batteryPercent: 91,
          lastSeenAt: new Date().toISOString(),
          ipAddress: '192.168.1.20',
          networkName: 'Lab WiFi'
        }
      ]
    };
  }
}

class OfflineThenUsbMockAdapter implements DeviceAdapter {
  public readonly name = 'offline-then-usb';
  private calls = 0;

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async listDevices() {
    this.calls += 1;
    const connection: 'offline' | 'online' = this.calls === 1 ? 'offline' : 'online';

    return {
      source: 'mock' as const,
      devices: [
        {
          id: 'mock-flaky-usb',
          name: 'Flaky USB Device',
          osVersion: '17.1',
          model: 'iPhone15,4',
          connection,
          transport: 'usb' as const,
          source: 'mock' as const,
          batteryPercent: 72,
          lastSeenAt: new Date().toISOString(),
          ipAddress: undefined,
          networkName: 'Lab USB'
        }
      ]
    };
  }
}

describe('SchedulerService', () => {
  test('auto-refreshes installs nearing expiry and prefers Wi‑Fi transport', async () => {
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
      jobId: 'job_1',
      ipaId: 'ipa_1',
      deviceId: 'mock-iphone-15-pro',
      mode: 'demo',
      kind: 'primary',
      label: 'Sample App',
      bundleId: 'com.demo.sample',
      preferredTransport: 'wifi'
    });

    await scheduler.advanceHours(121, 'manual');

    const [install] = scheduler.listInstalled();
    expect(install).toBeDefined();
    if (!install) {
      throw new Error('Expected install to exist');
    }

    expect(install.refreshCount).toBeGreaterThanOrEqual(1);
    expect(install.autoRefresh.retryCount).toBe(0);
    expect(install.autoRefresh.lastAttemptTransport).toBe('wifi');
    expect(install.autoRefresh.lastDecisionCode).toBe('AUTO_REFRESH_SUCCESS');
    expect(install.autoRefresh.nextAttemptReason).toContain('pre-expiry auto-refresh window');

    const remainingHours = hoursBetween(scheduler.snapshot().simulatedNow, install.expiresAt);
    expect(remainingHours).toBeGreaterThan(120);
    expect(install.health).toBe('healthy');

    scheduler.stop();
    store.close();
  });

  test('defers for Wi‑Fi with exponential backoff then falls back to USB when retries are exhausted', async () => {
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
      jobId: 'job_usb',
      ipaId: 'ipa_usb',
      deviceId: 'mock-iphone-se-3',
      mode: 'demo',
      kind: 'primary',
      label: 'USB App',
      bundleId: 'com.demo.usb',
      preferredTransport: 'wifi'
    });

    await scheduler.advanceHours(121, 'manual');

    let [install] = scheduler.listInstalled();
    expect(install.refreshCount).toBe(0);
    expect(install.autoRefresh.retryCount).toBe(1);
    expect(install.autoRefresh.backoffMinutes).toBe(15);
    expect(install.autoRefresh.lastDecisionCode).toBe('AUTO_REFRESH_WIFI_WAIT');
    expect(install.autoRefresh.lastFailureReason).toContain('Waiting for Wi‑Fi');
    expect(install.autoRefresh.nextAttemptReason).toContain('Waiting for Wi‑Fi');
    expect(install.autoRefresh.wifiWaitRemainingRetries).toBe(1);

    await scheduler.advanceHours(1, 'manual');

    [install] = scheduler.listInstalled();
    expect(install.refreshCount).toBe(0);
    expect(install.autoRefresh.retryCount).toBe(2);
    expect(install.autoRefresh.backoffMinutes).toBe(30);
    expect(install.autoRefresh.wifiWaitRemainingRetries).toBe(0);

    await scheduler.advanceHours(1, 'manual');

    [install] = scheduler.listInstalled();
    expect(install.refreshCount).toBeGreaterThanOrEqual(1);
    expect(install.autoRefresh.lastAttemptTransport).toBe('usb');
    expect(install.autoRefresh.retryCount).toBe(0);
    expect(install.autoRefresh.lastDecisionCode).toBe('AUTO_REFRESH_SUCCESS');
    expect(install.autoRefresh.wifiWaitRemainingRetries).toBe(2);

    scheduler.stop();
    store.close();
  });

  test('preserves Wi‑Fi wait retries across non-Wi‑Fi failures before falling back', async () => {
    const store = new AppStore('demo');
    const logs = new LogService(store);
    const devices = new DeviceService(store, logs, new UnavailableRealAdapter(), new OfflineThenUsbMockAdapter());
    const scheduler = new SchedulerService(store, logs, devices, 99999, 6, {
      autoRefreshThresholdHours: 48,
      initialBackoffMinutes: 15,
      maxBackoffMinutes: 720,
      wifiWaitRetries: 2
    });

    scheduler.registerInstall({
      jobId: 'job_flaky',
      ipaId: 'ipa_flaky',
      deviceId: 'mock-flaky-usb',
      mode: 'demo',
      kind: 'primary',
      label: 'Flaky App',
      bundleId: 'com.demo.flaky',
      preferredTransport: 'wifi'
    });

    await scheduler.advanceHours(121, 'manual');

    let [install] = scheduler.listInstalled();
    expect(install.refreshCount).toBe(0);
    expect(install.autoRefresh.lastDecisionCode).toBe('AUTO_REFRESH_DEVICE_OFFLINE');
    expect(install.autoRefresh.retryCount).toBe(1);
    expect(install.autoRefresh.wifiWaitRemainingRetries).toBe(2);

    await scheduler.advanceHours(1, 'manual');

    [install] = scheduler.listInstalled();
    expect(install.refreshCount).toBe(0);
    expect(install.autoRefresh.lastDecisionCode).toBe('AUTO_REFRESH_WIFI_WAIT');
    expect(install.autoRefresh.retryCount).toBe(2);
    expect(install.autoRefresh.wifiWaitRemainingRetries).toBe(1);

    await scheduler.advanceHours(1, 'manual');

    [install] = scheduler.listInstalled();
    expect(install.refreshCount).toBe(0);
    expect(install.autoRefresh.lastDecisionCode).toBe('AUTO_REFRESH_WIFI_WAIT');
    expect(install.autoRefresh.retryCount).toBe(3);
    expect(install.autoRefresh.wifiWaitRemainingRetries).toBe(0);

    await scheduler.advanceHours(1, 'manual');

    [install] = scheduler.listInstalled();
    expect(install.refreshCount).toBeGreaterThanOrEqual(1);
    expect(install.autoRefresh.lastAttemptTransport).toBe('usb');
    expect(install.autoRefresh.lastDecisionCode).toBe('AUTO_REFRESH_SUCCESS');
    expect(install.autoRefresh.retryCount).toBe(0);
    expect(install.autoRefresh.wifiWaitRemainingRetries).toBe(2);

    scheduler.stop();
    store.close();
  });

  test('serializes overlapping scheduler advances to avoid concurrent evaluation races', async () => {
    const store = new AppStore('demo');
    const logs = new LogService(store);
    const slowMock = new SlowMockAdapter();
    const devices = new DeviceService(store, logs, new UnavailableRealAdapter(), slowMock);
    const scheduler = new SchedulerService(store, logs, devices, 99999, 6, {
      autoRefreshThresholdHours: 48,
      initialBackoffMinutes: 15,
      maxBackoffMinutes: 720,
      wifiWaitRetries: 2
    });

    scheduler.registerInstall({
      jobId: 'job_serial',
      ipaId: 'ipa_serial',
      deviceId: 'slow-device',
      mode: 'demo',
      kind: 'primary',
      label: 'Serialized App',
      bundleId: 'com.demo.serial',
      preferredTransport: 'wifi'
    });

    await Promise.all([
      scheduler.advanceHours(121, 'manual'),
      scheduler.advanceHours(121, 'manual')
    ]);

    expect(slowMock.maxInFlight).toBe(1);

    scheduler.stop();
    store.close();
  });

  test('rejects invalid manual advance values', async () => {
    const store = new AppStore('demo');
    const logs = new LogService(store);
    const devices = new DeviceService(store, logs, new UnavailableRealAdapter(), new MockDeviceAdapter());
    const scheduler = new SchedulerService(store, logs, devices, 99999, 6, {
      autoRefreshThresholdHours: 48,
      initialBackoffMinutes: 15,
      maxBackoffMinutes: 720,
      wifiWaitRetries: 2
    });

    await expect(scheduler.advanceHours(0, 'manual')).rejects.toThrow('Scheduler advance requires a positive number of hours.');

    scheduler.stop();
    store.close();
  });
});
