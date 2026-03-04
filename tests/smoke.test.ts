import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';
import { createSampleIpa } from './helpers';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const TEST_USERNAME = 'smoke-admin';
const TEST_PASSWORD = 'SmokePass123!';

describe('API smoke', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-smoke-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-smoke-db-'));
    const dbPath = path.join(dbDir, 'smoke.sqlite');

    built = buildApp({
      uploadDir,
      dbPath,
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    agent = request.agent(built.app);

    const login = await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });

    expect(login.status).toBe(200);
    expect(login.body.authenticated).toBe(true);
  });

  afterAll(() => {
    built.context.shutdown();

    process.env.SIDELINK_ADMIN_USERNAME = oldUsername;
    process.env.SIDELINK_ADMIN_PASSWORD = oldPassword;
  });

  test('walks through import + install + dashboard flow', async () => {
    const health = await request(built.app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const ipaPath = await createSampleIpa();
    const upload = await agent.post('/api/ipa/upload').attach('ipa', ipaPath);
    expect(upload.status).toBe(201);

    const ipas = await agent.get('/api/ipa');
    expect(ipas.status).toBe(200);
    expect(ipas.body.items.length).toBe(1);

    const devices = await agent.get('/api/devices?mode=demo&refresh=1');
    expect(devices.status).toBe(200);
    expect(devices.body.devices.length).toBeGreaterThan(0);

    const install = await agent
      .post('/api/install')
      .send({ ipaId: ipas.body.items[0].id, deviceId: devices.body.devices[0].id, mode: 'demo' });

    expect(install.status).toBe(202);

    let done = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const jobs = await agent.get('/api/jobs');
      const job = jobs.body.items[0];
      if (job?.status === 'success') {
        done = true;
        break;
      }

      if (job?.status === 'error') {
        throw new Error(`Pipeline job failed in smoke test: ${job.error}`);
      }

      await wait(120);
    }

    expect(done).toBe(true);

    const dashboard = await agent.get('/api/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.installs.length).toBeGreaterThanOrEqual(2);
    expect(dashboard.body.installs.some((install: any) => install.kind === 'helper')).toBe(true);
    expect(dashboard.body.installs.some((install: any) => install.kind === 'primary')).toBe(true);
  });
});
