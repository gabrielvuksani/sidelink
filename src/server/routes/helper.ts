// ─── Helper Routes ───────────────────────────────────────────────────
// Endpoints consumed by the iOS SidelinkHelper companion app.
// Authentication is via the x-sidelink-helper-token header.
//
// GET  /api/helper/status   — overview for the helper's dashboard
// POST /api/helper/refresh  — trigger a re-sign for an installed app
// GET  /api/helper/doctor   — diagnostic info about helper prerequisites

import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppContext } from '../context';
import { getHelperToken } from '../services/helper-pairing-service';
import { getJobLogs, onPipelineJobLog, onPipelineUpdate, startInstallPipeline, submitJobTwoFA } from '../pipeline';
import { FREE_ACCOUNT_LIMITS } from '../../shared/constants';

export function helperRoutes(ctx: AppContext): Router {
  const router = Router();

  // ── Auth middleware for helper token ────────────────────────────
  router.use((req, res, next) => {
    const token = req.headers['x-sidelink-helper-token'] as string | undefined;
    const expected = getHelperToken(ctx);
    if (!expected || !token ||
        expected.length !== token.length ||
        !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))) {
      return res.status(401).json({ ok: false, error: 'Invalid or missing helper token' });
    }
    next();
  });

  // ── GET /status ─────────────────────────────────────────────────
  router.get('/status', (req, res) => {
    const deviceId = req.query.deviceId as string | undefined;

    // Installed apps — optionally filtered by device
    const allInstalls = deviceId
      ? ctx.db.listInstalledAppsForDevice(deviceId)
      : ctx.db.listInstalledApps();

    const installs = allInstalls.map((app) => ({
      id: app.id,
      deviceId: app.deviceUdid,
      kind: 'primary',
      label: app.appName || app.originalBundleId,
      bundleId: app.bundleId,
      health: getHealth(app.expiresAt),
      expiresAt: app.expiresAt,
      refreshCount: app.refreshCount ?? 0,
      autoRefresh: {
        nextAttemptAt: '',
        retryCount: 0,
        lastFailureReason: null,
        lastSuccessAt: app.lastRefreshAt ?? null,
      },
    }));

    const devices = ctx.devices.list().map((d) => ({
      id: d.udid,
      name: d.name,
      connection: d.connection,
      transport: d.transport,
      networkName: null,
    }));

    const schedulerState = ctx.scheduler.getSnapshot();

    res.json({
      ok: true,
      now: new Date().toISOString(),
      mode: process.env.SIDELINK_MODE ?? 'demo',
      scheduler: {
        running: schedulerState.running,
        simulatedNow: new Date().toISOString(),
        autoRefreshThresholdHours: 24,
      },
      installs,
      devices,
      helperArtifact: {
        available: true,
        message: null,
      },
    });
  });

  router.get('/config', (_req, res) => {
    const scheduler = ctx.scheduler.getSnapshot();
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weeklyAppIdsUsedByAccount = Object.fromEntries(
      ctx.appleAccounts
        .list()
        .filter((account) => account.accountType !== 'paid')
        .map((account) => [
          account.id,
          ctx.db.countAppIdsCreatedSince(account.id, account.teamId, sevenDaysAgoIso),
        ]),
    );
    const sourceFeeds = ctx.sources.list().map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      enabled: source.enabled,
    }));
    res.json({
      ok: true,
      data: {
        serverName: process.env.SIDELINK_SERVER_NAME ?? 'Sidelink',
        serverVersion: process.env.npm_package_version ?? '1.0.0',
        schedulerEnabled: scheduler.enabled,
        schedulerCheckIntervalMs: scheduler.checkIntervalMs,
        capabilities: {
          pairingCode: true,
          sourceImport: true,
          installEvents: true,
          inline2FA: true,
        },
        freeAccountLimits: {
          maxActiveApps: FREE_ACCOUNT_LIMITS.maxAppsPerDevice,
          maxNewAppIdsPerWeek: FREE_ACCOUNT_LIMITS.maxNewAppIdsPerWeek,
          certValidityDays: FREE_ACCOUNT_LIMITS.certExpiryDays,
        },
        freeAccountUsage: {
          activeSlotsUsed: ctx.db.listInstalledApps().length,
          weeklyAppIdsUsedByAccount,
        },
        sourceFeeds,
      },
    });
  });

  router.get('/auto-refresh-states', (_req, res) => {
    res.json({ ok: true, data: ctx.scheduler.getAutoRefreshStates() });
  });

  router.get('/accounts', (_req, res) => {
    const safe = ctx.appleAccounts.list().map(({ id, appleId, teamId, teamName, accountType, status }) => ({
      id,
      appleId,
      teamId,
      teamName,
      accountType,
      status,
    }));
    res.json({ ok: true, data: safe });
  });

  router.get('/devices', (_req, res) => {
    res.json({ ok: true, data: ctx.devices.list() });
  });

  router.get('/ipas', (_req, res) => {
    res.json({ ok: true, data: ctx.ipas.list() });
  });

  router.get('/jobs', (_req, res) => {
    res.json({ ok: true, data: ctx.db.listJobs() });
  });

  router.get('/jobs/:id', (req, res) => {
    const job = ctx.db.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Install job not found' });
    }
    res.json({ ok: true, data: job });
  });

  router.get('/jobs/:id/logs', (req, res) => {
    const job = ctx.db.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Install job not found' });
    }
    res.json({ ok: true, data: getJobLogs(job.id) });
  });

  router.get('/apps', (req, res) => {
    const deviceUdid = req.query.deviceUdid as string | undefined;
    const apps = deviceUdid
      ? ctx.db.listInstalledAppsForDevice(deviceUdid)
      : ctx.db.listInstalledApps();
    res.json({ ok: true, data: apps });
  });

  router.delete('/apps/:id', (req, res) => {
    const existing = ctx.db.listInstalledApps().find((app) => app.id === req.params.id);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Installed app not found' });
    }
    ctx.db.deleteInstalledApp(req.params.id);
    res.json({ ok: true });
  });

  router.post('/jobs/:id/2fa', (req, res) => {
    const code = String(req.body?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: '2FA code must be 6 digits' });
    }

    const job = ctx.db.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Install job not found' });
    }
    if (job.status !== 'waiting_2fa') {
      return res.status(409).json({ ok: false, error: 'Job is not waiting for 2FA' });
    }

    const delivered = submitJobTwoFA(job.id, code);
    if (!delivered) {
      return res.status(409).json({ ok: false, error: 'Job is no longer waiting for 2FA' });
    }

    res.json({ ok: true });
  });

  router.post('/ipas/import-url', async (req, res, next) => {
    const rawUrl = String(req.body?.url ?? '').trim();
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: 'url is required' });
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid URL' });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return res.status(400).json({ ok: false, error: 'Only http/https URLs are supported' });
    }

    const filePath = path.join(ctx.uploadDir, `helper-import-${Date.now()}.ipa`);

    try {
      const upstream = await fetch(parsed.href);
      if (!upstream.ok || !upstream.body) {
        return res.status(400).json({ ok: false, error: `Failed to download IPA (${upstream.status})` });
      }

      await pipeline(Readable.fromWeb(upstream.body as any), createWriteStream(filePath));
      const imported = await ctx.ipas.processUpload(filePath, path.basename(parsed.pathname || 'Imported.ipa'));
      res.json({ ok: true, data: imported });
    } catch (err) {
      next(err);
    }
  });

  router.post('/install', async (req, res, next) => {
    try {
      const ipaId = String(req.body?.ipaId ?? '');
      const accountId = String(req.body?.accountId ?? '');
      const deviceUdid = String(req.body?.deviceUdid ?? '');
      const includeExtensions = !!req.body?.includeExtensions;

      if (!ipaId || !accountId || !deviceUdid) {
        return res.status(400).json({ ok: false, error: 'ipaId, accountId, and deviceUdid are required' });
      }

      const account = ctx.appleAccounts.get(accountId);
      if (!account) {
        return res.status(404).json({ ok: false, error: 'Apple account not found' });
      }
      if (account.status !== 'active') {
        return res.status(400).json({ ok: false, error: 'Apple account is not authenticated' });
      }

      const device = ctx.devices.get(deviceUdid);
      if (!device) {
        return res.status(404).json({ ok: false, error: 'Device not found' });
      }

      const job = await startInstallPipeline(ctx.pipelineDeps, {
        ipaId,
        accountId,
        deviceUdid,
        includeExtensions,
      });
      res.json({ ok: true, data: job });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /refresh ───────────────────────────────────────────────
  router.post('/refresh', async (req, res, next) => {
    try {
      const { installId } = req.body ?? {};
      if (!installId || typeof installId !== 'string') {
        return res.status(400).json({ ok: false, error: 'installId is required' });
      }

      // Look up the installed app
      const apps = ctx.db.listInstalledApps();
      const app = apps.find((a) => a.id === installId);
      if (!app) {
        return res.status(404).json({ ok: false, error: 'Installed app not found' });
      }

      // Trigger re-sign via the scheduler
      try {
        await ctx.scheduler.triggerRefresh(installId);
      } catch {
        return res.status(409).json({ ok: false, error: 'Refresh already in progress or unavailable' });
      }

      res.json({
        ok: true,
        install: {
          id: app.id,
          deviceId: app.deviceUdid,
          kind: 'primary',
          label: app.appName || app.originalBundleId,
          bundleId: app.bundleId,
          health: getHealth(app.expiresAt),
          expiresAt: app.expiresAt,
          refreshCount: (app.refreshCount ?? 0) + 1,
          autoRefresh: {
            nextAttemptAt: '',
            retryCount: 0,
            lastFailureReason: null,
            lastSuccessAt: new Date().toISOString(),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /doctor ─────────────────────────────────────────────────
  router.get('/doctor', (_req, res) => {
    const checks = {
      serverRunning: true,
      schedulerEnabled: ctx.scheduler.getSnapshot().running,
      deviceCount: ctx.devices.list().length,
      installedAppCount: ctx.db.listInstalledApps().length,
      helperTokenConfigured: !!getHelperToken(ctx),
    };

    res.json({ ok: true, data: checks });
  });

  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (type: string, data: unknown) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('ready', {
      now: new Date().toISOString(),
      mode: process.env.SIDELINK_MODE ?? 'demo',
    });

    const unsubPipeline = onPipelineUpdate((job) => {
      send('job-update', job);
    });

    const unsubPipelineLogs = onPipelineJobLog((entry) => {
      send('job-log', entry);
    });

    const unsubDevices = ctx.devices.onChange((devices) => {
      send('device-update', devices);
    });

    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 30_000);

    req.on('close', () => {
      unsubPipeline();
      unsubPipelineLogs();
      unsubDevices();
      clearInterval(keepalive);
    });
  });

  return router;
}

function getHealth(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days <= 0) return 'expired';
  if (days <= 2) return 'critical';
  if (days <= 4) return 'warning';
  return 'healthy';
}
