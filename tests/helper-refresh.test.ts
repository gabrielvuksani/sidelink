import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';
import { createSampleIpa } from './helpers';

const TEST_USERNAME = 'helper-refresh-admin';
const TEST_PASSWORD = 'HelperRefresh123!';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('helper refresh endpoint', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;
  let helperInstallId = '';
  let primaryInstallId = '';
  let helperToken = '';

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helper-refresh-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helper-refresh-db-'));

    built = buildApp({
      uploadDir,
      dbPath: path.join(dbDir, 'helper-refresh.sqlite'),
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });

    helperToken = built.context.helperService.getToken();
    agent = request.agent(built.app);

    const login = await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });

    expect(login.status).toBe(200);

    const ipaPath = await createSampleIpa();
    const upload = await agent.post('/api/ipa/upload').attach('ipa', ipaPath);
    expect(upload.status).toBe(201);

    const ipas = await agent.get('/api/ipa');
    const devices = await agent.get('/api/devices?mode=demo&refresh=1');

    const install = await agent.post('/api/install').send({
      ipaId: ipas.body.items[0].id,
      deviceId: devices.body.devices[0].id,
      mode: 'demo'
    });

    expect(install.status).toBe(202);

    let complete = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const jobs = await agent.get('/api/jobs');
      const job = jobs.body.items[0];

      if (job?.status === 'success') {
        complete = true;
        break;
      }

      if (job?.status === 'error') {
        throw new Error(`Pipeline failed during setup: ${job.error}`);
      }

      await wait(120);
    }

    expect(complete).toBe(true);

    const dashboard = await agent.get('/api/dashboard');
    const installs = dashboard.body.installs as Array<{ id: string; kind: string }>;

    const helper = installs.find((installEntry) => installEntry.kind === 'helper');
    const primary = installs.find((installEntry) => installEntry.kind === 'primary');

    if (!helper || !primary) {
      throw new Error('Expected helper + primary installs to exist for helper refresh tests.');
    }

    helperInstallId = helper.id;
    primaryInstallId = primary.id;
  });

  afterAll(() => {
    built.context.shutdown();
    process.env.SIDELINK_ADMIN_USERNAME = oldUsername;
    process.env.SIDELINK_ADMIN_PASSWORD = oldPassword;
  });

  test('defaults to refreshing primary install when installId is omitted', async () => {
    const response = await agent.post('/api/helper/refresh').send({});
    expect(response.status).toBe(200);
    expect(response.body.install?.kind).toBe('primary');
    expect(response.body.install?.id).toBe(primaryInstallId);
  });

  test('helper token refresh requires explicit scope payload', async () => {
    const response = await request(built.app)
      .post('/api/helper/refresh')
      .set('x-sidelink-helper-token', helperToken)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('HELPER_REFRESH_SCOPE_REQUIRED');
  });

  test('helper token accepts trimmed query token fallback', async () => {
    const response = await request(built.app)
      .post('/api/helper/refresh')
      .query({ token: ` ${helperToken} ` })
      .send({ installId: primaryInstallId });

    expect(response.status).toBe(200);
    expect(response.body.install?.id).toBe(primaryInstallId);
  });

  test('helper refresh rejects conflicting installId/deviceId scope selectors', async () => {
    const response = await request(built.app)
      .post('/api/helper/refresh')
      .set('x-sidelink-helper-token', helperToken)
      .send({
        installId: primaryInstallId,
        deviceId: 'device_scope_conflict'
      });

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('HELPER_REFRESH_SCOPE_CONFLICT');
  });

  test('helper token can refresh a scoped install by installId', async () => {
    const response = await request(built.app)
      .post('/api/helper/refresh')
      .set('x-sidelink-helper-token', helperToken)
      .send({ installId: helperInstallId });

    expect(response.status).toBe(200);
    expect(response.body.install?.kind).toBe('helper');
    expect(response.body.install?.id).toBe(helperInstallId);
  });

  test('can explicitly refresh helper install by installId', async () => {
    const response = await agent.post('/api/helper/refresh').send({ installId: helperInstallId });
    expect(response.status).toBe(200);
    expect(response.body.install?.kind).toBe('helper');
    expect(response.body.install?.id).toBe(helperInstallId);
  });

  test('rotating helper token invalidates previous token', async () => {
    const previousToken = helperToken;

    const rotate = await agent.post('/api/settings/helper-token/rotate').send({});
    expect(rotate.status).toBe(200);
    expect(typeof rotate.body.token).toBe('string');

    helperToken = rotate.body.token;

    const stale = await request(built.app)
      .post('/api/helper/refresh')
      .set('x-sidelink-helper-token', previousToken)
      .send({ installId: primaryInstallId });

    expect(stale.status).toBe(401);

    const fresh = await request(built.app)
      .post('/api/helper/refresh')
      .set('x-sidelink-helper-token', helperToken)
      .send({ installId: primaryInstallId });

    expect(fresh.status).toBe(200);
    expect(fresh.body.install?.id).toBe(primaryInstallId);
  });

  test('helper status exposes refresh diagnostics and suggested target', async () => {
    const status = await agent.get('/api/helper/status?mode=demo');
    expect(status.status).toBe(200);

    expect(typeof status.body.diagnostics?.helperInstalls).toBe('number');
    expect(typeof status.body.diagnostics?.primaryInstalls).toBe('number');
    expect(status.body.diagnostics?.selectionPolicy).toContain('Earliest-expiring primary');

    expect(status.body.diagnostics?.suggestedRefreshTarget).toBeDefined();
    expect(status.body.diagnostics?.suggestedRefreshTarget?.id).toBe(primaryInstallId);
    expect(status.body.diagnostics?.suggestedRefreshTarget?.kind).toBe('primary');
  });
});
