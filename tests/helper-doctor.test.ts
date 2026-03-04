import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';

const TEST_USERNAME = 'helper-doctor-admin';
const TEST_PASSWORD = 'HelperDoctor123!';

describe('helper doctor endpoint', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helperdoctor-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helperdoctor-db-'));
    const helperDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-helperdoctor-project-'));

    await writeFile(path.join(helperDir, 'project.yml'), 'name: SidelinkHelper\n');

    built = buildApp({
      uploadDir,
      dbPath: path.join(dbDir, 'helperdoctor.sqlite'),
      helperProjectDir: helperDir,
      helperIpaPath: path.join(helperDir, 'SidelinkHelper.ipa'),
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

  test('requires authentication', async () => {
    const unauth = await request(built.app).get('/api/helper/doctor');
    expect(unauth.status).toBe(401);
  });

  test('returns actionable helper readiness report', async () => {
    const login = await agent.post('/api/auth/login').send({
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });

    expect(login.status).toBe(200);

    const report = await agent.get('/api/helper/doctor');
    expect(report.status).toBe(200);

    expect(typeof report.body.checkedAt).toBe('string');
    expect(typeof report.body.readyForBuild).toBe('boolean');
    expect(typeof report.body.readyForExport).toBe('boolean');
    expect(typeof report.body.artifactReady).toBe('boolean');

    expect(report.body.checks?.helperProjectDir?.ok).toBe(true);
    expect(typeof report.body.checks?.helperIpa?.ok).toBe('boolean');
    expect(typeof report.body.checks?.buildScript?.ok).toBe('boolean');
    expect(typeof report.body.checks?.exportScript?.ok).toBe('boolean');
    expect(typeof report.body.checks?.helperArtifactDir?.ok).toBe('boolean');

    expect(Array.isArray(report.body.recommendedActions)).toBe(true);
    expect(report.body.commands?.build).toBe('bash scripts/helper-build.sh');
    expect(report.body.commands?.export).toBe('bash scripts/helper-export.sh');
  });
});
