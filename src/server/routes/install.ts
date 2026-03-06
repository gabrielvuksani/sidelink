// ─── Install Routes ──────────────────────────────────────────────────
// POST /api/install         — start install pipeline
// GET  /api/install/jobs    — list jobs
// GET  /api/install/jobs/:id — get job status
// GET  /api/install/apps    — list installed apps
// DELETE /api/install/apps/:id — remove installed app record

import { Router } from 'express';
import type { AppContext } from '../context';
import { startInstallPipeline, getJob, getJobLogs, listJobs, submitJobTwoFA } from '../pipeline';
import { validators } from '../utils/validators';

export function installRoutes(ctx: AppContext): Router {
  const router = Router();

  // Start install
  router.post('/', validators.startInstall, async (req, res, next) => {
    try {
      const { accountId, ipaId, deviceUdid, includeExtensions } = req.body;
      if (!accountId || !ipaId || !deviceUdid) {
        return res.status(400).json({
          ok: false,
          error: 'accountId, ipaId, and deviceUdid are required',
        });
      }
      const job = await startInstallPipeline(ctx.pipelineDeps, {
        accountId, ipaId, deviceUdid, includeExtensions: !!includeExtensions,
      });
      res.json({ ok: true, data: job });
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

  return router;
}
