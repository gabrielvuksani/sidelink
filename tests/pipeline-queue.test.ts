import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
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

const waitForJobCompletion = async (pipeline: PipelineService, jobId: string): Promise<void> => {
  for (let attempt = 0; attempt < 140; attempt += 1) {
    const job = pipeline.getJob(jobId);

    if (job?.status === 'success') {
      return;
    }

    if (job?.status === 'error') {
      throw new Error(job.error || `Job ${jobId} failed`);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for job completion: ${jobId}`);
};

const createPipelineContext = async () => {
  const helperDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-pipeline-queue-helper-'));

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

  return {
    store,
    logs,
    ipaService,
    devices,
    scheduler,
    pipeline
  };
};

describe('PipelineService queuing and dedupe', () => {
  test('serializes install jobs targeting the same device', async () => {
    const context = await createPipelineContext();

    const [ipaPathA, ipaPathB] = await Promise.all([
      createSampleIpa({ bundleId: 'com.demo.queue.a', displayName: 'Queue App A' }),
      createSampleIpa({ bundleId: 'com.demo.queue.b', displayName: 'Queue App B' })
    ]);

    const [statsA, statsB] = await Promise.all([stat(ipaPathA), stat(ipaPathB)]);

    const [artifactA, artifactB] = await Promise.all([
      context.ipaService.inspectAndStore({
        path: ipaPathA,
        filename: path.basename(ipaPathA),
        originalname: 'QueueA.ipa',
        size: statsA.size
      }),
      context.ipaService.inspectAndStore({
        path: ipaPathB,
        filename: path.basename(ipaPathB),
        originalname: 'QueueB.ipa',
        size: statsB.size
      })
    ]);

    const demoDevices = await context.devices.list('demo', true);
    const deviceId = demoDevices.devices[0].id;

    const jobA = await context.pipeline.enqueueInstall({
      ipaId: artifactA.id,
      deviceId,
      mode: 'demo',
      confirmRealExecution: false
    });

    const jobB = await context.pipeline.enqueueInstall({
      ipaId: artifactB.id,
      deviceId,
      mode: 'demo',
      confirmRealExecution: false
    });

    await Promise.all([
      waitForJobCompletion(context.pipeline, jobA.id),
      waitForJobCompletion(context.pipeline, jobB.id)
    ]);

    const completedA = context.pipeline.getJob(jobA.id);
    const completedB = context.pipeline.getJob(jobB.id);

    expect(completedA?.status).toBe('success');
    expect(completedB?.status).toBe('success');

    expect(completedA?.endedAt).toBeDefined();
    expect(completedB?.startedAt).toBeDefined();

    if (!completedA?.endedAt || !completedB?.startedAt) {
      throw new Error('Missing timing data for queued jobs.');
    }

    expect(new Date(completedB.startedAt).getTime()).toBeGreaterThanOrEqual(new Date(completedA.endedAt).getTime());

    const queuedLog = context.logs.list().find((entry) => entry.code === 'INSTALL_JOB_WAITING_DEVICE_LOCK');
    expect(queuedLog).toBeDefined();

    context.scheduler.stop();
    context.store.close();
  }, 12000);

  test('suppresses duplicate in-flight install requests for identical params', async () => {
    const context = await createPipelineContext();

    const ipaPath = await createSampleIpa({ bundleId: 'com.demo.duplicate', displayName: 'Duplicate App' });
    const stats = await stat(ipaPath);

    const artifact = await context.ipaService.inspectAndStore({
      path: ipaPath,
      filename: path.basename(ipaPath),
      originalname: 'Duplicate.ipa',
      size: stats.size
    });

    const demoDevices = await context.devices.list('demo', true);
    const deviceId = demoDevices.devices[0].id;

    const first = await context.pipeline.enqueueInstall({
      ipaId: artifact.id,
      deviceId,
      mode: 'demo',
      confirmRealExecution: false
    });

    const duplicate = await context.pipeline.enqueueInstall({
      ipaId: artifact.id,
      deviceId,
      mode: 'demo',
      confirmRealExecution: false
    });

    expect(duplicate.id).toBe(first.id);

    await waitForJobCompletion(context.pipeline, first.id);

    const allJobs = context.pipeline.listJobs();
    expect(allJobs.length).toBe(1);
    expect(allJobs[0].id).toBe(first.id);

    const dedupeLog = context.logs.list().find((entry) => entry.code === 'INSTALL_JOB_DUPLICATE_SUPPRESSED');
    expect(dedupeLog).toBeDefined();

    context.scheduler.stop();
    context.store.close();
  }, 12000);
});
