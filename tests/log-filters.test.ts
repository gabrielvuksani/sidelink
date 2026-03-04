import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, BuiltApp } from '../src/server/app';
import { LogEntry } from '../src/server/types';

const TEST_USERNAME = 'logs-admin';
const TEST_PASSWORD = 'LogsPass123!';

describe('operational logs filtering', () => {
  let built: BuiltApp;
  let agent: ReturnType<typeof request.agent>;
  let oldUsername: string | undefined;
  let oldPassword: string | undefined;
  let markerCounter = 0;

  const seedLogs = (marker: string): LogEntry[] => {
    markerCounter += 1;
    const baseMs = new Date('2026-03-01T00:00:00.000Z').getTime() + markerCounter * 10 * 60 * 1000;

    const entries: LogEntry[] = [
      {
        id: `log_${marker}_1`,
        at: new Date(baseMs).toISOString(),
        level: 'info',
        code: `TEST_${marker}_INFO_AUTH`,
        message: `Marker ${marker}: auth success`,
        action: 'none'
      },
      {
        id: `log_${marker}_2`,
        at: new Date(baseMs + 60_000).toISOString(),
        level: 'warn',
        code: `TEST_${marker}_WARN_WIFI`,
        message: `Marker ${marker}: waiting for Wi-Fi`,
        action: 'wait for transport'
      },
      {
        id: `log_${marker}_3`,
        at: new Date(baseMs + 120_000).toISOString(),
        level: 'error',
        code: `TEST_${marker}_ERROR_WIFI`,
        message: `Marker ${marker}: Wi-Fi refresh failed`,
        action: 'retry refresh',
        context: {
          marker,
          component: 'scheduler'
        }
      }
    ];

    for (const entry of entries) {
      built.context.store.appendLog(entry, 1200);
    }

    return entries;
  };

  beforeAll(async () => {
    oldUsername = process.env.SIDELINK_ADMIN_USERNAME;
    oldPassword = process.env.SIDELINK_ADMIN_PASSWORD;
    process.env.SIDELINK_ADMIN_USERNAME = TEST_USERNAME;
    process.env.SIDELINK_ADMIN_PASSWORD = TEST_PASSWORD;

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-logs-upload-'));
    const dbDir = await mkdtemp(path.join(os.tmpdir(), 'sidelink-logs-db-'));

    built = buildApp({
      uploadDir,
      dbPath: path.join(dbDir, 'logs.sqlite'),
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

  test('filters /api/logs by level + search + code with meta payload', async () => {
    const marker = `m${Date.now()}`;
    seedLogs(marker);

    const response = await agent.get(
      `/api/logs?limit=10&level=warn,error&code=${encodeURIComponent(marker)}&search=${encodeURIComponent('wifi')}`
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.items.length).toBeGreaterThanOrEqual(2);
    expect(response.body.items.every((item: LogEntry) => ['warn', 'error'].includes(item.level))).toBe(true);
    expect(response.body.items.every((item: LogEntry) => item.code.toLowerCase().includes(marker.toLowerCase()))).toBe(true);
    expect(response.body.items.every((item: LogEntry) => JSON.stringify(item).toLowerCase().includes('wifi'))).toBe(true);

    expect(response.body.meta?.requestedLimit).toBe(10);
    expect(response.body.meta?.returned).toBe(response.body.items.length);
    expect(response.body.meta?.matched).toBeGreaterThanOrEqual(response.body.items.length);
    expect(response.body.meta?.filters?.level).toBe('warn,error');
    expect(response.body.meta?.filters?.search).toBe('wifi');
  });

  test('applies before/after window filters for /api/logs', async () => {
    const marker = `r${Date.now()}`;
    const entries = seedLogs(marker);

    const after = entries[1].at;
    const before = entries[2].at;

    const response = await agent.get(
      `/api/logs?limit=10&code=${encodeURIComponent(marker)}&after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}`
    );

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBe(2);
    expect(response.body.items[0].code).toContain(`TEST_${marker}_ERROR_WIFI`);
    expect(response.body.items[1].code).toContain(`TEST_${marker}_WARN_WIFI`);
    expect(response.body.meta?.filters?.after).toBe(after);
    expect(response.body.meta?.filters?.before).toBe(before);
  });

  test('rejects invalid log level filters', async () => {
    const response = await agent.get('/api/logs?level=warn,critical');

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('LOG_FILTER_LEVEL_INVALID');
  });

  test('passes log filters through support snapshot endpoint', async () => {
    const marker = `s${Date.now()}`;
    seedLogs(marker);

    const response = await agent.get(
      `/api/support/snapshot?includeLogs=1&logLimit=1&includeCommands=0&logLevel=error&logSearch=${encodeURIComponent(marker)}`
    );

    expect(response.status).toBe(200);
    expect(response.body.logs.length).toBe(1);
    expect(response.body.logs[0].level).toBe('error');
    expect(response.body.logs[0].code.toLowerCase()).toContain(marker.toLowerCase());

    expect(response.body.logsMeta?.includeLogs).toBe(true);
    expect(response.body.logsMeta?.requestedLimit).toBe(1);
    expect(response.body.logsMeta?.matched).toBeGreaterThanOrEqual(1);
    expect(response.body.logsMeta?.filters?.level).toBe('error');
    expect(response.body.logsMeta?.filters?.search).toBe(marker);
  });
});
