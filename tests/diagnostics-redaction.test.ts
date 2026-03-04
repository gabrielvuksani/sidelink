import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';

const TEST_USERNAME = 'redact-admin';
const TEST_PASSWORD = 'RedactPass123!';

describe('diagnostics redaction', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;
  let seededJobId = '';

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-redact-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-redact-db-'));

    built = buildApp({
      uploadDir,
      dbPath: path.join(dbDir, 'redaction.sqlite'),
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    agent = request.agent(built.app);

    const login = await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });

    expect(login.status).toBe(200);

    built.context.logs.push({
      level: 'error',
      code: 'REDACTION_LOG_MARKER',
      message: 'Install failed with password=SuperSecret! and token=tok_live_123456',
      action: 'Retry with Authorization: Bearer helper_token_secret',
      context: {
        helperToken: 'helper_token_raw_value',
        nested: {
          apiKey: 'api_key_raw_value',
          details: 'cookie=sidelink_session=very-secret-cookie'
        }
      }
    });

    const now = new Date().toISOString();
    seededJobId = built.context.store.newId('job');

    built.context.store.saveJob({
      id: seededJobId,
      mode: 'real',
      ipaId: 'ipa_redaction',
      deviceId: 'device_redaction',
      status: 'error',
      queuedAt: now,
      startedAt: now,
      endedAt: now,
      error: 'Install failed because token=job_token_secret',
      action: 'Use password=AnotherSecret and retry.',
      commandPreview: ['ideviceinstaller --token=preview_should_mask'],
      steps: [
        {
          key: 'install-app',
          label: 'Install app',
          state: 'error',
          detail: 'stderr contained x-sidelink-helper-token: helper-secret-value',
          action: 'Set Authorization: Bearer job_step_secret'
        }
      ],
      realExecutionApproved: true,
      helperEnsured: false
    });

    built.context.store.saveJobCommandRun({
      id: built.context.store.newId('cmd'),
      jobId: seededJobId,
      stepKey: 'install-app',
      command: 'ideviceinstaller --token=live_command_token',
      args: ['--token=arg_secret_token', '--password=arg_secret_password', '--mode=real'],
      cwd: '/tmp/password=filesystem-secret',
      startedAt: now,
      endedAt: now,
      exitCode: 1,
      status: 'error',
      stdout: 'stdout cookie=sidelink_session=stdout-cookie-secret',
      stderr: 'stderr x-sidelink-helper-token: helper-stderr-secret',
      note: 'authorization: Bearer note-secret-token'
    });
  });

  afterAll(() => {
    built.context.shutdown();

    process.env.SIDELINK_ADMIN_USERNAME = oldUsername;
    process.env.SIDELINK_ADMIN_PASSWORD = oldPassword;
  });

  test('redacts sensitive values from /api/logs responses', async () => {
    const response = await agent.get('/api/logs?code=REDACTION_LOG_MARKER&limit=5');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);

    const [entry] = response.body.items;
    expect(entry.message).toContain('[REDACTED]');
    expect(entry.message).not.toContain('SuperSecret!');
    expect(entry.message).not.toContain('tok_live_123456');

    expect(entry.action).toContain('[REDACTED]');
    expect(entry.action).not.toContain('helper_token_secret');

    expect(entry.context.helperToken).toBe('[REDACTED]');
    expect(entry.context.nested.apiKey).toBe('[REDACTED]');
    expect(String(entry.context.nested.details)).not.toContain('very-secret-cookie');
  });

  test('redacts sensitive values from command diagnostics and support snapshots', async () => {
    const commandResponse = await agent.get(`/api/jobs/${seededJobId}/commands`);

    expect(commandResponse.status).toBe(200);
    expect(commandResponse.body.items).toHaveLength(1);

    const [command] = commandResponse.body.items;
    expect(command.command).toContain('[REDACTED]');
    expect(command.command).not.toContain('live_command_token');
    expect(command.args.join(' ')).toContain('[REDACTED]');
    expect(command.args.join(' ')).not.toContain('arg_secret_token');
    expect(command.args.join(' ')).not.toContain('arg_secret_password');
    expect(String(command.note)).not.toContain('note-secret-token');
    expect(String(command.stderr)).not.toContain('helper-stderr-secret');

    const jobResponse = await agent.get(`/api/jobs/${seededJobId}`);

    expect(jobResponse.status).toBe(200);
    expect(jobResponse.body.job.error).toContain('[REDACTED]');
    expect(jobResponse.body.job.error).not.toContain('job_token_secret');
    expect(jobResponse.body.job.steps[0].detail).toContain('[REDACTED]');
    expect(jobResponse.body.job.steps[0].detail).not.toContain('helper-secret-value');

    const snapshotResponse = await agent.get('/api/support/snapshot?includeLogs=1&includeCommands=1&logCode=REDACTION_LOG_MARKER');

    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.body.logs).toHaveLength(1);
    expect(snapshotResponse.body.logs[0].message).toContain('[REDACTED]');
    expect(snapshotResponse.body.logs[0].message).not.toContain('tok_live_123456');

    const commandSummary = snapshotResponse.body.commandRunsByJob?.[seededJobId]?.[0];
    expect(commandSummary).toBeDefined();
    expect(commandSummary.args.join(' ')).toContain('[REDACTED]');
    expect(commandSummary.args.join(' ')).not.toContain('arg_secret_token');
  });
});
