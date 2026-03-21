// ─── Apple Account Routes ────────────────────────────────────────────
// POST /api/apple/signin   — start Apple ID auth
// POST /api/apple/2fa      — submit 2FA code
// POST /api/apple/2fa/sms  — request SMS 2FA
// GET  /api/apple/accounts — list accounts
// DELETE /api/apple/accounts/:id — remove account

import { Router } from 'express';
import type { AppContext } from '../context';
import { Apple2FARequiredError } from '../utils/errors';
import { appleAuthRateLimit } from '../utils/security';
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
  router.post('/signin', appleAuthRateLimit, validators.appleSignIn, async (req, res, next) => {
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
            trustedPhoneNumbers: err.trustedPhoneNumbers,
          },
        });
      }
      next(err);
    }
  });

  // Submit 2FA code
  router.post('/2fa', appleAuthRateLimit, validators.apple2FA, async (req, res, next) => {
    try {
      const { appleId, password, code, method, phoneId } = req.body;
      if (!appleId || !code) {
        return res.status(400).json({ ok: false, error: 'Apple ID and code required' });
      }
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

  // Request SMS 2FA
  router.post('/2fa/sms', appleAuthRateLimit, validators.appleSMS, async (req, res, next) => {
    try {
      const { appleId, phoneId } = req.body;
      if (!appleId || phoneId === undefined) {
        return res.status(400).json({ ok: false, error: 'Apple ID and phone number ID required' });
      }
      await ctx.appleAccounts.requestSMS(appleId, phoneId);
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
  router.post('/accounts/:id/reauth', appleAuthRateLimit, async (req, res, next) => {
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

  // Submit 2FA for re-auth of an existing account
  router.post('/accounts/:id/reauth/2fa', appleAuthRateLimit, validators.apple2FACode, async (req, res, next) => {
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

  router.post('/accounts/:id/rotate-certificate', async (req, res, next) => {
    try {
      const account = ctx.appleAccounts.get(req.params.id);
      if (!account) {
        return res.status(404).json({ ok: false, error: 'Account not found' });
      }
      if (account.status !== 'active') {
        return res.status(400).json({ ok: false, error: 'Account must be active to rotate certificates' });
      }

      const client = await ctx.appleAccounts.getDevClient(account.id);

      // Revoke existing certificates
      const existingCerts = ctx.db.listCertificates(account.id);
      for (const cert of existingCerts) {
        if (!cert.revokedAt) {
          try {
            await client.revokeCertificate(account.teamId, cert.serialNumber);
          } catch {
            // Best-effort revocation on portal
          }
          ctx.db.saveCertificate({ ...cert, revokedAt: new Date().toISOString() });
        }
      }

      // Create a fresh certificate (ensureCertificate handles CSR + portal submission)
      const { CertificateManager } = await import('../apple/certificate-manager');
      const certManager = new CertificateManager(ctx.db, client);
      const newCert = await certManager.ensureCertificate(account.id, account.teamId);

      ctx.logs.info('CERT_ROTATED', `Certificate rotated for ${account.appleId}`, {
        accountId: account.id,
        newCertId: newCert.id,
        revokedCount: existingCerts.filter((c) => !c.revokedAt).length,
      });

      res.json({
        ok: true,
        data: {
          newCertificate: {
            id: newCert.id,
            serialNumber: newCert.serialNumber,
            commonName: newCert.commonName,
            expiresAt: newCert.expiresAt,
            createdAt: newCert.createdAt,
          },
          revokedCount: existingCerts.filter((c) => !c.revokedAt).length,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
