// ─── Auth Routes ─────────────────────────────────────────────────────
// POST /api/auth/setup   — create initial admin
// POST /api/auth/login   — login
// POST /api/auth/logout  — logout
// POST /api/auth/password — change password
// GET  /api/auth/status  — check auth status

import { Router } from 'express';
import type { Response } from 'express';
import type { AppContext } from '../context';
import { validators } from '../utils/validators';
import type { UserSession } from '../../shared/types';

function setSessionCookie(res: Response, session: UserSession): void {
  res.cookie('sidelink_session', session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(session.expiresAt),
  });
}

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  // Check if setup is needed
  router.get('/status', (req, res) => {
    const session = ctx.auth.validateSession(req.cookies?.sidelink_session ?? '');
    res.json({
      ok: true,
      data: {
        setupComplete: ctx.auth.isSetupComplete(),
        authenticated: !!session,
      },
    });
  });

  // Initial admin setup
  router.post('/setup', validators.authSetup, async (req, res, next) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ ok: false, error: 'Username and password required' });
      }
      const session = await ctx.auth.setupAdmin(username, password);
      setSessionCookie(res, session);
      res.json({ ok: true, data: session });
    } catch (err) {
      next(err);
    }
  });

  // Login
  router.post('/login', validators.authLogin, async (req, res, next) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ ok: false, error: 'Username and password required' });
      }
      const ip = req.ip;
      const session = await ctx.auth.login(username, password, ip);
      setSessionCookie(res, session);
      res.json({ ok: true, data: session });
    } catch (err) {
      next(err);
    }
  });

  // Logout
  router.post('/logout', (req, res) => {
    const token = req.cookies?.sidelink_session;
    if (token) {
      ctx.auth.logout(token);
      res.clearCookie('sidelink_session');
    }
    res.json({ ok: true });
  });

  // Change password
  router.post('/password', validators.authPassword, async (req, res, next) => {
    try {
      const session = ctx.auth.validateSession(req.cookies?.sidelink_session ?? '');
      if (!session) return res.status(401).json({ ok: false, error: 'Not authenticated' });

      const { currentPassword, newPassword } = req.body;
      await ctx.auth.changePassword(session.userId, currentPassword, newPassword);
      res.clearCookie('sidelink_session');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
