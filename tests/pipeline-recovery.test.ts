import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { DeviceAdapter } from '../src/server/adapters/device-adapter';
import { MockDeviceAdapter } from '../src/server/adapters/mock-device-adapter';
import { InstallJob, InstallJobStep } from '../src/server/types';
import { AppStore } from '../src/server/state/store';
import { DeviceService } from '../src/server/services/device-service';
import { HelperService } from '../src/server/services/helper-service';
import { IpaService } from '../src/server/services/ipa-service';
import { LogService } from '../src/server/services/log-service';
import { PipelineService } from '../src/server/services/pipeline-service';
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

const makeSteps = (): InstallJobStep[] => [
  { key: 'validate-inputs', label: 'Validate IPA + device', state: 'pending' },
  { key: 'ensure-helper-app', label: 'Ensure helper app on target device', state: 'pending' },
  { key: 'prepare-signing', label: 'Prepare signing context', state: 'pending' },
  { key: 'install-app', label: 'Install to device', state: 'pending' },
  { key: 'register-refresh', label: 'Register refresh lifecycle', state: 'pending' }
];

describe('PipelineService recovery', () => {
  test('marks interrupted queued/running jobs as recoverable errors on startup', async () => {
    const helperDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-pipeline-recovery-helper-'));

    const store = new AppStore('demo');
    const logs = new LogService(store);
    const ipaService = new IpaService(store, logs);
    const devices = new DeviceService(store, logs, new UnavailableRealAdapter(), new MockDeviceAdapter());
    const scheduler = new SchedulerService(store, logs, devices, 99999, 6, {
      autoRefreshThresholdHours: 48,
      initialBackoffMinutes: 15,
      maxBackoffMinutes: 720,
      wifiWaitRetries: 2
    });

    const helperService = new HelperService(store, logs, {
      helperToken: 'test-token',
      helperProjectDir: helperDir,
      helperIpaPath: path.join(helperDir, 'SidelinkHelper.ipa'),
      helperBundleId: 'com.sidelink.helper',
      helperDisplayName: 'Sidelink Helper'
    });

    const runningJob: InstallJob = {
      id: 'job_running_old',
      mode: 'demo',
      ipaId: 'ipa_1',
      deviceId: 'mock-iphone-15-pro',
      status: 'running',
      queuedAt: new Date(Date.now() - 30000).toISOString(),
      startedAt: new Date(Date.now() - 29000).toISOString(),
      steps: makeSteps(),
      commandPreview: []
    };

    runningJob.steps[0].state = 'success';
    runningJob.steps[0].startedAt = new Date(Date.now() - 29000).toISOString();
    runningJob.steps[0].endedAt = new Date(Date.now() - 28000).toISOString();
    runningJob.steps[1].state = 'running';
    runningJob.steps[1].startedAt = new Date(Date.now() - 28000).toISOString();

    const queuedJob: InstallJob = {
      id: 'job_queued_old',
      mode: 'demo',
      ipaId: 'ipa_2',
      deviceId: 'mock-iphone-15-pro',
      status: 'queued',
      queuedAt: new Date(Date.now() - 20000).toISOString(),
      steps: makeSteps(),
      commandPreview: []
    };

    store.saveJob(runningJob);
    store.saveJob(queuedJob);

    const pipeline = new PipelineService(store, ipaService, devices, scheduler, logs, helperService);

    const recoveredRunning = pipeline.getJob(runningJob.id);
    const recoveredQueued = pipeline.getJob(queuedJob.id);

    expect(recoveredRunning?.status).toBe('error');
    expect(recoveredRunning?.error).toContain('interrupted');
    expect(recoveredRunning?.endedAt).toBeDefined();

    const runningStep = recoveredRunning?.steps.find((step) => step.key === 'ensure-helper-app');
    expect(runningStep?.state).toBe('error');
    expect(runningStep?.detail).toContain('interrupted');

    const skippedAfterRunning = recoveredRunning?.steps.filter((step) => step.state === 'skipped') || [];
    expect(skippedAfterRunning.length).toBeGreaterThanOrEqual(1);

    expect(recoveredQueued?.status).toBe('error');
    const queuedFirstStep = recoveredQueued?.steps.find((step) => step.key === 'validate-inputs');
    expect(queuedFirstStep?.state).toBe('error');
    expect(queuedFirstStep?.detail).toContain('interrupted');

    const queuedSkipped = recoveredQueued?.steps.filter((step) => step.state === 'skipped') || [];
    expect(queuedSkipped.length).toBeGreaterThanOrEqual(1);

    const recoveryLogs = logs.list().filter((entry) => entry.code === 'INSTALL_JOB_INTERRUPTED_RECOVERED');
    expect(recoveryLogs.length).toBe(2);

    scheduler.stop();
    store.close();
  });
});
