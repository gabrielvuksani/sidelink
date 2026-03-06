// ─── Shared Constants & Types Tests ──────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  FREE_ACCOUNT_LIMITS,
  PAID_ACCOUNT_LIMITS,
  APPLE_ENDPOINTS,
  DEVELOPER_PATHS,
  PIPELINE_STEPS,
  DEFAULTS,
  LOG_CODES,
} from '../src/shared/constants';

describe('shared constants', () => {
  describe('FREE_ACCOUNT_LIMITS', () => {
    it('has sensible free tier limits', () => {
      expect(FREE_ACCOUNT_LIMITS.maxAppIds).toBe(10);
      expect(FREE_ACCOUNT_LIMITS.maxActiveAppIds).toBe(3);
      expect(FREE_ACCOUNT_LIMITS.maxAppsPerDevice).toBe(3);
      expect(FREE_ACCOUNT_LIMITS.certExpiryDays).toBe(7);
      expect(FREE_ACCOUNT_LIMITS.profileExpiryDays).toBe(7);
    });
  });

  describe('PAID_ACCOUNT_LIMITS', () => {
    it('has relaxed limits for paid accounts', () => {
      expect(PAID_ACCOUNT_LIMITS.maxAppIds).toBe(Infinity);
      expect(PAID_ACCOUNT_LIMITS.maxActiveAppIds).toBe(Infinity);
      expect(PAID_ACCOUNT_LIMITS.certExpiryDays).toBe(365);
    });
  });

  describe('APPLE_ENDPOINTS', () => {
    it('has all required Apple auth endpoints', () => {
      expect(APPLE_ENDPOINTS.authInit).toContain('idmsa.apple.com');
      expect(APPLE_ENDPOINTS.verify2FA).toContain('securitycode');
      expect(APPLE_ENDPOINTS.trust).toContain('2sv/trust');
      expect(APPLE_ENDPOINTS.developerServices).toContain('developerservices2');
    });

    it('all endpoints are HTTPS', () => {
      for (const [key, url] of Object.entries(APPLE_ENDPOINTS)) {
        expect(url, `${key} should be HTTPS`).toMatch(/^https:\/\//);
      }
    });
  });

  describe('DEVELOPER_PATHS', () => {
    it('has expected service paths', () => {
      expect(DEVELOPER_PATHS.listTeams).toContain('listTeams');
      expect(DEVELOPER_PATHS.addDevice).toContain('addDevice');
      expect(DEVELOPER_PATHS.submitCSR).toContain('CSR');
      expect(DEVELOPER_PATHS.downloadProfile).toContain('Profile');
    });

    it('all paths end with .action', () => {
      for (const [key, p] of Object.entries(DEVELOPER_PATHS)) {
        expect(p, `${key} should end with .action`).toMatch(/\.action$/);
      }
    });
  });

  describe('PIPELINE_STEPS', () => {
    it('has 6 steps in order', () => {
      expect(PIPELINE_STEPS).toHaveLength(6);
      expect(PIPELINE_STEPS[0].key).toBe('validate');
      expect(PIPELINE_STEPS[1].key).toBe('authenticate');
      expect(PIPELINE_STEPS[2].key).toBe('provision');
      expect(PIPELINE_STEPS[3].key).toBe('sign');
      expect(PIPELINE_STEPS[4].key).toBe('install');
      expect(PIPELINE_STEPS[5].key).toBe('register');
    });

    it('each step has a human-readable label', () => {
      for (const step of PIPELINE_STEPS) {
        expect(step.label.length).toBeGreaterThan(3);
      }
    });
  });

  describe('DEFAULTS', () => {
    it('has a valid default port', () => {
      expect(DEFAULTS.port).toBeGreaterThanOrEqual(1024);
      expect(DEFAULTS.port).toBeLessThanOrEqual(65535);
    });

    it('has reasonable timeout values', () => {
      expect(DEFAULTS.commandTimeoutMs).toBeGreaterThanOrEqual(30_000);
      expect(DEFAULTS.signingTimeoutMs).toBeGreaterThanOrEqual(60_000);
      expect(DEFAULTS.authSessionTtlHours).toBeGreaterThanOrEqual(1);
    });

    it('scheduler defaults are sensible', () => {
      // Check interval is at least 1 minute
      expect(DEFAULTS.schedulerCheckIntervalMs).toBeGreaterThanOrEqual(60_000);
      // Backoff values
      expect(DEFAULTS.schedulerInitialBackoffMinutes).toBeGreaterThanOrEqual(1);
      expect(DEFAULTS.schedulerMaxBackoffMinutes).toBeGreaterThan(DEFAULTS.schedulerInitialBackoffMinutes);
    });
  });

  describe('LOG_CODES', () => {
    it('has app lifecycle codes', () => {
      expect(LOG_CODES.APP_BOOTED).toBe('APP_BOOTED');
      expect(LOG_CODES.APP_SHUTDOWN).toBe('APP_SHUTDOWN');
    });

    it('all codes are uppercase strings', () => {
      for (const [key, code] of Object.entries(LOG_CODES)) {
        expect(code, `${key} should be uppercase`).toMatch(/^[A-Z0-9_]+$/);
      }
    });
  });
});
