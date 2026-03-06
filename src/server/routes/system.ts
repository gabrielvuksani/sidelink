// ─── System Routes ───────────────────────────────────────────────────
// GET  /api/system/dashboard — full dashboard state
// GET  /api/system/logs      — get logs
// DELETE /api/system/logs    — clear logs
// GET  /api/system/scheduler — scheduler snapshot
// POST /api/system/scheduler — update scheduler config
// POST /api/system/scheduler/refresh/:id — trigger manual refresh
// GET  /api/events           — SSE event stream

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import type { AppContext } from '../context';
import type { LogEntry } from '../../shared/types';
import { onPipelineJobLog, onPipelineUpdate } from '../pipeline';
import { validators } from '../utils/validators';
import { commandExists, runCommandStrict } from '../utils/command';
import { getHelperIpaPath } from '../utils/paths';
import { createPairingCode } from '../services/helper-pairing-service';
import { FREE_ACCOUNT_LIMITS } from '../../shared/constants';
import { triggerRefreshAllActiveApps } from '../services/shared-backend';

type TeamResolutionSource =
  | 'request'
  | 'env'
  | 'apple-account-authenticated'
  | 'apple-account-any'
  | 'xcode-signing-identity'
  | 'none';

type TeamResolution = {
  teamId: string | null;
  source: TeamResolutionSource;
};

const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

export function systemRoutes(ctx: AppContext): Router {
  const router = Router();

  const ensureHelperIpa = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const helperIpaPath = getHelperIpaPath();
      let built = false;
      const resolvedTeam = await resolveHelperTeamId(ctx, req.body?.teamId as string | undefined);
      let effectiveTeamId = resolvedTeam.teamId;

      if (!fs.existsSync(helperIpaPath)) {
        const fallbackTeamIds = await listFallbackTeamIds(ctx, resolvedTeam.teamId);
        effectiveTeamId = await buildHelperIpa(resolvedTeam.teamId ?? undefined, fallbackTeamIds);
        built = true;
      }

      if (!fs.existsSync(helperIpaPath)) {
        return res.status(500).json({
          ok: false,
          error: `Helper IPA was not found after build/export at: ${helperIpaPath}`,
        });
      }

      const imported = await importHelperIpaIntoLibrary(ctx, helperIpaPath);

      res.json({
        ok: true,
        data: {
          built,
          helperIpaPath,
          importedIpa: imported,
          teamId: effectiveTeamId,
          teamIdSource: resolvedTeam.source,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  // Full dashboard state (with limits to prevent huge payloads)
  router.get('/dashboard', (req, res) => {
    const accounts = ctx.appleAccounts.list().map(({ id, appleId, teamId, teamName, accountType, status, lastAuthAt, createdAt }) => ({
      id, appleId, teamId, teamName, accountType, status, lastAuthAt, createdAt,
    }));
    const devices = ctx.devices.list();
    const ipas = ctx.ipas.list();
    const jobs = ctx.db.listJobs();
    const installedApps = ctx.db.listInstalledApps();
    const scheduler = ctx.scheduler.getSnapshot();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weeklyAppIdUsage = Object.fromEntries(
      accounts
        .filter((account) => account.accountType !== 'paid')
        .map((account) => {
          const used = ctx.db.countAppIdsCreatedSince(account.id, account.teamId, since);
          return [account.id, {
            accountId: account.id,
            teamId: account.teamId,
            used,
            limit: FREE_ACCOUNT_LIMITS.maxNewAppIdsPerWeek,
            windowDays: 7,
          }];
        }),
    );

    res.json({
      ok: true,
      data: { accounts, devices, ipas, jobs, installedApps, scheduler, weeklyAppIdUsage },
    });
  });

  // Logs
  router.get('/logs', (req, res) => {
    const rawLimit = parseInt(req.query.limit as string) || 200;
    const limit = Math.min(Math.max(1, rawLimit), 1000); // cap at 1000
    const level = req.query.level as string | undefined;
    const validLevels = ['info', 'warn', 'error', 'debug'];
    let logs: LogEntry[];
    if (level && validLevels.includes(level)) {
      logs = ctx.db.listLogs(limit * 5)
        .filter(l => l.level === level)
        .slice(0, limit);
    } else {
      logs = ctx.db.listLogs(limit);
    }
    res.json({ ok: true, data: logs });
  });

  router.delete('/logs', (req, res) => {
    ctx.db.clearLogs();
    res.json({ ok: true });
  });

  // Scheduler
  router.get('/scheduler', (req, res) => {
    res.json({ ok: true, data: ctx.scheduler.getSnapshot() });
  });

  router.post('/scheduler', validators.schedulerUpdate, (req, res) => {
    const config = ctx.scheduler.updateConfig(req.body);
    res.json({ ok: true, data: config });
  });

  router.post('/scheduler/refresh/:id', async (req, res, next) => {
    try {
      await ctx.scheduler.triggerRefresh(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/scheduler/refresh-all', async (_req, res) => {
    res.json({ ok: true, data: await triggerRefreshAllActiveApps(ctx) });
  });

  router.get('/scheduler/states', (req, res) => {
    res.json({ ok: true, data: ctx.scheduler.getAutoRefreshStates() });
  });

  // Plan compatibility alias
  router.get('/auto-refresh-states', (req, res) => {
    res.json({ ok: true, data: ctx.scheduler.getAutoRefreshStates() });
  });

  router.get('/helper/doctor', async (req, res) => {
    const helperIpaPath = getHelperIpaPath();
    const helperProjectDir = process.env.SIDELINK_HELPER_PROJECT_DIR
      ? path.resolve(process.env.SIDELINK_HELPER_PROJECT_DIR)
      : path.join(process.cwd(), 'ios-helper', 'SidelinkHelper');
    const xcodeProjectPath = path.join(helperProjectDir, 'SidelinkHelper.xcodeproj');
    const projectYmlPath = path.join(helperProjectDir, 'project.yml');

    const hasXcodebuild = process.platform === 'darwin' ? await commandExists('xcodebuild') : false;
    const hasXcodegen = process.platform === 'darwin' ? await commandExists('xcodegen') : false;
    const resolvedTeam = await resolveHelperTeamId(ctx);

    res.json({
      ok: true,
      data: {
        platform: process.platform,
        helperIpaPath,
        helperIpaExists: fs.existsSync(helperIpaPath),
        helperProjectDir,
        xcodeProjectExists: fs.existsSync(xcodeProjectPath),
        projectYmlExists: fs.existsSync(projectYmlPath),
        hasXcodebuild,
        hasXcodegen,
        detectedTeamId: resolvedTeam.teamId,
        detectedTeamIdSource: resolvedTeam.source,
        helperPaired: !!ctx.db.getSetting('helper_token'),
      },
    });
  });

  router.post('/helper/pairing-code', (req, res) => {
    const pair = createPairingCode(ctx);
    res.json({
      ok: true,
      data: {
        ...pair,
        qrPayload: JSON.stringify({
          code: pair.code,
          backendUrl: resolveHelperBackendURL(req),
          serverName: process.env.SIDELINK_SERVER_NAME ?? 'Sidelink',
        }),
      },
    });
  });

  router.post('/helper/ensure', ensureHelperIpa);
  router.post('/helper/ensure-ipa', ensureHelperIpa);

  return router;
}

function resolveHelperBackendURL(req: Request): string {
  const envOverride = process.env.SIDELINK_HELPER_BACKEND_URL?.trim();
  if (envOverride) {
    return envOverride;
  }

  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
  const hostHeader = forwardedHost || req.get('host') || `localhost:${process.env.SIDELINK_PORT ?? '4010'}`;

  const [rawHost, rawPort] = splitHostPort(hostHeader);
  const port = rawPort || process.env.SIDELINK_PORT || '4010';
  const host = normalizeQrHost(rawHost);

  return `${protocol}://${host}:${port}`;
}

function splitHostPort(hostHeader: string): [string, string | null] {
  const trimmed = hostHeader.trim();
  if (trimmed.startsWith('[')) {
    const closing = trimmed.indexOf(']');
    if (closing >= 0) {
      const host = trimmed.slice(1, closing);
      const port = trimmed.slice(closing + 1).replace(/^:/, '') || null;
      return [host, port];
    }
  }

  const parts = trimmed.split(':');
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1] ?? '')) {
    return [parts.slice(0, -1).join(':'), parts[parts.length - 1] ?? null];
  }

  return [trimmed, null];
}

function normalizeQrHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed && trimmed !== 'localhost' && !trimmed.startsWith('127.') && trimmed !== '::1') {
    return host;
  }

  const candidates = Object.values(os.networkInterfaces())
    .flatMap(entries => entries ?? [])
    .filter(entry => !entry.internal)
    .map(entry => entry.address);

  const preferred = candidates.find(address => address.includes('.'))
    ?? candidates[0]
    ?? 'localhost';

  return preferred.includes(':') ? `[${preferred}]` : preferred;
}

async function importHelperIpaIntoLibrary(ctx: AppContext, helperIpaPath: string) {
  const targetPath = path.join(ctx.uploadDir, `helper-${Date.now()}.ipa`);
  await fsPromises.mkdir(ctx.uploadDir, { recursive: true });
  await fsPromises.copyFile(helperIpaPath, targetPath);
  return ctx.ipas.processUpload(targetPath, 'SidelinkHelper.ipa');
}

async function buildHelperIpa(teamId?: string, fallbackTeamIds: string[] = []): Promise<string | null> {
  if (process.platform !== 'darwin') {
    throw new Error('Helper IPA build requires macOS with Xcode. Use a prebuilt helper IPA on this platform.');
  }

  if (!(await commandExists('xcodebuild'))) {
    throw new Error('xcodebuild is not available. Install full Xcode and open it once to finish setup.');
  }

  const helperProjectDir = process.env.SIDELINK_HELPER_PROJECT_DIR
    ? path.resolve(process.env.SIDELINK_HELPER_PROJECT_DIR)
    : path.join(process.cwd(), 'ios-helper', 'SidelinkHelper');
  const projectFile = path.join(helperProjectDir, 'SidelinkHelper.xcodeproj');
  const projectYml = path.join(helperProjectDir, 'project.yml');
  const scheme = process.env.SIDELINK_HELPER_SCHEME ?? 'SidelinkHelper';

  const canUseXcodegen = fs.existsSync(projectYml) && (await commandExists('xcodegen'));
  if (canUseXcodegen) {
    await runCommandStrict('xcodegen', {
      args: ['generate'],
      cwd: helperProjectDir,
      timeoutMs: 60_000,
    });
  }

  if (!fs.existsSync(projectFile)) {
    throw new Error('Missing iOS helper project. Ensure ios-helper/SidelinkHelper exists and includes SidelinkHelper.xcodeproj or project.yml.');
  }

  const archivePath = path.join(process.cwd(), 'tmp', 'helper', 'SidelinkHelper.xcarchive');
  const exportDir = path.join(process.cwd(), 'tmp', 'helper', 'export');
  const exportOptionsPlist = process.env.SIDELINK_HELPER_EXPORT_OPTIONS_PLIST
    ? path.resolve(process.env.SIDELINK_HELPER_EXPORT_OPTIONS_PLIST)
    : path.join(helperProjectDir, 'ExportOptions.plist');

  if (!fs.existsSync(exportOptionsPlist)) {
    throw new Error(`Missing ExportOptions.plist at ${exportOptionsPlist}`);
  }

  await fsPromises.mkdir(path.join(process.cwd(), 'tmp', 'helper'), { recursive: true });
  await fsPromises.rm(exportDir, { recursive: true, force: true });
  await fsPromises.mkdir(exportDir, { recursive: true });

  const candidates = dedupeTeamIds([
    normalizeTeamId(teamId),
    ...fallbackTeamIds.map((value) => normalizeTeamId(value)),
  ]);
  const candidateList: Array<string | undefined> = candidates.length > 0
    ? candidates
    : [undefined];

  let lastError: Error | null = null;
  let selectedTeamId: string | null = null;

  for (let i = 0; i < candidateList.length; i += 1) {
    const candidate = candidateList[i];
    const env = buildCommandEnv(candidate ? { SIDELINK_TEAM_ID: String(candidate) } : undefined);

    try {
      await runCommandStrict('xcodebuild', {
        args: [
          '-project', projectFile,
          '-scheme', scheme,
          '-configuration', 'Release',
          '-destination', 'generic/platform=iOS',
          '-archivePath', archivePath,
          '-allowProvisioningUpdates',
          'archive',
        ],
        env,
        timeoutMs: 10 * 60_000,
      });

      await runCommandStrict('xcodebuild', {
        args: [
          '-exportArchive',
          '-archivePath', archivePath,
          '-exportPath', exportDir,
          '-exportOptionsPlist', exportOptionsPlist,
          '-allowProvisioningUpdates',
        ],
        env,
        timeoutMs: 10 * 60_000,
      });

      selectedTeamId = candidate ?? null;
      lastError = null;
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(message);
      const hasNext = i < candidateList.length - 1;
      if (!hasNext || !isTeamResolutionBuildError(message)) {
        throw lastError;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  const helperIpaPath = getHelperIpaPath();
  const exportEntries = await fsPromises.readdir(exportDir);
  const ipaName = exportEntries.find((entry) => entry.toLowerCase().endsWith('.ipa'));
  if (!ipaName) {
    throw new Error('xcodebuild export finished but no IPA was produced.');
  }

  const sourceIpaPath = path.join(exportDir, ipaName);
  await fsPromises.mkdir(path.dirname(helperIpaPath), { recursive: true });
  await fsPromises.copyFile(sourceIpaPath, helperIpaPath);

  return selectedTeamId;
}

function normalizeTeamId(value: string | undefined | null): string | null {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase();
  return TEAM_ID_PATTERN.test(cleaned) ? cleaned : null;
}

async function resolveHelperTeamId(ctx: AppContext, requestedTeamId?: string): Promise<TeamResolution> {
  const fromRequest = normalizeTeamId(requestedTeamId);
  if (fromRequest) {
    return { teamId: fromRequest, source: 'request' };
  }

  const fromEnv = normalizeTeamId(process.env.SIDELINK_TEAM_ID);
  if (fromEnv) {
    return { teamId: fromEnv, source: 'env' };
  }

  const accounts = ctx.appleAccounts.list();
  const fromAuthenticatedAccount = accounts
    .filter((account) => account.status === 'active')
    .map((account) => normalizeTeamId(account.teamId))
    .find((teamId): teamId is string => !!teamId);
  if (fromAuthenticatedAccount) {
    return { teamId: fromAuthenticatedAccount, source: 'apple-account-authenticated' };
  }

  const fromAnyAccount = accounts
    .map((account) => normalizeTeamId(account.teamId))
    .find((teamId): teamId is string => !!teamId);
  if (fromAnyAccount) {
    return { teamId: fromAnyAccount, source: 'apple-account-any' };
  }

  const fromSigningIdentity = await detectTeamIdFromSigningIdentity();
  if (fromSigningIdentity) {
    return { teamId: fromSigningIdentity, source: 'xcode-signing-identity' };
  }

  return { teamId: null, source: 'none' };
}

async function detectTeamIdFromSigningIdentity(): Promise<string | null> {
  const teamIds = await detectTeamIdsFromSigningIdentity();
  return teamIds[0] ?? null;
}

async function detectTeamIdsFromSigningIdentity(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  if (!(await commandExists('security'))) return [];

  try {
    const result = await runCommandStrict('security', {
      args: ['find-identity', '-v', '-p', 'codesigning'],
      timeoutMs: 20_000,
    });
    const lines = `${result.stdout}\n${result.stderr}`.split('\n');
    const foundWithDuplicates: string[] = [];
    for (const line of lines) {
      // Example: "1) <hash> \"Apple Development: Name (AB12CD34EF)\""
      const match = line.match(/Apple Development:[^\(]*\(([A-Z0-9]{10})\)/i);
      if (match?.[1]) {
        const normalized = normalizeTeamId(match[1]);
        if (normalized) foundWithDuplicates.push(normalized);
      }
    }
    return sortTeamIdsByFrequency(foundWithDuplicates);
  } catch {
    return [];
  }

  return [];
}

async function listFallbackTeamIds(ctx: AppContext, preferredTeamId: string | null): Promise<string[]> {
  const allCandidates = dedupeTeamIds([
    ...ctx.appleAccounts.list()
      .filter((account) => account.status === 'active')
      .map((account) => normalizeTeamId(account.teamId)),
    ...ctx.appleAccounts.list().map((account) => normalizeTeamId(account.teamId)),
    ...(await detectTeamIdsFromSigningIdentity()).map((value) => normalizeTeamId(value)),
  ]);
  const preferred = normalizeTeamId(preferredTeamId);
  return allCandidates.filter((candidate) => candidate !== preferred);
}

function dedupeTeamIds(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sortTeamIdsByFrequency(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([teamId]) => teamId);
}

function isTeamResolutionBuildError(message: string): boolean {
  return /(No Account for Team|No profiles for|requires a development team|provisioning profile)/i.test(message);
}

function buildCommandEnv(overrides?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') base[key] = value;
  }
  if (overrides) {
    Object.assign(base, overrides);
  }
  return base;
}

// ─── SSE Event Stream ────────────────────────────────────────────────

const activeSSEResponses = new Set<import('express').Response>();

/** Gracefully close all SSE connections (call on server shutdown). */
export function closeAllSSE(): void {
  for (const res of activeSSEResponses) {
    try { res.write('event: close\ndata: "server-shutdown"\n\n'); } catch (err) {
      console.warn('[sse] Error sending close event:', err);
    }
    try { res.end(); } catch (err) {
      console.warn('[sse] Error ending response:', err);
    }
  }
  activeSSEResponses.clear();
}

export function sseRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    activeSSEResponses.add(res);

    // Send initial state
    const send = (type: string, data: unknown) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Pipeline updates
    const unsubPipeline = onPipelineUpdate(job => {
      send('job-update', job);
    });

    const unsubPipelineLogs = onPipelineJobLog(entry => {
      send('job-log', entry);
    });

    // Device updates
    const unsubDevices = ctx.devices.onChange(devices => {
      send('device-update', devices);
    });

    // Log updates (real-time streaming)
    const unsubLogs = ctx.logs.onLog(entry => {
      send('log', entry);
    });

    // Keep-alive
    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 30_000);

    // Cleanup on disconnect
    req.on('close', () => {
      unsubPipeline();
      unsubPipelineLogs();
      unsubDevices();
      unsubLogs();
      clearInterval(keepalive);
      activeSSEResponses.delete(res);
    });
  });

  return router;
}
