import { beforeEach, describe, expect, it, vi } from 'vitest';
const startInstallPipeline = vi.fn(async () => ({ id: 'job-1' }));

vi.mock('../src/server/pipeline/pipeline', () => ({
  startInstallPipeline,
}));

function makeDeps() {
  const now = new Date();
  const nearExpiry = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

  const db = {
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
    listInstalledApps: vi.fn(() => [
      {
        id: 'inst-1',
        bundleId: 'com.demo.app',
        appName: 'Demo App',
        deviceUdid: 'device-1',
        expiresAt: nearExpiry,
        lastRefreshAt: null,
        accountId: 'acc-1',
        ipaId: 'ipa-1',
      },
    ]),
    getInstalledApp: vi.fn((id: string) => {
      if (id !== 'inst-1') return null;
      return {
        id: 'inst-1',
        bundleId: 'com.demo.app',
        appName: 'Demo App',
        deviceUdid: 'device-1',
        expiresAt: nearExpiry,
        lastRefreshAt: null,
        accountId: 'acc-1',
        ipaId: 'ipa-1',
      };
    }),
  };

  const logs = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const devices = {
    list: vi.fn(() => [{ udid: 'device-1' }]),
  };

  return { db, logs, devices };
}

describe('SchedulerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks installs as needing refresh near expiry', async () => {
    const { SchedulerService } = await import('../src/server/services/scheduler-service');
    const { db, logs, devices } = makeDeps();
    const service = new SchedulerService({} as any, db as any, logs as any, devices as any);

    const states = service.getAutoRefreshStates();
    expect(states).toHaveLength(1);
    expect(states[0].needsRefresh).toBe(true);
    expect(states[0].isExpired).toBe(false);
  });

  it('triggers pipeline refresh for a known install id', async () => {
    const { SchedulerService } = await import('../src/server/services/scheduler-service');
    const { db, logs, devices } = makeDeps();
    const service = new SchedulerService({} as any, db as any, logs as any, devices as any);

    await service.triggerRefresh('inst-1');
    expect(startInstallPipeline).toHaveBeenCalledWith({}, {
      accountId: 'acc-1',
      ipaId: 'ipa-1',
      deviceUdid: 'device-1',
    });
  });

  it('throws for unknown install id', async () => {
    const { SchedulerService } = await import('../src/server/services/scheduler-service');
    const { db, logs, devices } = makeDeps();
    const service = new SchedulerService({} as any, db as any, logs as any, devices as any);

    await expect(service.triggerRefresh('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('applies retry backoff while device is disconnected, then retries when backoff elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const { SchedulerService } = await import('../src/server/services/scheduler-service');
    const { db, logs } = makeDeps();
    let connected = false;
    const devices = {
      list: vi.fn(() => (connected ? [{ udid: 'device-1' }] : [])),
    };

    const service = new SchedulerService({} as any, db as any, logs as any, devices as any);

    await (service as any).tick();
    await (service as any).tick();

    // First disconnected tick schedules a retry; second tick stays in backoff window.
    expect(startInstallPipeline).not.toHaveBeenCalled();
    expect(logs.debug).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('waiting for retry backoff window'),
      expect.objectContaining({
        deviceUdid: 'device-1',
        attempt: 1,
      }),
    );

    vi.setSystemTime(new Date('2026-01-01T00:15:00.000Z'));
    connected = true;
    await (service as any).tick();

    expect(startInstallPipeline).toHaveBeenCalledWith({}, {
      accountId: 'acc-1',
      ipaId: 'ipa-1',
      deviceUdid: 'device-1',
    });

    vi.useRealTimers();
  });
});
