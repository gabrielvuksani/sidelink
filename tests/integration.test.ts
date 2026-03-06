// ─── API Integration Tests ───────────────────────────────────────────
// Uses supertest to exercise Express routes against a real (temp) DB.
// No mocking — this is the closest we get to E2E without a browser.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAppContext, type AppContext } from '../src/server/context';
import { createApp } from '../src/server/app';
import supertest from 'supertest';
import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let ctx: AppContext;
let app: Express;
let request: ReturnType<typeof supertest>;
let tmpDir: string;

// Admin credentials for testing
const ADMIN_USER = 'testadmin';
const ADMIN_PASS = 'TestPass123!';
let sessionCookie = '';

beforeAll(() => {
  // Create a temp directory for this test run
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidelink-integration-'));

  ctx = createAppContext({
    dataDir: tmpDir,
    uploadDir: path.join(tmpDir, 'uploads'),
    encryptionSecret: 'integration-test-encryption-key-at-least-16',
    forceLegacyEncryption: true,
  });

  app = createApp(ctx);
  request = supertest(app);
});

afterAll(() => {
  ctx.shutdown();
  // Clean up temp directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Health ──────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns ok without authentication', async () => {
    const res = await request.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ─── Auth Flow ──────────────────────────────────────────────────────

describe('Auth routes', () => {
  describe('GET /api/auth/status', () => {
    it('shows setup not complete initially', async () => {
      const res = await request.get('/api/auth/status');
      expect(res.status).toBe(200);
      expect(res.body.data.setupComplete).toBe(false);
      expect(res.body.data.authenticated).toBe(false);
    });
  });

  describe('POST /api/auth/setup', () => {
    it('rejects empty body', async () => {
      const res = await request.post('/api/auth/setup').send({});
      expect(res.status).toBe(400);
    });

    it('rejects short password', async () => {
      const res = await request.post('/api/auth/setup').send({
        username: ADMIN_USER,
        password: 'short',
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid username characters', async () => {
      const res = await request.post('/api/auth/setup').send({
        username: 'bad user!@#',
        password: ADMIN_PASS,
      });
      expect(res.status).toBe(400);
    });

    it('creates admin account successfully', async () => {
      const res = await request.post('/api/auth/setup').send({
        username: ADMIN_USER,
        password: ADMIN_PASS,
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.token).toBeTruthy();
      expect(res.body.data.userId).toBeTruthy();

      // Extract session cookie
      const cookies = res.headers['set-cookie'];
      if (cookies) {
        const cookieStr = Array.isArray(cookies) ? cookies[0] : cookies;
        sessionCookie = cookieStr.split(';')[0];
      }
    });

    it('prevents duplicate admin creation', async () => {
      const res = await request.post('/api/auth/setup').send({
        username: 'hacker',
        password: 'SomePass123!',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/status (after setup)', () => {
    it('shows setup complete', async () => {
      const res = await request.get('/api/auth/status');
      expect(res.status).toBe(200);
      expect(res.body.data.setupComplete).toBe(true);
    });

    it('shows authenticated when cookie is present', async () => {
      const res = await request
        .get('/api/auth/status')
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.authenticated).toBe(true);
    });
  });

  describe('POST /api/auth/login', () => {
    it('rejects wrong password', async () => {
      const res = await request.post('/api/auth/login').send({
        username: ADMIN_USER,
        password: 'WrongPass123!',
      });
      expect(res.status).toBe(401);
    });

    it('logs in with correct credentials', async () => {
      const res = await request.post('/api/auth/login').send({
        username: ADMIN_USER,
        password: ADMIN_PASS,
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.token).toBeTruthy();

      // Update session cookie
      const cookies = res.headers['set-cookie'];
      if (cookies) {
        const cookieStr = Array.isArray(cookies) ? cookies[0] : cookies;
        sessionCookie = cookieStr.split(';')[0];
      }
    });
  });

  describe('POST /api/auth/logout', () => {
    it('logs out successfully', async () => {
      // Reuse the existing session cookie (avoids consuming another rate-limit token)
      const res = await request
        .post('/api/auth/logout')
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Re-login so subsequent tests still have a valid session
      const loginRes = await request.post('/api/auth/login').send({
        username: ADMIN_USER,
        password: ADMIN_PASS,
      });
      const cookies = loginRes.headers['set-cookie'];
      if (cookies) {
        const cookieStr = Array.isArray(cookies) ? cookies[0] : cookies;
        sessionCookie = cookieStr.split(';')[0];
      }
    });
  });
});

// ─── Protected Routes (require auth) ────────────────────────────────

describe('Protected routes', () => {
  it('rejects unauthenticated requests to /api/devices', async () => {
    const res = await request.get('/api/devices');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated requests to /api/system/dashboard', async () => {
    const res = await request.get('/api/system/dashboard');
    expect(res.status).toBe(401);
  });
});

// ─── Dashboard ──────────────────────────────────────────────────────

describe('GET /api/system/dashboard', () => {
  it('returns full dashboard state', async () => {
    const res = await request
      .get('/api/system/dashboard')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveProperty('accounts');
    expect(res.body.data).toHaveProperty('devices');
    expect(res.body.data).toHaveProperty('ipas');
    expect(res.body.data).toHaveProperty('jobs');
    expect(res.body.data).toHaveProperty('installedApps');
    expect(res.body.data).toHaveProperty('scheduler');
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
    expect(Array.isArray(res.body.data.devices)).toBe(true);
  });
});

// ─── Devices ────────────────────────────────────────────────────────

describe('GET /api/devices', () => {
  it('returns device list (may be empty)', async () => {
    const res = await request
      .get('/api/devices')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── IPAs ───────────────────────────────────────────────────────────

describe('IPA routes', () => {
  it('returns empty IPA list', async () => {
    const res = await request
      .get('/api/ipas')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('rejects non-IPA upload', async () => {
    const res = await request
      .post('/api/ipas/upload')
      .set('Cookie', sessionCookie)
      .attach('ipa', Buffer.from('not a real file'), 'test.txt');
    // Should reject because the file doesn't have .ipa extension
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ─── Apple Accounts ─────────────────────────────────────────────────

describe('Apple account routes', () => {
  it('returns empty account list', async () => {
    const res = await request
      .get('/api/apple/accounts')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('rejects sign-in with invalid email', async () => {
    const res = await request
      .post('/api/apple/signin')
      .set('Cookie', sessionCookie)
      .send({ email: 'not-an-email', password: 'test123' });
    expect(res.status).toBe(400);
  });
});

// ─── Install Routes ─────────────────────────────────────────────────

describe('Install routes', () => {
  it('rejects install with missing fields', async () => {
    const res = await request
      .post('/api/install')
      .set('Cookie', sessionCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns empty job list', async () => {
    const res = await request
      .get('/api/install/jobs')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns empty installed apps list', async () => {
    const res = await request
      .get('/api/install/apps')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── Logs ───────────────────────────────────────────────────────────

describe('Log routes', () => {
  it('returns log entries', async () => {
    const res = await request
      .get('/api/system/logs')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('supports limit parameter', async () => {
    const res = await request
      .get('/api/system/logs?limit=5')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });

  it('clears logs', async () => {
    const res = await request
      .delete('/api/system/logs')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── Scheduler ──────────────────────────────────────────────────────

describe('Scheduler routes', () => {
  it('returns scheduler snapshot', async () => {
    const res = await request
      .get('/api/system/scheduler')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveProperty('running');
  });
});

// ─── Security Headers ───────────────────────────────────────────────

describe('Security headers', () => {
  it('sets CSP on all responses', async () => {
    const res = await request.get('/api/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sets no-store cache control on API routes', async () => {
    const res = await request.get('/api/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// ─── Rate Limiting ──────────────────────────────────────────────────

describe('Rate limiting headers', () => {
  it('includes rate limit headers on general API routes', async () => {
    // Use an authenticated general-rate-limited endpoint (not auth, which may be exhausted)
    const res = await request
      .get('/api/devices')
      .set('Cookie', sessionCookie);
    expect(res.headers['x-ratelimit-limit']).toBeTruthy();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });
});

// ─── Password Change ────────────────────────────────────────────────

describe('POST /api/auth/password', () => {
  it('rejects wrong current password', async () => {
    const res = await request
      .post('/api/auth/password')
      .set('Cookie', sessionCookie)
      .send({
        currentPassword: 'WrongOld123!',
        newPassword: 'NewPass456!',
      });
    // Should fail (wrong current password)
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ─── 404 Handling ───────────────────────────────────────────────────

describe('Unknown routes', () => {
  it('returns HTML for non-API unknown routes (SPA fallback)', async () => {
    const res = await request.get('/some/nonexistent/page');
    // SPA fallback serves index.html or 404 depending on whether client is built
    expect([200, 404]).toContain(res.status);
  });
});
