// ─── Express Application ─────────────────────────────────────────────
// Wire all routes with middleware (CORS, JSON, cookies, auth guard, errors).

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import type { AppContext } from './context';
import { authRoutes, appleRoutes, deviceRoutes, ipaRoutes, installRoutes, sourceRoutes, systemRoutes, sseRoutes } from './routes';
import type { SourceManifest } from '../shared/types';
import { helperRoutes } from './routes/helper';
import { consumePairingCode } from './services/helper-pairing-service';
import { AppError } from './utils/errors';
import './types'; // Express Request augmentation
import { redact } from './utils/redaction';
import { authRateLimit, generalRateLimit, appleAuthRateLimit, uploadRateLimit, csrfProtection } from './utils/security';

export function createApp(ctx: AppContext): express.Express {
  const app = express();

  // ─── Middleware ──────────────────────────────────────────────────

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use('/api', csrfProtection({ skipPaths: ['/auth/status', '/auth/login', '/health', '/events', '/helper', '/system/pair'] }));

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    // Prevent caching of API responses
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  // ─── Auth Guard ─────────────────────────────────────────────────
  // Auth routes are public; everything else requires authentication
  // (unless setup is not yet complete).

  app.use('/api/auth', authRateLimit, authRoutes(ctx));

  // Health check (no auth required — must be before auth middleware)
  app.get('/api/health', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      data: {
        status: 'ok',
        uptime: process.uptime(),
        version: process.env.npm_package_version ?? '1.0.0',
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        },
        setupComplete: ctx.auth.isSetupComplete(),
      },
    });
  });

  // Helper routes (own token auth — must be before session middleware)
  app.use('/api/helper', helperRoutes(ctx));

  // Public pairing endpoint for iOS onboarding (plan compatibility)
  app.post('/api/system/pair', (req, res) => {
    const code = String(req.body?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: 'Pairing code must be 6 digits' });
    }

    const paired = consumePairingCode(ctx, code);
    if (!paired) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired pairing code' });
    }

    res.json({
      ok: true,
      data: {
        token: paired.token,
        serverName: 'Sidelink',
        serverVersion: process.env.npm_package_version ?? '1.0.0',
      },
    });
  });

  // Public self-hosted source feed endpoint (for external source consumers)
  app.get('/api/sources/self-hosted', (_req, res) => {
    const manifest = ctx.sources.getSelfHostedManifest();
    if (manifest) {
      return res.json(manifest);
    }
    const fallback: SourceManifest = {
      name: 'Sidelink Self Hosted',
      identifier: 'com.sidelink.self-hosted',
      sourceURL: '/api/sources/self-hosted',
      apps: [],
    };
    return res.json(fallback);
  });

  // Auth middleware for all other /api routes
  app.use('/api', generalRateLimit, (req, res, next) => {
    // Before setup is complete, only allow health + setup/status endpoints (handled above)
    if (!ctx.auth.isSetupComplete()) {
      // Block operational routes until admin is bootstrapped
      const safePreSetupPaths = ['/api/health'];
      if (safePreSetupPaths.includes(req.path)) return next();
      return res.status(403).json({ ok: false, error: 'Setup required: create admin account first' });
    }

    const token = req.cookies?.sidelink_session ?? req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    // Allow internal desktop token (tray polling, etc.)
    const internalToken = process.env.SIDELINK_INTERNAL_TOKEN;
    if (internalToken && token === internalToken) {
      req.userId = '__internal__';
      return next();
    }

    const session = ctx.auth.validateSession(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
    }
    req.userId = session.userId;
    next();
  });

  // ─── API Routes ─────────────────────────────────────────────────

  app.use('/api/apple', appleAuthRateLimit, appleRoutes(ctx));
  app.use('/api/devices', deviceRoutes(ctx));
  app.use('/api/ipas', uploadRateLimit, ipaRoutes(ctx));
  app.use('/api/install', installRoutes(ctx));
  app.use('/api/sources', sourceRoutes(ctx));
  app.use('/api/system', systemRoutes(ctx));
  app.use('/api/events', sseRoutes(ctx));

  // ─── Static Files (React SPA in production) ─────────────────────

  const clientDist = process.env.SIDELINK_CLIENT_DIR
    ?? path.join(__dirname, '..', 'client');

  // In dev mode (__dirname is src/server), the Vite build output is in
  // src/client/dist, not src/client. Detect by looking for the assets/
  // directory which only exists in the built output.
  const hasBuiltAssets = (dir: string) =>
    fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'assets'));
  const resolvedClientDir = hasBuiltAssets(clientDist)
    ? clientDist
    : hasBuiltAssets(path.join(clientDist, 'dist'))
      ? path.join(clientDist, 'dist')
      : clientDist;
  app.use(express.static(resolvedClientDir));
  app.get('*', (req, res, next) => {
    // Only serve index.html for non-API routes
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(resolvedClientDir, 'index.html'), err => {
      if (err) next(); // Fall through if file doesn't exist
    });
  });

  // ─── Error Handler ──────────────────────────────────────────────

  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Determine status code
    let status = 500;
    if (err instanceof AppError) status = err.statusCode;
    else if (err.status) status = err.status;

    // Handle multer errors (file upload limits/validation)
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
    } else if (err.message?.includes('Only .ipa files are accepted') || err.code === 'LIMIT_UNEXPECTED_FILE') {
      status = 400;
    }

    // AppError messages are safe for the client; other errors get a generic message
    const message = err instanceof AppError
      ? err.message
      : (status < 500 ? err.message : 'Internal server error');

    // Log unexpected errors (with sensitive data redacted)
    if (status === 500) {
      ctx.logs.error('SYS_ERROR', redact(err.message || 'Unknown error'), {
        stack: redact(err.stack ?? ''),
        path: req.path,
      });
    }

    res.status(status).json({ ok: false, error: message });
  });

  return app;
}
