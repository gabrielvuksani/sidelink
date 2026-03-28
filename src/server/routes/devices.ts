// ─── Device Routes ───────────────────────────────────────────────────
// GET  /api/devices          — list connected devices
// POST /api/devices/:udid/pair — pair a device
// POST /api/devices/refresh  — force device list refresh

import { Router } from 'express';
import type { AppContext } from '../context';
import { isValidUDID } from '../utils/security';

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
    if (!isValidUDID(req.params.udid)) {
      return res.status(400).json({ ok: false, error: 'Invalid UDID format' });
    }
    try {
      await ctx.devices.pair(req.params.udid);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Device capabilities (LiveContainer detection, etc.)
  router.get('/:udid/capabilities', async (req, res, next) => {
    try {
      const udid = req.params.udid;
      const device = ctx.devices.get(udid);
      if (!device) return res.status(404).json({ ok: false, error: 'Device not found' });

      const installedBundleIds = await ctx.devices.listInstalledApps(udid);
      const liveContainerIds = [
        'com.kdt.livecontainer',
        'com.kdt.livecontainer2',
        'io.github.livecontainer.LiveContainer',
      ];
      const hasLiveContainer = installedBundleIds.some(id =>
        liveContainerIds.some(lcId => id.toLowerCase().includes(lcId.toLowerCase()) || id.toLowerCase().includes('livecontainer'))
      );

      res.json({
        ok: true,
        data: {
          udid,
          hasLiveContainer,
          liveContainerBundleId: hasLiveContainer
            ? installedBundleIds.find(id => id.toLowerCase().includes('livecontainer')) ?? null
            : null,
          totalAppsInstalled: installedBundleIds.length,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
