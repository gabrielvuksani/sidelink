import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { buildApp } from '../src/server/app';

const TEST_USERNAME = 'mode-persist-admin';
const TEST_PASSWORD = 'ModePersistPass123!';

describe('runtime mode persistence', () => {
  test('persists explicit mode choices across restarts even when startup default changes', async () => {
    const prevUser = process.env.SIDELINK_ADMIN_USERNAME;
    const prevPass = process.env.SIDELINK_ADMIN_PASSWORD;

    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-mode-persist-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-mode-persist-db-'));
    const dbPath = path.join(dbDir, 'mode.sqlite');

    const first = buildApp({
      uploadDir,
      dbPath,
      defaultMode: 'demo',
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    const agent1 = request.agent(first.app);
    const login1 = await agent1.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });
    expect(login1.status).toBe(200);

    const modeSetToReal = await agent1.post('/api/mode').send({ mode: 'real' });
    expect(modeSetToReal.status).toBe(200);
    expect(modeSetToReal.body.mode).toBe('real');

    first.context.shutdown();

    const second = buildApp({
      uploadDir,
      dbPath,
      defaultMode: 'demo',
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    const agent2 = request.agent(second.app);
    const login2 = await agent2.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });
    expect(login2.status).toBe(200);

    const persistedRealMode = await agent2.get('/api/mode');
    expect(persistedRealMode.status).toBe(200);
    expect(persistedRealMode.body.mode).toBe('real');

    const modeSetToDemo = await agent2.post('/api/mode').send({ mode: 'demo' });
    expect(modeSetToDemo.status).toBe(200);
    expect(modeSetToDemo.body.mode).toBe('demo');

    second.context.shutdown();

    const third = buildApp({
      uploadDir,
      dbPath,
      defaultMode: 'real',
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    const agent3 = request.agent(third.app);
    const login3 = await agent3.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });
    expect(login3.status).toBe(200);

    const persistedDemoMode = await agent3.get('/api/mode');
    expect(persistedDemoMode.status).toBe(200);
    expect(persistedDemoMode.body.mode).toBe('demo');

    third.context.shutdown();

    process.env.SIDELINK_ADMIN_USERNAME = prevUser;
    process.env.SIDELINK_ADMIN_PASSWORD = prevPass;
  });
});
