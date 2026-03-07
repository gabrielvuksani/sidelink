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
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';
import type { AppContext } from '../context';
import { getHelperToken } from '../services/helper-pairing-service';
import { getJobLogs, onPipelineJobLog, onPipelineUpdate, startInstallPipeline, submitJobTwoFA } from '../pipeline';
import { FREE_ACCOUNT_LIMITS, UI_LIMITS } from '../../shared/constants';
import { Apple2FARequiredError } from '../utils/errors';
import { validators } from '../utils/validators';
import {
  deactivateInstalledApp,
  deleteAppleAppId,
  listAppleAppIdUsage,
  listAppleCertificates,
  listDeviceAppInventory,
  listSafeAppleAccounts,
  listTrustedSources,
  reactivateInstalledApp,
  syncAndListAppleAppIds,
  startValidatedInstall,
  toSafeAppleAccount,
  triggerRefreshAllActiveApps,
} from '../services/shared-backend';

export function helperRoutes(ctx: AppContext): Router {
  const router = Router();
  const serializeHelperDevice = (device: ReturnType<AppContext['devices']['list']>[number]) => ({
    id: device.udid,
    name: device.name,
    connection: device.connection,
    transport: device.transport,
    networkName: null,
    iosVersion: device.iosVersion,
    productType: device.productType,
    model: device.model,
  });
  const upload = multer({
    dest: ctx.uploadDir,
    limits: { fileSize: UI_LIMITS.maxIpaFileSizeBytes },
    fileFilter: (_req, file, cb) => {
      if (path.extname(file.originalname).toLowerCase() === '.ipa') {
        cb(null, true);
      } else {
        cb(new Error('Only .ipa files are accepted'));
      }
    },
  });

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

    const devices = ctx.devices.list().map(serializeHelperDevice);

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
        serverName: process.env.SIDELINK_SERVER_NAME ?? 'SideLink',
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
          activeSlotsUsed: ctx.db.countInstalledAppsByStatus('active'),
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
    res.json({ ok: true, data: listSafeAppleAccounts(ctx) });
  });

  router.post('/apple/signin', validators.appleSignIn, async (req, res, next) => {
    try {
      const { appleId, password } = req.body;
      const account = await ctx.appleAccounts.signIn(appleId, password);
      res.json({ ok: true, data: toSafeAppleAccount(account) });
    } catch (err) {
      if (err instanceof Apple2FARequiredError) {
        return res.status(200).json({
          ok: true,
          data: {
            requires2FA: true,
            authType: err.authType,
          },
        });
      }
      next(err);
    }
  });

  router.post('/apple/2fa', validators.apple2FA, async (req, res, next) => {
    try {
      const { appleId, password, code, method } = req.body;
      const account = await ctx.appleAccounts.submit2FA({
        appleId,
        password,
        code,
        method: method ?? 'totp',
      });
      res.json({ ok: true, data: toSafeAppleAccount(account) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/apple/accounts/:id/reauth', async (req, res, next) => {
    try {
      const account = await ctx.appleAccounts.reauthenticate(req.params.id);
      res.json({ ok: true, data: toSafeAppleAccount(account) });
    } catch (err) {
      if (err instanceof Apple2FARequiredError) {
        return res.status(200).json({
          ok: true,
          data: {
            requires2FA: true,
            authType: err.authType,
          },
        });
      }
      next(err);
    }
  });

  router.post('/apple/accounts/:id/reauth/2fa', validators.apple2FACode, async (req, res, next) => {
    try {
      const account = await ctx.appleAccounts.complete2FAForAccount(req.params.id, String(req.body.code));
      res.json({ ok: true, data: toSafeAppleAccount(account) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/apple/accounts/:id', (req, res) => {
    ctx.appleAccounts.remove(req.params.id);
    res.json({ ok: true });
  });

  router.get('/devices', (_req, res) => {
    res.json({ ok: true, data: ctx.devices.list().map(serializeHelperDevice) });
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

  router.post('/apps/:id/deactivate', async (req, res, next) => {
    try {
      const app = await deactivateInstalledApp(ctx, req.params.id);
      if (!app) {
        return res.status(404).json({ ok: false, error: 'Installed app not found' });
      }
      res.json({ ok: true, data: app });
    } catch (err) {
      next(err);
    }
  });

  router.post('/apps/:id/reactivate', async (req, res, next) => {
    try {
      const result = await reactivateInstalledApp(ctx, req.params.id);
      if (result.kind === 'missing') {
        return res.status(404).json({ ok: false, error: 'Installed app not found' });
      }
      if (result.kind === 'missing-ipa') {
        return res.status(409).json({ ok: false, error: 'Original IPA is no longer available for reactivation' });
      }
      res.json({ ok: true, data: result.job });
    } catch (err) {
      next(err);
    }
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

  router.post('/ipas/upload', upload.single('ipa'), async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No IPA file uploaded' });
      }

      const imported = await ctx.ipas.processUpload(req.file.path, req.file.originalname);
      res.json({ ok: true, data: imported });
    } catch (err) {
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      next(err);
    }
  });

  router.post('/install', validators.startInstall, async (req, res, next) => {
    try {
      const ipaId = String(req.body?.ipaId ?? '');
      const accountId = String(req.body?.accountId ?? '');
      const deviceUdid = String(req.body?.deviceUdid ?? '');
      const includeExtensions = !!req.body?.includeExtensions;

      const result = await startValidatedInstall(ctx, {
        ipaId,
        accountId,
        deviceUdid,
        includeExtensions,
      });

      if (result.kind === 'missing-ipa') {
        return res.status(404).json({ ok: false, error: 'IPA not found' });
      }
      if (result.kind === 'missing-account') {
        return res.status(404).json({ ok: false, error: 'Apple account not found' });
      }
      if (result.kind === 'inactive-account') {
        return res.status(400).json({ ok: false, error: 'Apple account is not authenticated' });
      }
      if (result.kind === 'missing-device') {
        return res.status(404).json({ ok: false, error: 'Device not found' });
      }

      res.json({ ok: true, data: result.job });
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

  router.post('/refresh-all', async (_req, res) => {
    res.json({ ok: true, data: await triggerRefreshAllActiveApps(ctx) });
  });

  router.get('/logs', (req, res) => {
    const rawLimit = Number.parseInt(String(req.query.limit ?? '200'), 10);
    const limit = Number.isNaN(rawLimit) ? 200 : Math.min(Math.max(rawLimit, 1), 1000);
    const level = typeof req.query.level === 'string' ? req.query.level : undefined;
    const validLevels = new Set(['info', 'warn', 'error', 'debug']);
    const logs = level && validLevels.has(level)
      ? ctx.db.listLogs(limit * 5).filter((entry) => entry.level === level).slice(0, limit)
      : ctx.db.listLogs(limit);
    res.json({ ok: true, data: logs });
  });

  router.get('/app-ids', async (req, res, next) => {
    try {
      const sync = req.query.sync === 'true';
      res.json({ ok: true, data: await syncAndListAppleAppIds(ctx, sync) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/app-ids/usage', (_req, res) => {
    res.json({ ok: true, data: listAppleAppIdUsage(ctx) });
  });

  router.delete('/app-ids/:id', async (req, res, next) => {
    try {
      const deleted = await deleteAppleAppId(ctx, req.params.id);
      if (!deleted) {
        return res.status(404).json({ ok: false, error: 'App ID not found' });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/certificates', (_req, res) => {
    res.json({ ok: true, data: listAppleCertificates(ctx) });
  });

  router.get('/trusted-sources', (_req, res, next) => {
    try {
      res.json({ ok: true, data: listTrustedSources() });
    } catch (err) {
      next(err);
    }
  });

  router.get('/devices/:udid/all-apps', async (req, res, next) => {
    try {
      const inventory = await listDeviceAppInventory(ctx, req.params.udid);
      if (!inventory) {
        return res.status(404).json({ ok: false, error: 'Device not found' });
      }
      res.json({ ok: true, data: inventory });
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

