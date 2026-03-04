import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';

const TEST_USERNAME = 'auth-persist-admin';
const TEST_PASSWORD = 'AuthPersist123!';

describe('auth lockout persistence', () => {
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;

  beforeAll(() => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;
  });

  afterAll(() => {
    process.env.SIDELINK_ADMIN_USERNAME = oldUsername;
    process.env.SIDELINK_ADMIN_PASSWORD = oldPassword;
  });

  test('retains lockout state across app restarts', async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-authlock-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-authlock-db-'));
    const dbPath = path.join(dbDir, 'auth-lockout.sqlite');

    let first: BuiltApp | undefined;
    let second: BuiltApp | undefined;

    try {
      first = buildApp({
        uploadDir,
        dbPath,
        schedulerTickIntervalMs: 100000,
        schedulerHoursPerTick: 6
      });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failed = await request(first.app).post('/api/auth/login').send({
          username: TEST_USERNAME,
          password: 'wrong-password'
        });

        expect([401, 429]).toContain(failed.status);
      }

      first.context.shutdown();
      first = undefined;

      second = buildApp({
        uploadDir,
        dbPath,
        schedulerTickIntervalMs: 100000,
        schedulerHoursPerTick: 6
      });

      const lockedAfterRestart = await request(second.app).post('/api/auth/login').send({
        username: TEST_USERNAME,
        password: TEST_PASSWORD
      });

      expect(lockedAfterRestart.status).toBe(429);
      expect(String(lockedAfterRestart.body.error?.code || '')).toContain('AUTH_LOCKED_OUT');
    } finally {
      first?.context.shutdown();
      second?.context.shutdown();
    }
  });
});
