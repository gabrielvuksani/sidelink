import { Router } from 'express';
import type { AppContext } from '../context';
import type { SourceManifest } from '../../shared/types';
import { listTrustedSources } from '../services/shared-backend';
import communitySourcesData from '../data/community-sources.json';

export function sourceRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ ok: true, data: ctx.sources.list() });
  });

  router.post('/', async (req, res, next) => {
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

  router.post('/:id/refresh', async (req, res, next) => {
    try {
      const source = await ctx.sources.refresh(req.params.id);
      res.json({ ok: true, data: source });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      ctx.sources.remove(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/apps', (req, res, next) => {
    try {
      const apps = ctx.sources.appsForSource(req.params.id);
      res.json({ ok: true, data: apps });
    } catch (error) {
      next(error);
    }
  });

  router.get('/combined', (_req, res) => {
    res.json({ ok: true, data: ctx.sources.combined() });
  });

  router.get('/community', (_req, res) => {
    res.json({ ok: true, data: communitySourcesData });
  });

  router.get('/:id/manifest', (req, res, next) => {
    try {
      res.json({ ok: true, data: ctx.sources.getManifest(req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  // GET /self-hosted is served publicly from app.ts (no auth required for AltStore compatibility)

  router.put('/self-hosted', (req, res, next) => {
    try {
      const manifest = req.body as SourceManifest;
      if (!manifest || typeof manifest.name !== 'string' || !Array.isArray(manifest.apps)) {
        return res.status(400).json({ ok: false, error: 'Invalid source manifest payload' });
      }
      ctx.sources.setSelfHostedManifest(manifest);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/trusted-sources', (_req, res, next) => {
    try {
      res.json({ ok: true, data: listTrustedSources() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
