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
import fs from 'node:fs';
import type { AppContext } from '../context';
import { onPipelineJobLog, onPipelineUpdate } from '../pipeline';
import { validators } from '../utils/validators';
import { getHelperIpaPath } from '../utils/paths';
import { createPairingCode, getHelperPairingState } from '../services/helper-pairing-service';
import { FREE_ACCOUNT_LIMITS } from '../../shared/constants';
import { onInstalledAppsChanged } from '../services/installed-app-events';
import { listSafeAppleAccounts, triggerRefreshAllActiveApps } from '../services/shared-backend';
import { resolveHelperBackendContext } from '../utils/network';
import {
  buildHelperIpa,
  importHelperIpaIntoLibrary,
  resolveHelperTeamId,
  listFallbackTeamIds,
  buildHelperDoctorSnapshot,
} from '../services/helper-build-service';

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
    const logs = ctx.db.listLogs(limit, level);
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

  // Webhook settings
  router.get('/webhook', (_req, res) => {
    const url = ctx.db.getSetting('webhook_url') ?? '';
    res.json({ ok: true, data: { url } });
  });

  router.put('/webhook', (req, res) => {
    const { url } = req.body ?? {};
    if (url === undefined || url === null) {
      return res.json({ ok: true });
    }
    const trimmed = String(url).trim();
    if (trimmed === '') {
      ctx.db.setSetting('webhook_url', '');
      return res.json({ ok: true });
    }

    // SSRF guard: validate URL parse, require http/https, and refuse
    // any non-public-internet host. Without this check an authenticated
    // user could configure http://169.254.169.254/... (AWS IMDS) or
    // http://127.0.0.1:4010/... (self) and the scheduler would then
    // issue server-side authenticated POSTs to those targets.
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return res.status(400).json({ ok: false, error: 'Webhook URL is not a valid URL' });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return res.status(400).json({ ok: false, error: 'Webhook URL must use http or https' });
    }
    if (parsed.username || parsed.password) {
      return res.status(400).json({ ok: false, error: 'Webhook URL must not embed credentials' });
    }
    // isLocalNetworkHost is defined in utils/network; imported lazily
    // to avoid a circular-import risk when the route file is loaded at
    // startup. Covers loopback, RFC1918, 169.254/16 link-local, and .local.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isLocalNetworkHost } = require('../utils/network') as typeof import('../utils/network');
    if (isLocalNetworkHost(parsed.hostname)) {
      return res.status(400).json({ ok: false, error: 'Webhook URL must point at a public host, not a local/private address' });
    }
    ctx.db.setSetting('webhook_url', parsed.href);
    res.json({ ok: true });
  });

  router.get('/helper/doctor', async (req, res) => {
    res.json({ ok: true, data: await buildHelperDoctorSnapshot(ctx) });
  });

  router.post('/helper/pairing-code', (req, res) => {
    const pair = createPairingCode(ctx);
    const serverName = process.env.SIDELINK_SERVER_NAME ?? 'SideLink';
    const serverVersion = process.env.SIDELINK_APP_VERSION ?? process.env.npm_package_version ?? '1.0.0';
    const envOverride = process.env.SIDELINK_HELPER_BACKEND_URL?.trim();
    const backend = envOverride
      ? {
          backendUrl: envOverride,
          apiBasePath: (() => {
            try {
              const url = new URL(envOverride);
              const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
              return pathname || '';
            } catch {
              return '';
            }
          })(),
          candidateAddresses: [] as string[],
        }
      : resolveHelperBackendContext(req, '/api/system/helper/pairing-code');
    res.json({
      ok: true,
      data: {
        ...pair,
        backendUrl: backend.backendUrl,
        apiBasePath: backend.apiBasePath || null,
        candidateAddresses: backend.candidateAddresses,
        serverName,
        serverVersion,
        qrPayload: JSON.stringify({
          code: pair.code,
          backendUrl: backend.backendUrl,
          apiBasePath: backend.apiBasePath || null,
          serverName,
          serverVersion,
        }),
      },
    });
  });

  router.post('/helper/ensure', ensureHelperIpa);
  router.post('/helper/ensure-ipa', ensureHelperIpa);

  // ── Export / Import config ───────────────────────────────────────────
  router.get('/export-config', (_req, res) => {
    const sources = ctx.sources.list();
    const scheduler = ctx.scheduler.getSnapshot();
    const installedApps = ctx.db.listInstalledApps();
    const selfHosted = ctx.sources.getSelfHostedManifest();

    res.json({
      ok: true,
      data: {
        version: 1,
        exportedAt: new Date().toISOString(),
        sources: sources.map(s => ({ name: s.name, url: s.url, enabled: s.enabled })),
        selfHostedSource: selfHosted,
        schedulerConfig: {
          enabled: scheduler.enabled,
          checkIntervalMs: scheduler.checkIntervalMs,
          refreshThresholdMs: scheduler.refreshThresholdMs,
        },
        installedApps: installedApps.map(a => ({
          appName: a.appName,
          bundleId: a.bundleId,
          originalBundleId: a.originalBundleId,
          deviceUdid: a.deviceUdid,
          status: a.status,
          expiresAt: a.expiresAt,
        })),
      },
    });
  });

  router.post('/import-config', async (req, res, next) => {
    try {
      const config = req.body;
      if (!config || config.version !== 1) {
        return res.status(400).json({ ok: false, error: 'Invalid config format' });
      }

      let sourcesImported = 0;
      if (Array.isArray(config.sources)) {
        for (const source of config.sources) {
          if (source.url) {
            try {
              await ctx.sources.add(source.url);
              sourcesImported++;
            } catch { /* skip duplicates */ }
          }
        }
      }

      if (config.schedulerConfig) {
        ctx.scheduler.updateConfig({
          enabled: config.schedulerConfig.enabled,
          checkIntervalMs: config.schedulerConfig.checkIntervalMs,
          refreshThresholdMs: config.schedulerConfig.refreshThresholdMs,
        });
      }

      res.json({ ok: true, data: { sourcesImported } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/desktop-health', async (_req, res) => {
    const runtime = {
      status: 'ok',
      uptime: process.uptime(),
      version: process.env.SIDELINK_APP_VERSION ?? process.env.npm_package_version ?? '1.0.0',
      setupComplete: ctx.auth.isSetupComplete(),
    };
    const doctor = await buildHelperDoctorSnapshot(ctx);
    const pairing = getHelperPairingState(ctx);
    const accounts = ctx.appleAccounts.list();
    const devices = ctx.devices.list();
    const jobs = ctx.db.listJobs(undefined, 200);
    const scheduler = ctx.scheduler.getSnapshot();

    const activeAccounts = accounts.filter((account) => account.status === 'active').length;
    const accountsNeedingAttention = accounts.filter((account) => account.status !== 'active').length;
    const waitingFor2FA = jobs.filter((job) => job.status === 'waiting_2fa').length;
    const runningJobs = jobs.filter((job) => job.status === 'running').length;
    const recentFailures = jobs.filter((job) => job.status === 'failed').length;

    const issues: string[] = [];
    if (!doctor.helperIpaExists) issues.push('Helper IPA is missing from the current runtime.');
    if (doctor.appleAuthReady === false) issues.push(doctor.appleAuthError ?? 'Apple auth runtime is not healthy.');
    if (!pairing.paired) issues.push('The iPhone helper is not paired.');
    if (activeAccounts === 0) issues.push('No active Apple ID is ready for signing.');
    if (devices.length === 0) issues.push('No iOS devices are currently connected.');
    if (waitingFor2FA > 0) issues.push(`${waitingFor2FA} install job${waitingFor2FA === 1 ? ' is' : 's are'} waiting for 2FA.`);

    res.json({
      ok: true,
      data: {
        runtime,
        helper: {
          doctor,
          pairing,
        },
        accounts: {
          total: accounts.length,
          active: activeAccounts,
          needsAttention: accountsNeedingAttention,
        },
        devices: {
          total: devices.length,
          online: devices.filter((device) => device.connection === 'online').length,
          paired: devices.filter((device) => device.paired).length,
        },
        installs: {
          running: runningJobs,
          waitingFor2FA,
          recentFailures,
        },
        scheduler,
        readiness: {
          overall: issues.length === 0,
          issues,
        },
      },
    });
  });

  return router;
}

// ─── SSE Event Stream ────────────────────────────────────────────────

export const activeSSEResponses = new Set<import('express').Response>();

/** Gracefully close all SSE connections (call on server shutdown).
 *
 * Writing a close frame and calling `res.end()` is not enough to guarantee
 * the underlying TCP socket is closed promptly — Node sometimes holds the
 * FIN until the next write tick, which means `server.close()` keeps waiting
 * for drain and tsx watch force-kills the process before our 8-second
 * shutdown watchdog can fire. `req.socket.destroy()` makes the close
 * synchronous.
 */
export function closeAllSSE(): void {
  for (const res of activeSSEResponses) {
    try { res.write('event: close\ndata: "server-shutdown"\n\n'); } catch (err) {
      console.warn('[sse] Error sending close event:', err);
    }
    try { res.end(); } catch (err) {
      console.warn('[sse] Error ending response:', err);
    }
    try {
      // Best-effort: force the underlying socket closed so server.close()
      // can complete. Safe against already-destroyed sockets.
      (res as { req?: { socket?: { destroy?: () => void } } }).req?.socket?.destroy?.();
    } catch { /* socket already gone */ }
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
      send('scheduler-update', ctx.scheduler.getSnapshot());
    });

    const unsubPipelineLogs = onPipelineJobLog(entry => {
      send('job-log', entry);
    });

    // Device updates
    const unsubDevices = ctx.devices.onChange(devices => {
      send('device-update', devices);
      send('scheduler-update', ctx.scheduler.getSnapshot());
    });

    const unsubScheduler = ctx.scheduler.onChange((snapshot) => {
      send('scheduler-update', snapshot);
    });

    const unsubInstalledApps = onInstalledAppsChanged((apps) => {
      send('app-update', apps);
    });

    const unsubAccounts = ctx.appleAccounts.onChange(() => {
      send('account-update', listSafeAppleAccounts(ctx));
    });

    send('app-update', ctx.db.listInstalledApps());
    send('account-update', listSafeAppleAccounts(ctx));
    send('scheduler-update', ctx.scheduler.getSnapshot());

    // Log updates (real-time streaming)
    const unsubLogs = ctx.logs.onLog(entry => {
      send('log', entry);
    });

    // Keep-alive. `.unref()` so the timer does not keep the event loop
    // alive once the HTTP server is closed; otherwise `server.close()`
    // waits forever for drain and tsx watch force-kills the process
    // before our own 8-second shutdown timeout can fire.
    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 30_000);
    keepalive.unref();

    // Cleanup on disconnect
    req.on('close', () => {
      unsubPipeline();
      unsubPipelineLogs();
      unsubDevices();
      unsubScheduler();
      unsubInstalledApps();
      unsubAccounts();
      unsubLogs();
      clearInterval(keepalive);
      activeSSEResponses.delete(res);
    });
  });

  return router;
}
