import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';

describe('security headers', () => {
  let built: BuiltApp;

  beforeAll(async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-security-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-security-db-'));
    const dbPath = path.join(dbDir, 'security.sqlite');

    built = buildApp({
      uploadDir,
      dbPath,
      schedulerTickIntervalMs: 100000,
      schedulerHoursPerTick: 6
    });
  });

  afterAll(() => {
    built.context.shutdown();
  });

  test('serves hardened headers on the web shell', async () => {
    const response = await request(built.app).get('/');

    expect(response.status).toBe(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('camera=()');
  });

  test('applies no-store policy to API responses', async () => {
    const response = await request(built.app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
  });
});
