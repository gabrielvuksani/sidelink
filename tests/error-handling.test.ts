import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';
import { createSampleIpa } from './helpers';

const TEST_USERNAME = 'errors-admin';
const TEST_PASSWORD = 'ErrorsPass123!';

describe('API error mapping', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-errors-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-errors-db-'));

    built = buildApp({
      uploadDir,
      dbPath: path.join(dbDir, 'errors.sqlite'),
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

  test('returns actionable 400 for malformed JSON payloads', async () => {
    const response = await request(built.app)
      .post('/api/mode')
      .set('Content-Type', 'application/json')
      .send('{"mode":"demo"');

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('REQUEST_BODY_INVALID');
    expect(response.body.error?.action).toContain('Fix JSON syntax');
  });

  test('returns actionable 400 for unexpected upload field names', async () => {
    const ipaPath = await createSampleIpa();

    const response = await agent.post('/api/ipa/upload').attach('file', ipaPath);

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('IPA_UPLOAD_FIELD_INVALID');
    expect(response.body.error?.action).toContain('field name `ipa`');
  });
});
