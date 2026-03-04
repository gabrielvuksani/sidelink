import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';

const TEST_USERNAME = 'support-admin';
const TEST_PASSWORD = 'SupportPass123!';

const FIXED_BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');
const at = (minutesFromBase: number): string => new Date(FIXED_BASE_MS + minutesFromBase * 60 * 1000).toISOString();

describe('support diagnostics snapshot', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;

  let runningDemoJobId = '';
  let errorRealJobId = '';

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-support-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-support-db-'));

    built = buildApp({
      uploadDir,
      dbPath: path.join(dbDir, 'support.sqlite'),
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

    built.context.store.saveJob({
      id: runningDemoJobId,
      mode: 'demo',
      ipaId: 'ipa_seed_demo',
      deviceId: 'device_seed_demo',
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
      ipaId: 'ipa_seed_real',
      deviceId: 'device_seed_real',
      status: 'error',
      queuedAt: at(20),
      startedAt: at(21),
      endedAt: at(22),
      error: 'Simulated snapshot failure.',
      steps: [],
      realExecutionApproved: true,
      helperEnsured: false
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
  });

  afterAll(() => {
    built.context.shutdown();

    process.env.SIDELINK_ADMIN_USERNAME = oldUsername;
    process.env.SIDELINK_ADMIN_PASSWORD = oldPassword;
  });

  test('requires authentication for support snapshots', async () => {
    const response = await request(built.app).get('/api/support/snapshot');

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe('AUTH_REQUIRED');
  });

  test('returns structured support snapshot with optional download header', async () => {
    await agent.post('/api/mode').send({ mode: 'demo' });

    const response = await agent.get('/api/support/snapshot?includeLogs=0&download=1');

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment; filename="sidelink-support-');

    expect(response.body.package?.name).toBe('sidelink');
    expect(response.body.package?.version).toBeTypeOf('string');
    expect(response.body.runtime?.mode).toBe('demo');
    expect(response.body.runtime?.startedAt).toBeTypeOf('string');
    expect(response.body.runtime?.uptimeSeconds).toBeGreaterThanOrEqual(0);

    expect(response.body.scheduler?.running).toBe(true);
    expect(Array.isArray(response.body.jobs)).toBe(true);
    expect(Array.isArray(response.body.logs)).toBe(true);
    expect(response.body.logs).toHaveLength(0);
    expect(response.body.counts?.logs).toBe(0);
  });

  test('includes bounded logs and command summary metadata when requested', async () => {
    await agent.post('/api/mode').send({ mode: 'real' });
    await agent.post('/api/mode').send({ mode: 'demo' });

    const response = await agent.get('/api/support/snapshot?includeLogs=1&logLimit=2&includeCommands=1');

    expect(response.status).toBe(200);
    expect(response.body.logs.length).toBeLessThanOrEqual(2);
    expect(typeof response.body.commandRunsByJob).toBe('object');
  });

  test('applies job filters/limits in support snapshot payload metadata', async () => {
    const response = await agent.get('/api/support/snapshot?jobStatus=running,error&jobMode=demo&jobLimit=1');

    expect(response.status).toBe(200);
    expect(response.body.jobs).toHaveLength(1);
    expect(response.body.jobs[0].id).toBe(runningDemoJobId);
    expect(response.body.jobsMeta?.returned).toBe(1);
    expect(response.body.jobsMeta?.matched).toBe(1);
    expect(response.body.jobsMeta?.totalStored).toBeGreaterThanOrEqual(2);
    expect(response.body.jobsMeta?.hasMore).toBe(false);
    expect(response.body.jobsMeta?.filters?.status).toBe('running,error');
    expect(response.body.jobsMeta?.filters?.mode).toBe('demo');
  });

  test('supports command filters/limits for snapshot command summaries', async () => {
    const response = await agent.get(
      '/api/support/snapshot?includeCommands=1&jobStatus=running&commandStatus=error&commandSearch=identity&commandLimit=1'
    );

    expect(response.status).toBe(200);
    expect(response.body.jobs).toHaveLength(1);
    expect(response.body.jobs[0].id).toBe(runningDemoJobId);
    expect(Array.isArray(response.body.commandRunsByJob?.[runningDemoJobId])).toBe(true);
    expect(response.body.commandRunsByJob[runningDemoJobId]).toHaveLength(1);
    expect(response.body.commandRunsByJob[runningDemoJobId][0].status).toBe('error');
    expect(response.body.commandRunsMeta?.requestedLimit).toBe(1);
    expect(response.body.commandRunsMeta?.filters?.status).toBe('error');
    expect(response.body.commandRunsMeta?.filters?.search).toBe('identity');
    expect(response.body.commandRunsMeta?.jobs?.[runningDemoJobId]?.matched).toBe(1);
    expect(response.body.commandRunsMeta?.jobs?.[runningDemoJobId]?.hasMore).toBe(false);
  });

  test('validates support snapshot job and command filter inputs', async () => {
    const invalidJob = await agent.get('/api/support/snapshot?jobStatus=done');

    expect(invalidJob.status).toBe(400);
    expect(invalidJob.body.error?.code).toBe('JOB_FILTER_STATUS_INVALID');

    const invalidCommandRange = await agent.get(
      `/api/support/snapshot?includeCommands=1&commandAfter=${encodeURIComponent(at(40))}&commandBefore=${encodeURIComponent(at(39))}`
    );

    expect(invalidCommandRange.status).toBe(400);
    expect(invalidCommandRange.body.error?.code).toBe('COMMAND_FILTER_RANGE_INVALID');
  });

  test('health endpoint includes runtime/package metadata', async () => {
    const response = await request(built.app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.package?.name).toBe('sidelink');
    expect(response.body.package?.version).toBeTypeOf('string');
    expect(response.body.runtime?.node).toBeTypeOf('string');
    expect(response.body.runtime?.platform).toBeTypeOf('string');
    expect(response.body.startedAt).toBeTypeOf('string');
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
