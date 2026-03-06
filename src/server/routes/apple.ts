// ─── Apple Account Routes ────────────────────────────────────────────
// POST /api/apple/signin   — start Apple ID auth
// POST /api/apple/2fa      — submit 2FA code
// POST /api/apple/2fa/sms  — request SMS 2FA
// GET  /api/apple/accounts — list accounts
// DELETE /api/apple/accounts/:id — remove account

import { Router } from 'express';
import type { AppContext } from '../context';
import { Apple2FARequiredError } from '../utils/errors';
import { validators } from '../utils/validators';

export function appleRoutes(ctx: AppContext): Router {
  const router = Router();

  // Sign in with Apple ID
  router.post('/signin', validators.appleSignIn, async (req, res, next) => {
    try {
      const { appleId, password } = req.body;
      if (!appleId || !password) {
        return res.status(400).json({ ok: false, error: 'Apple ID and password required' });
      }
      const account = await ctx.appleAccounts.signIn(appleId, password);
      res.json({ ok: true, data: account });
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

  // Submit 2FA code
  router.post('/2fa', validators.apple2FA, async (req, res, next) => {
    try {
      const { appleId, password, code, method } = req.body;
      if (!appleId || !code) {
        return res.status(400).json({ ok: false, error: 'Apple ID and code required' });
      }
      const account = await ctx.appleAccounts.submit2FA({
        appleId,
        password,
        code,
        method: method ?? 'totp',
      });
      res.json({ ok: true, data: account });
    } catch (err) {
      next(err);
    }
  });

  // Request SMS 2FA
  router.post('/2fa/sms', validators.appleSMS, async (req, res, next) => {
    try {
      const { appleId, phoneNumberId } = req.body;
      if (!appleId || phoneNumberId === undefined) {
        return res.status(400).json({ ok: false, error: 'Apple ID and phone number ID required' });
      }
      await ctx.appleAccounts.requestSMS(appleId, phoneNumberId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // List accounts
  router.get('/accounts', (req, res) => {
    const accounts = ctx.appleAccounts.list();
    // Explicitly pick safe fields — new sensitive fields won't leak
    const safe = accounts.map(({ id, appleId, teamId, teamName, accountType, status, lastAuthAt, createdAt }) => ({
      id, appleId, teamId, teamName, accountType, status, lastAuthAt, createdAt,
    }));
    res.json({ ok: true, data: safe });
  });

  // Get single account
  router.get('/accounts/:id', (req, res) => {
    const account = ctx.appleAccounts.get(req.params.id);
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });
    const { id, appleId, teamId, teamName, accountType, status, lastAuthAt, createdAt } = account;
    res.json({ ok: true, data: { id, appleId, teamId, teamName, accountType, status, lastAuthAt, createdAt } });
  });

  // Re-authenticate an existing account (when requires_2fa or session_expired)
  router.post('/accounts/:id/reauth', async (req, res, next) => {
    try {
      const account = await ctx.appleAccounts.reauthenticate(req.params.id);
      res.json({ ok: true, data: account });
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

  // Submit 2FA for re-auth of an existing account
  router.post('/accounts/:id/reauth/2fa', validators.apple2FACode, async (req, res, next) => {
    try {
      const { code } = req.body;
      const account = await ctx.appleAccounts.complete2FAForAccount(req.params.id, code);
      // Strip sensitive fields
      const { id, appleId, teamId, teamName, accountType, status, lastAuthAt, createdAt } = account;
      res.json({ ok: true, data: { id, appleId, teamId, teamName, accountType, status, lastAuthAt, createdAt } });
    } catch (err) {
      next(err);
    }
  });

  // Remove account
  router.delete('/accounts/:id', (req, res) => {
    ctx.appleAccounts.remove(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
