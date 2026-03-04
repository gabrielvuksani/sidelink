import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';

const TEST_USERNAME = 'mode-admin';
const TEST_PASSWORD = 'ModePass123!';

describe('mode validation hardening', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-mode-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-mode-db-'));

    built = buildApp({
      uploadDir,
      dbPath: path.join(dbDir, 'mode.sqlite'),
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    agent = request.agent(built.app);

    const login = await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });

    expect(login.status).toBe(200);
  });

  afterAll(() => {
    built.context.shutdown();

    process.env.SIDELINK_ADMIN_USERNAME = oldUsername;
    process.env.SIDELINK_ADMIN_PASSWORD = oldPassword;
  });

  test('rejects invalid mode values across endpoints without mutating runtime mode', async () => {
    const before = await agent.get('/api/mode');
    expect(before.status).toBe(200);
    expect(before.body.mode).toBe('demo');

    const updateInvalid = await agent.post('/api/mode').send({ mode: 'shipping' });
    expect(updateInvalid.status).toBe(400);
    expect(updateInvalid.body.error?.code).toBe('MODE_INVALID');

    const after = await agent.get('/api/mode');
    expect(after.status).toBe(200);
    expect(after.body.mode).toBe('demo');

    const devicesInvalid = await agent.get('/api/devices?mode=shipping&refresh=1');
    expect(devicesInvalid.status).toBe(400);
    expect(devicesInvalid.body.error?.code).toBe('MODE_INVALID');

    const installInvalid = await agent.post('/api/install').send({
      ipaId: 'ipa_test',
      deviceId: 'device_test',
      mode: 'shipping'
    });
    expect(installInvalid.status).toBe(400);
    expect(installInvalid.body.error?.code).toBe('MODE_INVALID');

    const helperStatusInvalid = await agent.get('/api/helper/status?mode=shipping');
    expect(helperStatusInvalid.status).toBe(400);
    expect(helperStatusInvalid.body.error?.code).toBe('MODE_INVALID');
  });

  test('accepts case-insensitive mode values', async () => {
    const real = await agent.post('/api/mode').send({ mode: 'REAL' });
    expect(real.status).toBe(200);
    expect(real.body.mode).toBe('real');

    const demo = await agent.post('/api/mode').send({ mode: 'DEMO' });
    expect(demo.status).toBe(200);
    expect(demo.body.mode).toBe('demo');
  });
});
