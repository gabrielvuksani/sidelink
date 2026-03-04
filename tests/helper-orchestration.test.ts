import { copyFile, mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { DeviceAdapter } from '../src/server/adapters/device-adapter';
import { InstallAdapter, InstallExecutionParams } from '../src/server/adapters/install-adapter';
import { MockDeviceAdapter } from '../src/server/adapters/mock-device-adapter';
import { SigningAdapter, SigningExecutionParams, SigningExecutionResult } from '../src/server/adapters/signing-adapter';
import { CommandAuditWriter } from '../src/server/adapters/toolchain-types';
import { AppStore } from '../src/server/state/store';
import { DeviceService } from '../src/server/services/device-service';
import { HelperService } from '../src/server/services/helper-service';
import { IpaService } from '../src/server/services/ipa-service';
import { LogService } from '../src/server/services/log-service';
import { PipelineService } from '../src/server/services/pipeline-service';
import { SchedulerService } from '../src/server/services/scheduler-service';
import { createSampleIpa } from './helpers';

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

class SingleRealAdapter implements DeviceAdapter {
  public readonly name = 'single-real';

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async listDevices() {
    return {
      source: 'real' as const,
      devices: [
        {
          id: '00008110-REALHELPER0001',
          name: 'Real Helper Test Device',
          osVersion: '17.4',
          model: 'iPhone15,4',
          connection: 'online' as const,
          transport: 'wifi' as const,
          source: 'real' as const,
          batteryPercent: 84,
          lastSeenAt: new Date().toISOString(),
          ipAddress: '192.168.1.55',
          networkName: 'QA WiFi'
        }
      ]
    };
  }
}

class TestSigningAdapter implements SigningAdapter {
  public async ensureAvailable(): Promise<void> {
    // no-op for tests
  }

  public async sign(params: SigningExecutionParams, audit?: CommandAuditWriter): Promise<SigningExecutionResult> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helper-soft-sign-'));
    const signedIpaPath = path.join(tempDir, 'signed.ipa');
    await copyFile(params.ipaPath, signedIpaPath);

    if (audit) {
      const now = new Date().toISOString();
      await audit({
        command: 'codesign',
        args: ['-f', '--deep', '-s', params.signingIdentity, 'Payload/Test.app'],
        status: 'success',
        startedAt: now,
        endedAt: now,
        exitCode: 0,
        stdout: 'signed'
      });
    }

    return {
      signedIpaPath,
      workingDir: tempDir,
      cleanup: async () => undefined
    };
  }
}

class SoftFailHelperInstallAdapter implements InstallAdapter {
  public helperFailures = 0;
  public primaryInstalls = 0;

  public async ensureAvailable(): Promise<void> {
    // no-op for tests
  }

  public async preflightDevice(deviceId: string, audit?: CommandAuditWriter): Promise<void> {
    if (audit) {
      const now = new Date().toISOString();
      await audit({
        command: 'ideviceinstaller',
        args: ['-u', deviceId, '-l'],
        status: 'success',
        startedAt: now,
        endedAt: now,
        exitCode: 0,
        stdout: 'device ok'
      });
    }
  }

  public async install(params: InstallExecutionParams, audit?: CommandAuditWriter): Promise<void> {
    const now = new Date().toISOString();

    if (params.signedIpaPath.endsWith('SidelinkHelper.ipa')) {
      this.helperFailures += 1;

      if (audit) {
        await audit({
          command: 'ideviceinstaller',
          args: ['-u', params.deviceId, '-i', params.signedIpaPath],
          status: 'error',
          startedAt: now,
          endedAt: now,
          exitCode: 1,
          stderr: 'helper install failed in test adapter'
        });
      }

      throw new Error('helper install failed in test adapter');
    }

    this.primaryInstalls += 1;

    if (audit) {
      await audit({
        command: 'ideviceinstaller',
        args: ['-u', params.deviceId, '-i', params.signedIpaPath],
        status: 'success',
        startedAt: now,
        endedAt: now,
        exitCode: 0,
        stdout: 'primary install ok'
      });
    }
  }
}

const waitForJobCompletion = async (pipeline: PipelineService, jobId: string): Promise<void> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = pipeline.getJob(jobId);
    if (job?.status === 'success') {
      return;
    }

    if (job?.status === 'error') {
      throw new Error(job.error || 'Job failed');
    }

    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  throw new Error('Timed out waiting for pipeline job completion');
};

afterEach(() => {
  delete process.env.SIDELINK_ENABLE_REAL_WORKER;
  delete process.env.SIDELINK_REAL_SIGNING_IDENTITY;
});

describe('helper auto-install orchestration', () => {
  test('demo install flow auto-registers helper app alongside primary app', async () => {
    const helperDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helper-demo-'));

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

    const pipeline = new PipelineService(store, ipaService, devices, scheduler, logs, helperService);

    const ipaPath = await createSampleIpa();
    const ipaStats = await stat(ipaPath);
    const artifact = await ipaService.inspectAndStore({
      path: ipaPath,
      filename: path.basename(ipaPath),
      originalname: 'Sample.ipa',
      size: ipaStats.size
    });

    const demoDevices = await devices.list('demo', true);

    const job = await pipeline.enqueueInstall({
      ipaId: artifact.id,
      deviceId: demoDevices.devices[0].id,
      mode: 'demo',
      confirmRealExecution: false
    });

    await waitForJobCompletion(pipeline, job.id);

    const installs = scheduler.listInstalled();
    expect(installs.some((install) => install.kind === 'helper' && install.bundleId === 'com.sidelink.helper')).toBe(true);
    expect(installs.some((install) => install.kind === 'primary' && install.bundleId === artifact.bundleId)).toBe(true);

    scheduler.stop();
    store.close();
  });

  test('skips helper reinstall when a healthy helper lifecycle is already tracked on device', async () => {
    const helperDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helper-skip-existing-'));

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

    const pipeline = new PipelineService(store, ipaService, devices, scheduler, logs, helperService);

    const [ipaPathA, ipaPathB] = await Promise.all([
      createSampleIpa({ bundleId: 'com.demo.helperskip.a', displayName: 'Helper Skip A' }),
      createSampleIpa({ bundleId: 'com.demo.helperskip.b', displayName: 'Helper Skip B' })
    ]);

    const [statsA, statsB] = await Promise.all([stat(ipaPathA), stat(ipaPathB)]);

    const [artifactA, artifactB] = await Promise.all([
      ipaService.inspectAndStore({
        path: ipaPathA,
        filename: path.basename(ipaPathA),
        originalname: 'HelperSkipA.ipa',
        size: statsA.size
      }),
      ipaService.inspectAndStore({
        path: ipaPathB,
        filename: path.basename(ipaPathB),
        originalname: 'HelperSkipB.ipa',
        size: statsB.size
      })
    ]);

    const demoDevices = await devices.list('demo', true);
    const deviceId = demoDevices.devices[0].id;

    const firstJob = await pipeline.enqueueInstall({
      ipaId: artifactA.id,
      deviceId,
      mode: 'demo',
      confirmRealExecution: false
    });
    await waitForJobCompletion(pipeline, firstJob.id);

    const secondJob = await pipeline.enqueueInstall({
      ipaId: artifactB.id,
      deviceId,
      mode: 'demo',
      confirmRealExecution: false
    });
    await waitForJobCompletion(pipeline, secondJob.id);

    const secondCompleted = pipeline.getJob(secondJob.id);
    expect(secondCompleted?.status).toBe('success');

    const helperStep = secondCompleted?.steps.find((step) => step.key === 'ensure-helper-app');
    expect(helperStep?.state).toBe('success');
    expect(helperStep?.detail).toContain('Helper already healthy on target device');

    const helperRecords = scheduler.listInstalled().filter((install) => install.kind === 'helper' && install.deviceId === deviceId);
    expect(helperRecords.length).toBe(1);

    const skipLog = logs.list().find((entry) => entry.code === 'HELPER_ENSURE_ALREADY_HEALTHY');
    expect(skipLog).toBeDefined();

    scheduler.stop();
    store.close();
  }, 12000);

  test('continues primary real install when helper ensure fails at runtime', async () => {
    process.env.SIDELINK_ENABLE_REAL_WORKER = '1';
    process.env.SIDELINK_REAL_SIGNING_IDENTITY = 'Apple Development: Test User';

    const helperDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helper-soft-fail-'));
    const helperIpaPath = path.join(helperDir, 'SidelinkHelper.ipa');
    await writeFile(helperIpaPath, 'fake-helper-ipa');

    const store = new AppStore('demo');
    const logs = new LogService(store);
    const ipaService = new IpaService(store, logs);
    const devices = new DeviceService(store, logs, new SingleRealAdapter(), new MockDeviceAdapter());
    const scheduler = new SchedulerService(store, logs, devices, 99999, 6, {
      autoRefreshThresholdHours: 48,
      initialBackoffMinutes: 15,
      maxBackoffMinutes: 720,
      wifiWaitRetries: 2
    });

    const helperService = new HelperService(store, logs, {
      helperToken: 'test-token',
      helperProjectDir: helperDir,
      helperIpaPath,
      helperBundleId: 'com.sidelink.helper',
      helperDisplayName: 'Sidelink Helper'
    });

    const installAdapter = new SoftFailHelperInstallAdapter();
    const pipeline = new PipelineService(store, ipaService, devices, scheduler, logs, helperService, {
      signingAdapter: new TestSigningAdapter(),
      installAdapter
    });

    const ipaPath = await createSampleIpa();
    const ipaStats = await stat(ipaPath);
    const artifact = await ipaService.inspectAndStore({
      path: ipaPath,
      filename: path.basename(ipaPath),
      originalname: 'Sample.ipa',
      size: ipaStats.size
    });

    const realDevices = await devices.list('real', true);

    const job = await pipeline.enqueueInstall({
      ipaId: artifact.id,
      deviceId: realDevices.devices[0].id,
      mode: 'real',
      confirmRealExecution: true
    });

    await waitForJobCompletion(pipeline, job.id);

    const completed = pipeline.getJob(job.id);
    expect(completed?.status).toBe('success');
    expect(completed?.helperEnsured).toBe(false);

    const helperStep = completed?.steps.find((step) => step.key === 'ensure-helper-app');
    expect(helperStep?.state).toBe('success');
    expect(helperStep?.detail).toContain('Helper ensure failed but pipeline continued');

    expect(installAdapter.helperFailures).toBe(1);
    expect(installAdapter.primaryInstalls).toBe(1);

    const installed = scheduler.listInstalled();
    expect(installed.some((install) => install.kind === 'primary' && install.bundleId === artifact.bundleId)).toBe(true);
    expect(installed.some((install) => install.kind === 'helper')).toBe(false);

    const warnLog = logs.list().find((entry) => entry.code === 'HELPER_ENSURE_SOFT_FAILED');
    expect(warnLog).toBeDefined();

    scheduler.stop();
    store.close();
  });
});
