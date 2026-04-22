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
import multer from 'multer';
import type { AppContext } from '../context';
import { getHelperPairingState, verifyHelperToken } from '../services/helper-pairing-service';
import { onPipelineJobLog, onPipelineUpdate, submitJobTwoFA, cancelJob } from '../pipeline';
import { UI_LIMITS } from '../../shared/constants';
import { Apple2FARequiredError } from '../utils/errors';
import { validators } from '../utils/validators';
import {
  deactivateInstalledApp,
  deleteAppleAppId,
  getHealth,
  getHelperConfigPayload,
  getHelperStatusPayload,
  listSafeAppleAccounts,
  listAppleAppIdUsage,
  listAppleCertificates,
  listDeviceAppInventory,
  listTrustedSources,
  reactivateInstalledApp,
  serializeHelperDevice,
  syncAndListAppleAppIds,
  startValidatedInstall,
  toSafeAppleAccount,
  triggerRefreshAllActiveApps,
} from '../services/shared-backend';
import { notifyInstalledAppsChanged, onInstalledAppsChanged } from '../services/installed-app-events';
import { downloadToFileWithLimit } from '../utils/fetch';
import { isLocalNetworkHost } from '../utils/network';
import { activeSSEResponses } from './system';

export function helperRoutes(ctx: AppContext): Router {
  const router = Router();
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
  // The stored value is a SHA-256 hash; we re-hash the inbound token
  // and compare hashes via timingSafeEqual.
  router.use((req, res, next) => {
    const token = req.headers['x-sidelink-helper-token'] as string | undefined;
    if (!verifyHelperToken(ctx, token)) {
      return res.status(401).json({ ok: false, error: 'Invalid or missing helper token' });
    }
    next();
  });

  // ── GET /status ─────────────────────────────────────────────────
  router.get('/status', async (req, res) => {
    const deviceId = req.query.deviceId as string | undefined;
    res.json(await getHelperStatusPayload(ctx, deviceId));
  });

  router.get('/config', (_req, res) => {
    res.json(getHelperConfigPayload(ctx));
  });

  router.get('/sources', (_req, res) => {
    res.json({ ok: true, data: ctx.sources.listWithManifest() });
  });

  router.post('/sources', async (req, res, next) => {
    const url = String(req.body?.url ?? '').trim();
    if (!url) {
      return res.status(400).json({ ok: false, error: 'url is required' });
    }

    try {
      const source = await ctx.sources.add(url);
      res.status(201).json({ ok: true, data: source });
    } catch (error) {
      next(error);
    }
  });

  router.post('/sources/:id/refresh', async (req, res, next) => {
    try {
      const source = await ctx.sources.refresh(req.params.id);
      res.json({ ok: true, data: source });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/sources/:id', (req, res, next) => {
    try {
      ctx.sources.remove(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
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
            trustedPhoneNumbers: err.trustedPhoneNumbers,
          },
        });
      }
      next(err);
    }
  });

  router.post('/apple/2fa', validators.apple2FA, async (req, res, next) => {
    try {
      const { appleId, password, code, method, phoneId } = req.body;
      const account = await ctx.appleAccounts.submit2FA({
        appleId,
        password,
        code,
        method: method ?? 'totp',
        phoneId: typeof phoneId === 'number' ? phoneId : undefined,
      });
      res.json({ ok: true, data: toSafeAppleAccount(account) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/apple/2fa/sms', validators.appleSMS, async (req, res, next) => {
    try {
      const { appleId, phoneId } = req.body;
      await ctx.appleAccounts.requestSMS(appleId, phoneId);
      res.json({ ok: true });
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
            trustedPhoneNumbers: err.trustedPhoneNumbers,
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
    res.json({ ok: true, data: ctx.db.listJobLogs(job.id) });
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
    notifyInstalledAppsChanged(ctx.db.listInstalledApps());
    res.json({ ok: true });
  });

  router.post('/jobs/:id/cancel', (req, res) => {
    const cancelled = cancelJob(ctx.db, req.params.id);
    if (!cancelled) {
      return res.status(409).json({ ok: false, error: 'Job cannot be cancelled' });
    }
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
    if (parsed.protocol === 'http:' && !isLocalNetworkHost(parsed.hostname)) {
      return res.status(400).json({ ok: false, error: 'HTTP IPA imports are only allowed for local-network hosts' });
    }

    const filePath = path.join(ctx.uploadDir, `helper-import-${Date.now()}.ipa`);

    try {
      await downloadToFileWithLimit(parsed.href, filePath, {
        contextLabel: 'IPA download',
        timeoutMs: 120_000,
        maxBytes: UI_LIMITS.maxIpaFileSizeBytes,
        errorStatusCode: 400,
      });
      const imported = await ctx.ipas.processUpload(filePath, path.basename(parsed.pathname || 'Imported.ipa'));
      res.json({ ok: true, data: imported });
    } catch (err) {
      await fs.unlink(filePath).catch(() => {});
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
      const result = await startValidatedInstall(ctx, {
        ipaId: String(req.body?.ipaId ?? ''),
        accountId: String(req.body?.accountId ?? ''),
        deviceUdid: String(req.body?.deviceUdid ?? ''),
        includeExtensions: !!req.body?.includeExtensions,
        bundleIdStrategy: req.body?.bundleIdStrategy === 'deterministic' ? 'deterministic' : 'randomized',
        customDisplayName: typeof req.body?.customDisplayName === 'string' && req.body.customDisplayName.trim()
          ? req.body.customDisplayName.trim()
          : undefined,
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
    const logs = ctx.db.listLogs(limit, level);
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
    const pairing = getHelperPairingState(ctx);
    const checks = {
      serverRunning: true,
      schedulerEnabled: ctx.scheduler.getSnapshot().running,
      deviceCount: ctx.devices.list().length,
      installedAppCount: ctx.db.listInstalledApps().length,
      helperTokenConfigured: pairing.paired,
      helperTokenSource: pairing.tokenSource,
      helperPairedAt: pairing.pairedAt,
    };

    res.json({ ok: true, data: checks });
  });

  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    activeSSEResponses.add(res);

    const send = (type: string, data: unknown) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('ready', {
      now: new Date().toISOString(),
      mode: process.env.SIDELINK_MODE ?? 'demo',
    });

    const unsubPipeline = onPipelineUpdate((job) => {
      send('job-update', job);
      send('scheduler-update', ctx.scheduler.getSnapshot());
    });

    const unsubPipelineLogs = onPipelineJobLog((entry) => {
      send('job-log', entry);
    });

    const unsubDevices = ctx.devices.onChange((devices) => {
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

    // `.unref()` so SSE clients don't pin the event loop open when the
    // server is shutting down — otherwise tsx watch sees a live handle
    // and force-kills before our graceful-shutdown can run.
    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 30_000);
    keepalive.unref();

    req.on('close', () => {
      unsubPipeline();
      unsubPipelineLogs();
      unsubDevices();
      unsubScheduler();
      unsubInstalledApps();
      unsubAccounts();
      clearInterval(keepalive);
      activeSSEResponses.delete(res);
    });
  });

  return router;
}

