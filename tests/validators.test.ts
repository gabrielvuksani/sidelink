// ─── Validators Tests ─────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Helper to run a validator middleware and capture the result
function runValidator(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  body: Record<string, unknown>,
): Promise<{ status?: number; json?: unknown; nextCalled: boolean; body?: unknown }> {
  return new Promise((resolve) => {
    const req = { body } as unknown as Request;
    let result: { status?: number; json?: unknown; nextCalled: boolean; body?: unknown } = { nextCalled: false };

    const res = {
      status(code: number) {
        result.status = code;
        return this;
      },
      json(data: unknown) {
        result.json = data;
        resolve(result);
      },
    } as unknown as Response;

    const next = ((err?: unknown) => {
      result.nextCalled = true;
      result.body = req.body;
      if (err) result.json = err;
      resolve(result);
    }) as NextFunction;

    middleware(req, res, next);
  });
}

// Import validators dynamically to avoid issues with missing deps
let validators: typeof import('../src/server/utils/validators').validators;

describe('Request Validators', () => {
  beforeAll(async () => {
    const mod = await import('../src/server/utils/validators');
    validators = mod.validators;
  });

  describe('authSetup', () => {
    it('passes valid input', async () => {
      const result = await runValidator(validators.authSetup, {
        username: 'admin',
        password: 'password123',
      });
      expect(result.nextCalled).toBe(true);
      expect(result.body).toEqual({ username: 'admin', password: 'password123' });
    });

    it('rejects missing username', async () => {
      const result = await runValidator(validators.authSetup, {
        password: 'password123',
      });
      expect(result.status).toBe(400);
    });

    it('rejects short password', async () => {
      const result = await runValidator(validators.authSetup, {
        username: 'admin',
        password: 'short',
      });
      expect(result.status).toBe(400);
      expect((result.json as { error: string }).error).toContain('8 characters');
    });

    it('rejects invalid username characters', async () => {
      const result = await runValidator(validators.authSetup, {
        username: 'admin user!',
        password: 'password123',
      });
      expect(result.status).toBe(400);
    });

    it('sanitizes input by trimming', async () => {
      const result = await runValidator(validators.authSetup, {
        username: '  admin  ',
        password: ' password123 ',
      });
      expect(result.nextCalled).toBe(true);
      expect(result.body).toEqual({ username: 'admin', password: 'password123' });
    });
  });

  describe('authLogin', () => {
    it('passes valid input', async () => {
      const result = await runValidator(validators.authLogin, {
        username: 'admin',
        password: 'password123',
      });
      expect(result.nextCalled).toBe(true);
    });

    it('rejects missing password', async () => {
      const result = await runValidator(validators.authLogin, {
        username: 'admin',
      });
      expect(result.status).toBe(400);
    });
  });

  describe('appleSignIn', () => {
    it('passes valid Apple ID', async () => {
      const result = await runValidator(validators.appleSignIn, {
        appleId: 'user@icloud.com',
        password: 'mypassword',
      });
      expect(result.nextCalled).toBe(true);
    });

    it('rejects non-email Apple ID', async () => {
      const result = await runValidator(validators.appleSignIn, {
        appleId: 'not-an-email',
        password: 'mypassword',
      });
      expect(result.status).toBe(400);
      expect((result.json as { error: string }).error).toContain('email');
    });
  });

  describe('apple2FA', () => {
    it('passes valid 6-digit code', async () => {
      const result = await runValidator(validators.apple2FA, {
        appleId: 'user@icloud.com',
        password: 'pass',
        code: '123456',
      });
      expect(result.nextCalled).toBe(true);
    });

    it('rejects non-numeric code', async () => {
      const result = await runValidator(validators.apple2FA, {
        appleId: 'user@icloud.com',
        password: 'pass',
        code: 'abcdef',
      });
      expect(result.status).toBe(400);
      expect((result.json as { error: string }).error).toContain('6 digits');
    });

    it('rejects short code', async () => {
      const result = await runValidator(validators.apple2FA, {
        appleId: 'user@icloud.com',
        password: 'pass',
        code: '123',
      });
      expect(result.status).toBe(400);
    });
  });

  describe('startInstall', () => {
    it('passes valid install params', async () => {
      const result = await runValidator(validators.startInstall, {
        accountId: 'acc-123',
        ipaId: 'ipa-456',
        deviceUdid: 'device-789',
      });
      expect(result.nextCalled).toBe(true);
    });

    it('rejects missing fields', async () => {
      const result = await runValidator(validators.startInstall, {
        accountId: 'acc-123',
        // missing ipaId and deviceUdid
      });
      expect(result.status).toBe(400);
    });
  });

  describe('schedulerUpdate', () => {
    it('passes valid scheduler config', async () => {
      const result = await runValidator(validators.schedulerUpdate, {
        enabled: true,
        checkIntervalMs: 120000,
      });
      expect(result.nextCalled).toBe(true);
      expect(result.body).toEqual({ enabled: true, checkIntervalMs: 120000 });
    });

    it('rejects interval below minimum', async () => {
      const result = await runValidator(validators.schedulerUpdate, {
        checkIntervalMs: 1000, // below 60000 minimum
      });
      expect(result.status).toBe(400);
    });

    it('allows partial updates', async () => {
      const result = await runValidator(validators.schedulerUpdate, {
        enabled: false,
      });
      expect(result.nextCalled).toBe(true);
      expect(result.body).toEqual({ enabled: false });
    });
  });
});
