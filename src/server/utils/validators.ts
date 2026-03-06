// ─── Request Validation ──────────────────────────────────────────────
// Lightweight typed request validators for API routes.
// No external deps — uses the security helpers + typed assertions.

import type { Request, Response, NextFunction } from 'express';
import { sanitizeString, isValidEmail, isValidUUID, isValidUDID } from './security';

// ── Validation error ─────────────────────────────────────────────────

class ValidationError extends Error {
  public readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ── Generic validator middleware factory ──────────────────────────────

type ValidatorFn = (body: Record<string, unknown>) => Record<string, unknown>;

/**
 * Create an Express middleware that validates req.body using the given
 * validator function. On success, replaces req.body with the validated
 * (sanitized) result. On failure, responds with 400.
 */
export function validateBody(validator: ValidatorFn) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      req.body = validator(body as Record<string, unknown>);
      next();
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ ok: false, error: err.message });
      }
      next(err);
    }
  };
}

// ── Field helpers ────────────────────────────────────────────────────

function requireString(obj: Record<string, unknown>, field: string, opts?: { maxLength?: number; label?: string }): string {
  const raw = obj[field];
  const clean = sanitizeString(raw, opts?.maxLength ?? 500);
  if (!clean || clean.length === 0) {
    throw new ValidationError(`${opts?.label ?? field} is required`);
  }
  return clean;
}

function optionalString(obj: Record<string, unknown>, field: string, opts?: { maxLength?: number }): string | undefined {
  const raw = obj[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  return sanitizeString(raw, opts?.maxLength ?? 500);
}

function requireNumber(obj: Record<string, unknown>, field: string, opts?: { min?: number; max?: number; label?: string }): number {
  const raw = obj[field];
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (isNaN(num) || !isFinite(num)) {
    throw new ValidationError(`${opts?.label ?? field} must be a valid number`);
  }
  if (opts?.min !== undefined && num < opts.min) {
    throw new ValidationError(`${opts?.label ?? field} must be at least ${opts.min}`);
  }
  if (opts?.max !== undefined && num > opts.max) {
    throw new ValidationError(`${opts?.label ?? field} must be at most ${opts.max}`);
  }
  return num;
}

function optionalBoolean(obj: Record<string, unknown>, field: string): boolean | undefined {
  const raw = obj[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

// ── Route-specific validators ────────────────────────────────────────

export const validators = {
  /** POST /api/auth/setup — { username, password } */
  authSetup: validateBody((body) => {
    const username = requireString(body, 'username', { maxLength: 64, label: 'Username' });
    const password = requireString(body, 'password', { maxLength: 128, label: 'Password' });
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) throw new ValidationError('Username may only contain letters, numbers, hyphens, and underscores');
    return { username, password };
  }),

  /** POST /api/auth/login — { username, password } */
  authLogin: validateBody((body) => ({
    username: requireString(body, 'username', { maxLength: 64 }),
    password: requireString(body, 'password', { maxLength: 128 }),
  })),

  /** POST /api/auth/password — { currentPassword, newPassword } */
  authPassword: validateBody((body) => {
    const newPassword = requireString(body, 'newPassword', { maxLength: 128, label: 'New password' });
    if (newPassword.length < 8) throw new ValidationError('New password must be at least 8 characters');
    return {
      currentPassword: requireString(body, 'currentPassword', { maxLength: 128, label: 'Current password' }),
      newPassword,
    };
  }),

  /** POST /api/apple/signin — { appleId, password } */
  appleSignIn: validateBody((body) => {
    const appleId = requireString(body, 'appleId', { maxLength: 254, label: 'Apple ID' });
    if (!isValidEmail(appleId)) throw new ValidationError('Apple ID must be a valid email address');
    return {
      appleId,
      password: requireString(body, 'password', { maxLength: 256, label: 'Password' }),
    };
  }),

  /** POST /api/apple/2fa — { appleId, password, code } */
  apple2FA: validateBody((body) => {
    const code = requireString(body, 'code', { maxLength: 6, label: '2FA code' });
    if (!/^\d{6}$/.test(code)) throw new ValidationError('2FA code must be exactly 6 digits');
    return {
      appleId: requireString(body, 'appleId', { maxLength: 254 }),
      password: requireString(body, 'password', { maxLength: 256 }),
      code,
    };
  }),

  /** POST /api/apple/accounts/:id/reauth/2fa — { code } */
  apple2FACode: validateBody((body) => {
    const code = requireString(body, 'code', { maxLength: 6, label: '2FA code' });
    if (!/^\d{6}$/.test(code)) throw new ValidationError('2FA code must be exactly 6 digits');
    return { code };
  }),

  /** POST /api/apple/2fa/sms — { appleId, phoneNumberId } */
  appleSMS: validateBody((body) => ({
    appleId: requireString(body, 'appleId', { maxLength: 254 }),
    phoneNumberId: requireNumber(body, 'phoneNumberId', { min: 0, max: 100 }),
  })),

  /** POST /api/install — { accountId, ipaId, deviceUdid, includeExtensions? } */
  startInstall: validateBody((body) => ({
    accountId: requireString(body, 'accountId', { maxLength: 64, label: 'Account ID' }),
    ipaId: requireString(body, 'ipaId', { maxLength: 64, label: 'IPA ID' }),
    deviceUdid: requireString(body, 'deviceUdid', { maxLength: 64, label: 'Device UDID' }),
    includeExtensions: optionalBoolean(body, 'includeExtensions') ?? false,
  })),

  /** POST /api/install/jobs/:id/2fa — { code } */
  jobTwoFA: validateBody((body) => {
    const code = requireString(body, 'code', { maxLength: 6, label: '2FA code' });
    if (!/^\d{6}$/.test(code)) throw new ValidationError('2FA code must be exactly 6 digits');
    return { code };
  }),

  /** POST /api/system/scheduler — { enabled?, checkIntervalMs? } */
  schedulerUpdate: validateBody((body) => {
    const result: Record<string, unknown> = {};
    const enabled = optionalBoolean(body, 'enabled');
    if (enabled !== undefined) result.enabled = enabled;
    const intervalMs = body.checkIntervalMs;
    if (intervalMs !== undefined) {
      result.checkIntervalMs = requireNumber(body, 'checkIntervalMs', { min: 60000, max: 86400000, label: 'Check interval' });
    }
    return result;
  }),
};
