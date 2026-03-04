import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';

const TEST_USERNAME = 'job-filter-admin';
const TEST_PASSWORD = 'JobFilterPass123!';

const FIXED_BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');
const at = (minutesFromBase: number): string => new Date(FIXED_BASE_MS + minutesFromBase * 60 * 1000).toISOString();

describe('jobs + command diagnostics filters', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;

  let runningDemoJobId = '';
  let errorRealJobId = '';
  let successDemoJobId = '';

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;

    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-job-filter-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-job-filter-db-'));

    built = buildApp({
      uploadDir,
      dbPath: path.join(dbDir, 'job-filter.sqlite'),
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    agent = request.agent(built.app);

    const login = await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });

    expect(login.status).toBe(200);

    runningDemoJobId = built.context.store.newId('job');
    errorRealJobId = built.context.store.newId('job');
    successDemoJobId = built.context.store.newId('job');

    built.context.store.saveJob({
      id: runningDemoJobId,
      mode: 'demo',
      ipaId: 'ipa_a',
      deviceId: 'device_demo_1',
      status: 'running',
      queuedAt: at(30),
      startedAt: at(31),
      steps: [],
      realExecutionApproved: false,
      helperEnsured: true
    });

    built.context.store.saveJob({
      id: errorRealJobId,
      mode: 'real',
      ipaId: 'ipa_b',
      deviceId: 'device_real_1',
      status: 'error',
      queuedAt: at(20),
      startedAt: at(21),
      endedAt: at(22),
      error: 'Simulated pipeline failure.',
      steps: [],
      realExecutionApproved: true,
      helperEnsured: false
    });

    built.context.store.saveJob({
      id: successDemoJobId,
      mode: 'demo',
      ipaId: 'ipa_b',
      deviceId: 'device_demo_1',
      status: 'success',
      queuedAt: at(10),
      startedAt: at(11),
      endedAt: at(12),
      steps: [],
      realExecutionApproved: false,
      helperEnsured: true
    });

    built.context.store.saveJobCommandRun({
      id: built.context.store.newId('cmd'),
      jobId: runningDemoJobId,
      stepKey: 'install-app',
      command: 'ideviceinstaller',
      args: ['--mode=demo', '--install'],
      startedAt: at(33),
      endedAt: at(34),
      exitCode: 0,
      status: 'success',
      stdout: 'install succeeded',
      stderr: ''
    });

    built.context.store.saveJobCommandRun({
      id: built.context.store.newId('cmd'),
      jobId: runningDemoJobId,
      stepKey: 'prepare-signing',
      command: 'codesign',
      args: ['--identity=Apple Development'],
      startedAt: at(35),
      endedAt: at(36),
      exitCode: 1,
      status: 'error',
      stdout: 'codesign output',
      stderr: 'identity mismatch for QA identity'
    });

    built.context.store.saveJobCommandRun({
      id: built.context.store.newId('cmd'),
      jobId: runningDemoJobId,
      stepKey: 'install-app',
      command: 'ideviceinstaller',
      args: ['--mode=preview'],
      startedAt: at(37),
      endedAt: at(37),
      status: 'skipped',
      note: 'preview-only safety gate'
    });
  });

  afterAll(() => {
    built.context.shutdown();

    process.env.SIDELINK_ADMIN_USERNAME = oldUsername;
    process.env.SIDELINK_ADMIN_PASSWORD = oldPassword;
  });

  test('filters jobs with status/mode/device and returns bounded metadata', async () => {
    const response = await agent.get('/api/jobs?status=running,success&mode=demo&deviceId=device_demo_1&limit=1');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].id).toBe(runningDemoJobId);

    expect(response.body.meta?.returned).toBe(1);
    expect(response.body.meta?.matched).toBe(2);
    expect(response.body.meta?.totalStored).toBe(3);
    expect(response.body.meta?.hasMore).toBe(true);
    expect(response.body.meta?.filters?.status).toBe('running,success');
    expect(response.body.meta?.filters?.mode).toBe('demo');
    expect(response.body.meta?.filters?.deviceId).toBe('device_demo_1');
  });

  test('supports queuedAt time window filters and validates invalid status values', async () => {
    const ranged = await agent.get(`/api/jobs?after=${encodeURIComponent(at(19))}&before=${encodeURIComponent(at(21))}`);

    expect(ranged.status).toBe(200);
    expect(ranged.body.items).toHaveLength(1);
    expect(ranged.body.items[0].id).toBe(errorRealJobId);

    const invalid = await agent.get('/api/jobs?status=done');

    expect(invalid.status).toBe(400);
    expect(invalid.body.error?.code).toBe('JOB_FILTER_STATUS_INVALID');
  });

  test('filters command runs and can omit stdout/stderr payloads', async () => {
    const response = await agent.get(
      `/api/jobs/${runningDemoJobId}/commands?status=error,skipped&search=${encodeURIComponent('identity')}&includeOutput=0`
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);

    const [command] = response.body.items;
    expect(command.status).toBe('error');
    expect(command.stepKey).toBe('prepare-signing');
    expect(command).not.toHaveProperty('stdout');
    expect(command).not.toHaveProperty('stderr');

    expect(response.body.meta?.includeOutput).toBe(false);
    expect(response.body.meta?.matched).toBe(1);
    expect(response.body.meta?.filters?.search).toBe('identity');
    expect(response.body.meta?.filters?.status).toBe('error,skipped');
  });

  test('applies command step+limit filters and validates time range', async () => {
    const filtered = await agent.get(`/api/jobs/${runningDemoJobId}/commands?stepKey=install-app&limit=1`);

    expect(filtered.status).toBe(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].stepKey).toBe('install-app');
    expect(filtered.body.meta?.matched).toBe(2);
    expect(filtered.body.meta?.hasMore).toBe(true);

    const invalidRange = await agent.get(`/api/jobs/${runningDemoJobId}/commands?after=${encodeURIComponent(at(40))}&before=${encodeURIComponent(at(39))}`);

    expect(invalidRange.status).toBe(400);
    expect(invalidRange.body.error?.code).toBe('COMMAND_FILTER_RANGE_INVALID');
  });
});
