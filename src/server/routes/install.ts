// ─── Install Routes ──────────────────────────────────────────────────
// POST /api/install         — start install pipeline
// GET  /api/install/jobs    — list jobs
// GET  /api/install/jobs/:id — get job status
// GET  /api/install/apps    — list installed apps
// DELETE /api/install/apps/:id — remove installed app record

import { Router } from 'express';
import type { AppContext } from '../context';
import { getJob, getJobLogs, listJobs, submitJobTwoFA } from '../pipeline';
import { validators } from '../utils/validators';
import { deactivateInstalledApp, reactivateInstalledApp, startValidatedInstall } from '../services/shared-backend';

export function installRoutes(ctx: AppContext): Router {
  const router = Router();

  // Start install
  router.post('/', validators.startInstall, async (req, res, next) => {
    try {
      const { accountId, ipaId, deviceUdid, includeExtensions } = req.body;
      const result = await startValidatedInstall(ctx, {
        accountId,
        ipaId,
        deviceUdid,
        includeExtensions: !!includeExtensions,
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
    res.json({ ok: true, data: getJobLogs(job.id) });
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

  // List installed apps
  router.get('/apps', (req, res) => {
    const deviceUdid = req.query.deviceUdid as string | undefined;
    const apps = deviceUdid
      ? ctx.db.listInstalledAppsForDevice(deviceUdid)
      : ctx.db.listInstalledApps();
    res.json({ ok: true, data: apps });
  });

  // Delete installed app record
  router.delete('/apps/:id', (req, res) => {
    ctx.db.deleteInstalledApp(req.params.id);
    res.json({ ok: true });
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
