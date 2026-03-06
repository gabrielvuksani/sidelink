// ─── Device Routes ───────────────────────────────────────────────────
// GET  /api/devices          — list connected devices
// POST /api/devices/:udid/pair — pair a device
// POST /api/devices/refresh  — force device list refresh

import { Router } from 'express';
import type { AppContext } from '../context';

export function deviceRoutes(ctx: AppContext): Router {
  const router = Router();

  // List connected devices
  router.get('/', (req, res) => {
    const devices = ctx.devices.list();
    res.json({ ok: true, data: devices });
  });

  // Force refresh
  router.post('/refresh', async (req, res, next) => {
    try {
      const devices = await ctx.devices.refresh();
      res.json({ ok: true, data: devices });
    } catch (err) {
      next(err);
    }
  });

  // Pair device
  router.post('/:udid/pair', async (req, res, next) => {
    try {
      await ctx.devices.pair(req.params.udid);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
