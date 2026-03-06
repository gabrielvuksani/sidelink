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
import {
  deleteAppleAppId,
  listAppleAppIdUsage,
  listAppleCertificates,
  listSafeAppleAccounts,
  syncAndListAppleAppIds,
  toSafeAppleAccount,
} from '../services/shared-backend';

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
      res.json({ ok: true, data: toSafeAppleAccount(account) });
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
    res.json({ ok: true, data: listSafeAppleAccounts(ctx) });
  });

  // Get single account
  router.get('/accounts/:id', (req, res) => {
    const account = ctx.appleAccounts.get(req.params.id);
    if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });
    res.json({ ok: true, data: toSafeAppleAccount(account) });
  });

  // Re-authenticate an existing account (when requires_2fa or session_expired)
  router.post('/accounts/:id/reauth', async (req, res, next) => {
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

  // Submit 2FA for re-auth of an existing account
  router.post('/accounts/:id/reauth/2fa', validators.apple2FACode, async (req, res, next) => {
    try {
      const { code } = req.body;
      const account = await ctx.appleAccounts.complete2FAForAccount(req.params.id, code);
      res.json({ ok: true, data: toSafeAppleAccount(account) });
    } catch (err) {
      next(err);
    }
  });

  // Remove account
  router.delete('/accounts/:id', (req, res) => {
    ctx.appleAccounts.remove(req.params.id);
    res.json({ ok: true });
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

  return router;
}
