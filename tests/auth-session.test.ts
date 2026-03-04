import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';

const TEST_USERNAME = 'auth-admin';
const TEST_PASSWORD = 'AuthPass123!';

describe('auth/session flow', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-auth-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-auth-db-'));

    built = buildApp({
      uploadDir,
      dbPath: path.join(dbDir, 'auth.sqlite'),
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    agent = request.agent(built.app);
  });

  afterAll(() => {
    built.context.shutdown();

    process.env.SIDELINK_ADMIN_USERNAME = oldUsername;
    process.env.SIDELINK_ADMIN_PASSWORD = oldPassword;
  });

  test('enforces auth for protected routes and supports login/logout', async () => {
    const unauthenticatedMutation = await agent.post('/api/mode').send({ mode: 'real' });
    expect(unauthenticatedMutation.status).toBe(401);

    const unauthenticatedJobs = await agent.get('/api/jobs');
    expect(unauthenticatedJobs.status).toBe(401);

    const unauthenticatedLogs = await agent.get('/api/logs');
    expect(unauthenticatedLogs.status).toBe(401);

    const login = await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });

    expect(login.status).toBe(200);
    expect(login.body.authenticated).toBe(true);
    expect(login.body.user.username).toBe(TEST_USERNAME);

    const session = await agent.get('/api/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.authenticated).toBe(true);

    const modeMutation = await agent.post('/api/mode').send({ mode: 'real' });
    expect(modeMutation.status).toBe(200);
    expect(modeMutation.body.mode).toBe('real');

    const jobsAfterLogin = await agent.get('/api/jobs');
    expect(jobsAfterLogin.status).toBe(200);

    const logout = await agent.post('/api/auth/logout').send({});
    expect(logout.status).toBe(200);

    const deniedAfterLogout = await agent.post('/api/mode').send({ mode: 'demo' });
    expect(deniedAfterLogout.status).toBe(401);

    const dashboardAfterLogout = await agent.get('/api/dashboard');
    expect(dashboardAfterLogout.status).toBe(401);
  });

  test('locks out repeated failed login attempts', async () => {
    const lockoutAgent = request.agent(built.app);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await lockoutAgent.post('/api/auth/login').send({
        username: TEST_USERNAME,
        password: 'wrong-password'
      });

      expect([401, 429]).toContain(failed.status);
    }

    const locked = await lockoutAgent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });

    expect(locked.status).toBe(429);
    expect(String(locked.body.error?.code || '')).toContain('AUTH_LOCKED_OUT');
  });
});
