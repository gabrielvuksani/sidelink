import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { buildApp } from '../src/server/app';
import { createSampleIpa } from './helpers';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('sqlite persistence lifecycle', () => {
  test('persists IPA/jobs/installs/scheduler across app restart', async () => {
    const previousUser = process.env.SIDELINK_ADMIN_USERNAME;
    const previousPass = process.env.SIDELINK_ADMIN_PASSWORD;

    process.env.SIDELINK_ADMIN_USERNAME = 'persist-admin';
    process.env.SIDELINK_ADMIN_PASSWORD = 'PersistPass123!';

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-persist-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-persist-db-'));
    const dbPath = path.join(dbDir, 'persist.sqlite');

    const first = buildApp({
      uploadDir,
      dbPath,
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    const agent1 = request.agent(first.app);

    const login = await agent1.post('/api/auth/login').send({
      username: process.env.SIDELINK_ADMIN_USERNAME,
      password: process.env.SIDELINK_ADMIN_PASSWORD
    });
    expect(login.status).toBe(200);

    const ipaPath = await createSampleIpa();
    const upload = await agent1.post('/api/ipa/upload').attach('ipa', ipaPath);
    expect(upload.status).toBe(201);

    const ipas = await agent1.get('/api/ipa');
    const devices = await agent1.get('/api/devices?mode=demo&refresh=1');

    const install = await agent1
      .post('/api/install')
      .send({ ipaId: ipas.body.items[0].id, deviceId: devices.body.devices[0].id, mode: 'demo' });

    expect(install.status).toBe(202);

    let jobDone = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const jobs = await agent1.get('/api/jobs');
      const job = jobs.body.items[0];
      if (job?.status === 'success') {
        jobDone = true;
        break;
      }

      await wait(120);
    }

    expect(jobDone).toBe(true);

    const advanced = await agent1.post('/api/scheduler/advance-hours').send({ hours: 24 });
    expect(advanced.status).toBe(200);
    const persistedSimulatedNow = advanced.body.simulatedNow;

    first.context.shutdown();

    const second = buildApp({
      uploadDir,
      dbPath,
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    const agent2 = request.agent(second.app);
    const login2 = await agent2.post('/api/auth/login').send({
      username: process.env.SIDELINK_ADMIN_USERNAME,
      password: process.env.SIDELINK_ADMIN_PASSWORD
    });
    expect(login2.status).toBe(200);

    const persistedIpas = await agent2.get('/api/ipa');
    expect(persistedIpas.body.items.length).toBe(1);

    const persistedJobs = await agent2.get('/api/jobs');
    expect(persistedJobs.body.items.length).toBe(1);
    expect(persistedJobs.body.items[0].status).toBe('success');

    const persistedDashboard = await agent2.get('/api/dashboard');
    expect(persistedDashboard.body.installs.length).toBeGreaterThanOrEqual(2);
    expect(persistedDashboard.body.installs.some((install: any) => install.kind === 'helper')).toBe(true);
    expect(persistedDashboard.body.installs.every((install: any) => install.autoRefresh?.nextAttemptAt)).toBe(true);
    expect(persistedDashboard.body.installs.every((install: any) => install.autoRefresh?.nextAttemptReason)).toBe(true);
    expect(persistedDashboard.body.installs.every((install: any) => install.autoRefresh?.lastDecisionCode)).toBe(true);

    const persistedScheduler = await agent2.get('/api/scheduler');
    expect(persistedScheduler.body.simulatedNow).toBe(persistedSimulatedNow);

    second.context.shutdown();

    process.env.SIDELINK_ADMIN_USERNAME = previousUser;
    process.env.SIDELINK_ADMIN_PASSWORD = previousPass;
  }, 15000);
});
