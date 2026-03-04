import { copyFile, mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { InstallAdapter, InstallExecutionParams } from '../src/server/adapters/install-adapter';
import { SigningAdapter, SigningExecutionParams, SigningExecutionResult } from '../src/server/adapters/signing-adapter';
import { CommandAuditWriter } from '../src/server/adapters/toolchain-types';
import { DeviceAdapter } from '../src/server/adapters/device-adapter';
import { MockDeviceAdapter } from '../src/server/adapters/mock-device-adapter';
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
          id: '00008110-REALDEVICE0001',
          name: 'Test iPhone',
          osVersion: '17.2',
          model: 'iPhone15,2',
          connection: 'online' as const,
          transport: 'wifi' as const,
          source: 'real' as const,
          batteryPercent: 88,
          lastSeenAt: new Date().toISOString(),
          ipAddress: '192.168.1.99',
          networkName: 'Test WiFi'
        }
      ]
    };
  }
}

class MockSigningAdapter implements SigningAdapter {
  public ensureAvailableCalls = 0;
  public signCalls = 0;

  public async ensureAvailable(): Promise<void> {
    this.ensureAvailableCalls += 1;
  }

  public async sign(params: SigningExecutionParams, audit?: CommandAuditWriter): Promise<SigningExecutionResult> {
    this.signCalls += 1;

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-real-sign-'));
    const signedIpaPath = path.join(tempDir, 'signed.ipa');
    await copyFile(params.ipaPath, signedIpaPath);

    if (audit) {
      const now = new Date().toISOString();
      await audit({
        command: 'security',
        args: ['find-identity', '-v', '-p', 'codesigning'],
        status: 'success',
        startedAt: now,
        endedAt: now,
        exitCode: 0,
        stdout: '1) MOCKIDENTITY "Apple Development: Test User"'
      });

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
      cleanup: async () => {
        // noop in tests; temp directories are ephemeral.
      }
    };
  }
}

class MockInstallAdapter implements InstallAdapter {
  public ensureAvailableCalls = 0;
  public preflightCalls = 0;
  public installCalls = 0;

  public async ensureAvailable(): Promise<void> {
    this.ensureAvailableCalls += 1;
  }

  public async preflightDevice(deviceId: string, audit?: CommandAuditWriter): Promise<void> {
    this.preflightCalls += 1;
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
    this.installCalls += 1;

    if (audit) {
      const now = new Date().toISOString();
      await audit({
        command: 'ideviceinstaller',
        args: ['-u', params.deviceId, '-i', params.signedIpaPath],
        status: 'success',
        startedAt: now,
        endedAt: now,
        exitCode: 0,
        stdout: 'Complete'
      });
    }
  }
}

const waitForJobCompletion = async (pipeline: PipelineService, jobId: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = pipeline.getJob(jobId);
    if (job?.status === 'success') {
      return;
    }

    if (job?.status === 'error') {
      throw new Error(`Job failed: ${job.error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('Timed out waiting for pipeline job completion');
};

afterEach(() => {
  delete process.env.SIDELINK_ENABLE_REAL_WORKER;
  delete process.env.SIDELINK_REAL_SIGNING_IDENTITY;
});

describe('real-mode worker path', () => {
  test('executes signing/install adapters when both safety gates are open', async () => {
    process.env.SIDELINK_ENABLE_REAL_WORKER = '1';
    process.env.SIDELINK_REAL_SIGNING_IDENTITY = 'Apple Development: Test User';

    const helperDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helper-project-'));

    const store = new AppStore('demo');
    const logs = new LogService(store);
    const ipaService = new IpaService(store, logs);
    const devices = new DeviceService(store, logs, new SingleRealAdapter(), new MockDeviceAdapter());
    const scheduler = new SchedulerService(store, logs, devices, 100000, 6, {
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

    const signingAdapter = new MockSigningAdapter();
    const installAdapter = new MockInstallAdapter();
    const pipeline = new PipelineService(store, ipaService, devices, scheduler, logs, helperService, {
      signingAdapter,
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
    const target = realDevices.devices[0];

    const job = await pipeline.enqueueInstall({
      ipaId: artifact.id,
      deviceId: target.id,
      mode: 'real',
      confirmRealExecution: true
    });

    await waitForJobCompletion(pipeline, job.id);

    const completed = pipeline.getJob(job.id);
    expect(completed?.status).toBe('success');
    expect(signingAdapter.signCalls).toBe(1);
    expect(installAdapter.installCalls).toBe(1);

    const commands = pipeline.listJobCommandRuns(job.id);
    expect(commands.some((command) => command.command === 'codesign' && command.status === 'success')).toBe(true);
    expect(commands.some((command) => command.command === 'ideviceinstaller' && command.status === 'success')).toBe(true);

    scheduler.stop();
    store.close();
  });

  test('records skipped command audit when API confirmation gate is missing', async () => {
    process.env.SIDELINK_ENABLE_REAL_WORKER = '1';
    process.env.SIDELINK_REAL_SIGNING_IDENTITY = 'Apple Development: Test User';

    const helperDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helper-project-'));

    const store = new AppStore('demo');
    const logs = new LogService(store);
    const ipaService = new IpaService(store, logs);
    const devices = new DeviceService(store, logs, new SingleRealAdapter(), new MockDeviceAdapter());
    const scheduler = new SchedulerService(store, logs, devices, 100000, 6, {
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

    const signingAdapter = new MockSigningAdapter();
    const installAdapter = new MockInstallAdapter();
    const pipeline = new PipelineService(store, ipaService, devices, scheduler, logs, helperService, {
      signingAdapter,
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
      confirmRealExecution: false
    });

    await waitForJobCompletion(pipeline, job.id);

    expect(signingAdapter.signCalls).toBe(0);
    expect(installAdapter.installCalls).toBe(0);

    const commands = pipeline.listJobCommandRuns(job.id);
    expect(commands.some((command) => command.status === 'skipped')).toBe(true);

    scheduler.stop();
    store.close();
  });

  test('blocks real-mode install when discovery source falls back to mock devices', async () => {
    process.env.SIDELINK_ENABLE_REAL_WORKER = '1';
    process.env.SIDELINK_REAL_SIGNING_IDENTITY = 'Apple Development: Test User';

    const helperDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helper-project-'));

    const store = new AppStore('demo');
    const logs = new LogService(store);
    const ipaService = new IpaService(store, logs);
    const devices = new DeviceService(store, logs, new UnavailableRealAdapter(), new MockDeviceAdapter());
    const scheduler = new SchedulerService(store, logs, devices, 100000, 6, {
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

    const signingAdapter = new MockSigningAdapter();
    const installAdapter = new MockInstallAdapter();
    const pipeline = new PipelineService(store, ipaService, devices, scheduler, logs, helperService, {
      signingAdapter,
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

    const fallbackDevices = await devices.list('real', true);

    const job = await pipeline.enqueueInstall({
      ipaId: artifact.id,
      deviceId: fallbackDevices.devices[0].id,
      mode: 'real',
      confirmRealExecution: true
    });

    let failed = pipeline.getJob(job.id);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      failed = pipeline.getJob(job.id);
      if (failed?.status === 'error') {
        break;
      }

      if (failed?.status === 'success') {
        throw new Error('Expected real-mode job to fail when discovery source is mock fallback.');
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(failed?.status).toBe('error');
    expect(failed?.error).toContain('Real mode requires a real connected iOS device');
    expect(signingAdapter.signCalls).toBe(0);
    expect(installAdapter.installCalls).toBe(0);

    scheduler.stop();
    store.close();
  });
});
