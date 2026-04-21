// ─── Install Routes ──────────────────────────────────────────────────
// POST /api/install         — start install pipeline
// GET  /api/install/jobs    — list jobs
// GET  /api/install/jobs/:id — get job status
// GET  /api/install/apps    — list installed apps
// DELETE /api/install/apps/:id — remove installed app record

import { Router } from 'express';
import fs from 'node:fs/promises';
import type { AppContext } from '../context';
import { getJob, listJobs, submitJobTwoFA, cancelJob } from '../pipeline';
import { validators } from '../utils/validators';
import { deactivateInstalledApp, reactivateInstalledApp, startValidatedInstall } from '../services/shared-backend';
import { notifyInstalledAppsChanged } from '../services/installed-app-events';
import semver from 'semver';

export function installRoutes(ctx: AppContext): Router {
  const router = Router();

  // Start install
  router.post('/', validators.startInstall, async (req, res, next) => {
    try {
      const { accountId, ipaId, deviceUdid, includeExtensions, bundleIdStrategy, customDisplayName } = req.body;
      const result = await startValidatedInstall(ctx, {
        accountId,
        ipaId,
        deviceUdid,
        includeExtensions: !!includeExtensions,
        bundleIdStrategy: bundleIdStrategy === 'deterministic' ? 'deterministic' : 'randomized',
        customDisplayName: typeof customDisplayName === 'string' && customDisplayName.trim() ? customDisplayName.trim() : undefined,
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

  // List jobs
  router.get('/jobs', (req, res) => {
    const filters: { accountId?: string; deviceUdid?: string; status?: string } = {};
    if (req.query.accountId) filters.accountId = req.query.accountId as string;
    if (req.query.deviceUdid) filters.deviceUdid = req.query.deviceUdid as string;
    if (req.query.status) filters.status = req.query.status as string;
    const jobs = listJobs(ctx.db, filters);
    res.json({ ok: true, data: jobs });
  });

  // Get job
  router.get('/jobs/:id', (req, res) => {
    const job = getJob(ctx.db, req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
    res.json({ ok: true, data: job });
  });

  // Get verbose job logs
  router.get('/jobs/:id/logs', (req, res) => {
    const job = getJob(ctx.db, req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
    res.json({ ok: true, data: ctx.db.listJobLogs(job.id) });
  });

  // Cancel a running or queued job
  router.post('/jobs/:id/cancel', (req, res) => {
    const cancelled = cancelJob(ctx.db, req.params.id);
    if (!cancelled) {
      return res.status(409).json({ ok: false, error: 'Job cannot be cancelled (not found or already terminal)' });
    }
    res.json({ ok: true });
  });

  // Submit 2FA code for a waiting job
  router.post('/jobs/:id/2fa', validators.jobTwoFA, (req, res) => {
    const { code } = req.body;
    const job = getJob(ctx.db, req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
    if (job.status !== 'waiting_2fa') {
      return res.status(409).json({ ok: false, error: 'Job is not waiting for 2FA' });
    }
    const delivered = submitJobTwoFA(req.params.id, code.trim());
    if (!delivered) {
      return res.status(409).json({ ok: false, error: 'Job is no longer waiting for 2FA' });
    }
    res.json({ ok: true });
  });

  // Check for available updates from sources. A source version is only offered as
  // an update when it is strictly greater than the installed version using
  // semver-aware comparison — prior string compare treated "1.10" < "1.9".
  router.get('/apps/updates', (_req, res) => {
    const installed = ctx.db.listInstalledApps();
    const sources = ctx.sources.combined();

    const updates = installed
      .filter((app) => app.status === 'active')
      .map((app) => {
        const sourceApp = sources.apps.find((s) => s.bundleIdentifier === app.originalBundleId);
        if (!sourceApp) return null;
        const sourceVersion = sourceApp.version ?? sourceApp.versions?.[0]?.version;
        const installedVersion = app.appVersion;
        if (!sourceVersion || !installedVersion) return null;

        const coercedSource = semver.coerce(sourceVersion);
        const coercedInstalled = semver.coerce(installedVersion);
        // If either version fails to coerce into a valid semver, fall back to a
        // strict string mismatch so we don't silently hide an update.
        const isNewer = coercedSource && coercedInstalled
          ? semver.gt(coercedSource, coercedInstalled)
          : sourceVersion !== installedVersion;

        if (!isNewer) return null;
        return {
          installedAppId: app.id,
          appName: app.appName,
          bundleId: app.originalBundleId,
          installedVersion,
          availableVersion: sourceVersion,
          downloadURL: sourceApp.downloadURL ?? sourceApp.versions?.[0]?.downloadURL,
        };
      })
      .filter(Boolean);

    res.json({ ok: true, data: updates });
  });

  // List installed apps
  router.get('/apps', (req, res) => {
    const deviceUdid = req.query.deviceUdid as string | undefined;
    const apps = deviceUdid
      ? ctx.db.listInstalledAppsForDevice(deviceUdid)
      : ctx.db.listInstalledApps();
    res.json({ ok: true, data: apps });
  });

  // Delete installed app record + perform device uninstall and signed-IPA cleanup.
  // Best-effort: if the device is unreachable we still delete the local record so
  // the user can retry later, but we log the failure. `?force=1` skips device
  // uninstall entirely (useful when the device is no longer available at all).
  router.delete('/apps/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const app = ctx.db.getInstalledApp(id);
      if (!app) {
        return res.status(404).json({ ok: false, error: 'Installed app not found' });
      }

      const force = req.query.force === '1' || req.query.force === 'true';
      const errors: string[] = [];

      if (!force) {
        try {
          await ctx.devices.uninstallApp(app.deviceUdid, app.bundleId);
        } catch (err) {
          errors.push(`device uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const signedPath = app.signedIpaPath;
      if (signedPath) {
        try {
          await fs.unlink(signedPath);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes('ENOENT')) {
            errors.push(`signed IPA cleanup failed: ${message}`);
          }
        }
      }

      ctx.db.deleteInstalledApp(id);
      notifyInstalledAppsChanged(ctx.db.listInstalledApps());
      res.json({ ok: true, data: errors.length ? { warnings: errors } : null });
    } catch (err) {
      next(err);
    }
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

  return router;
}
