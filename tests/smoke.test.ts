// ─── Smoke Tests ─────────────────────────────────────────────────────
// Validates that core modules resolve and key types are correct.

import { describe, it, expect } from 'vitest';

describe('Smoke: module imports', () => {
  it('shared types and constants resolve', async () => {
    const types = await import('../src/shared/types');
    const constants = await import('../src/shared/constants');
    expect(types).toBeDefined();
    expect(constants.DEFAULTS).toBeDefined();
    expect(constants.PIPELINE_STEPS).toHaveLength(6);
    expect(constants.LOG_CODES).toBeDefined();
  });

  it('error hierarchy resolves', async () => {
    const {
      AppError, AppleAuthError, Apple2FARequiredError,
      ProvisioningError, DeviceError, SigningError, PipelineError,
      NotFoundError, ValidationError, AuthError, LockoutError,
    } = await import('../src/server/utils/errors');

    const appErr = new AppError('TEST', 'test msg', 400);
    expect(appErr.code).toBe('TEST');
    expect(appErr.statusCode).toBe(400);

    const lockout = new LockoutError(5);
    expect(lockout.statusCode).toBe(429);
    expect(lockout.message).toContain('5 minutes');

    const twoFA = new Apple2FARequiredError(
      { scnt: 's', xAppleIdSessionId: 'x', authType: 'hsa2' },
    );
    expect(twoFA.statusCode).toBe(409);
    expect(twoFA.authType).toBe('hsa2');
  });

  it('PIPELINE_STEPS have key and label', async () => {
    const { PIPELINE_STEPS } = await import('../src/shared/constants');
    for (const step of PIPELINE_STEPS) {
      expect(step).toHaveProperty('key');
      expect(step).toHaveProperty('label');
    }
    expect(PIPELINE_STEPS.map(s => s.key)).toEqual([
      'validate', 'authenticate', 'provision', 'sign', 'install', 'register',
    ]);
  });

  it('DEFAULTS uses camelCase keys', async () => {
    const { DEFAULTS } = await import('../src/shared/constants');
    expect(DEFAULTS.port).toBe(4010);
    expect(DEFAULTS.schedulerCheckIntervalMs).toBeDefined();
    expect(typeof DEFAULTS.schedulerCheckIntervalMs).toBe('number');
  });
});
