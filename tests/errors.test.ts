// ─── Error Hierarchy Tests ───────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  AppError,
  AppleAuthError,
  Apple2FARequiredError,
  ProvisioningError,
  AppIdLimitError,
  DeviceError,
  SigningError,
  PipelineError,
  NotFoundError,
  ValidationError,
  AuthError,
  LockoutError,
} from '../src/server/utils/errors';

describe('Error hierarchy', () => {
  describe('AppError', () => {
    it('stores code, message, and statusCode', () => {
      const err = new AppError('TEST_CODE', 'test message', 422, 'retry later');
      expect(err.code).toBe('TEST_CODE');
      expect(err.message).toBe('test message');
      expect(err.statusCode).toBe(422);
      expect(err.action).toBe('retry later');
      expect(err.name).toBe('AppError');
    });

    it('defaults to status 500', () => {
      const err = new AppError('ERR', 'msg');
      expect(err.statusCode).toBe(500);
    });

    it('is an instance of Error', () => {
      const err = new AppError('ERR', 'msg');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('AppleAuthError', () => {
    it('has status 401', () => {
      const err = new AppleAuthError('AUTH_FAIL', 'bad creds');
      expect(err.statusCode).toBe(401);
      expect(err.name).toBe('AppleAuthError');
      expect(err).toBeInstanceOf(AppError);
    });
  });

  describe('Apple2FARequiredError', () => {
    it('has status 409 and stores session data', () => {
      const sessionData = { scnt: 'abc', xAppleIdSessionId: 'sess-1', authType: 'sms' };
      const err = new Apple2FARequiredError(sessionData);
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('APPLE_2FA_REQUIRED');
      expect(err.authType).toBe('sms');
      expect(err.partialSession.scnt).toBe('abc');
      expect(err.partialSession.sessionId).toBe('sess-1');
    });

    it('accepts explicit partial session', () => {
      const sessionData = { scnt: 'x', xAppleIdSessionId: 'y', authType: 'totp' };
      const partial = { cookies: ['c=1'], sessionToken: 'tok', scnt: 'x', sessionId: 'y' };
      const err = new Apple2FARequiredError(sessionData, partial);
      expect(err.partialSession.cookies).toEqual(['c=1']);
      expect(err.partialSession.sessionToken).toBe('tok');
    });
  });

  describe('ProvisioningError', () => {
    it('has status 422', () => {
      const err = new ProvisioningError('PROV_FAIL', 'provisioning failed');
      expect(err.statusCode).toBe(422);
      expect(err).toBeInstanceOf(AppError);
    });
  });

  describe('AppIdLimitError', () => {
    it('includes the limit in the message', () => {
      const err = new AppIdLimitError(10);
      expect(err.message).toContain('10');
      expect(err.code).toBe('APP_ID_LIMIT_REACHED');
      expect(err).toBeInstanceOf(ProvisioningError);
    });
  });

  describe('DeviceError', () => {
    it('has status 422', () => {
      const err = new DeviceError('DEV_FAIL', 'no device');
      expect(err.statusCode).toBe(422);
      expect(err.name).toBe('DeviceError');
    });
  });

  describe('SigningError', () => {
    it('has status 500', () => {
      const err = new SigningError('SIGN_FAIL', 'codesign failed');
      expect(err.statusCode).toBe(500);
      expect(err.name).toBe('SigningError');
    });
  });

  describe('PipelineError', () => {
    it('has status 500', () => {
      const err = new PipelineError('PIPE_FAIL', 'step failed');
      expect(err.statusCode).toBe(500);
      expect(err.name).toBe('PipelineError');
    });
  });

  describe('NotFoundError', () => {
    it('has status 404 and includes resource info', () => {
      const err = new NotFoundError('Device', 'abc-123');
      expect(err.statusCode).toBe(404);
      expect(err.message).toContain('Device');
      expect(err.message).toContain('abc-123');
    });
  });

  describe('ValidationError', () => {
    it('has status 400', () => {
      const err = new ValidationError('bad input');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AuthError', () => {
    it('has status 401 and default message', () => {
      const err = new AuthError();
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Authentication required');
    });

    it('accepts custom message', () => {
      const err = new AuthError('custom');
      expect(err.message).toBe('custom');
    });
  });

  describe('LockoutError', () => {
    it('has status 429 and includes time info', () => {
      const err = new LockoutError(15);
      expect(err.statusCode).toBe(429);
      expect(err.message).toContain('15 minutes');
      expect(err.code).toBe('ACCOUNT_LOCKED');
    });
  });
});
