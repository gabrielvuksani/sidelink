import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createAppContext } from '../src/server/context';

const LEGACY_KEYS = [
  'ALTSTORE_UPLOAD_DIR',
  'ALTSTORE_DB_PATH',
  'ALTSTORE_MODE',
  'ALTSTORE_AUTH_COOKIE_NAME',
  'ALTSTORE_SESSION_TTL_HOURS',
  'ALTSTORE_HELPER_PROJECT_DIR',
  'ALTSTORE_HELPER_IPA_PATH',
  'ALTSTORE_HELPER_BUNDLE_ID',
  'ALTSTORE_HELPER_DISPLAY_NAME',
  'ALTSTORE_HELPER_API_TOKEN',
  'ALTSTORE_AUTO_REFRESH_THRESHOLD_HOURS',
  'ALTSTORE_AUTO_REFRESH_INITIAL_BACKOFF_MINUTES',
  'ALTSTORE_AUTO_REFRESH_MAX_BACKOFF_MINUTES',
  'ALTSTORE_AUTO_REFRESH_WIFI_WAIT_RETRIES'
] as const;

const SIDELINK_KEYS = [
  'SIDELINK_UPLOAD_DIR',
  'SIDELINK_DB_PATH',
  'SIDELINK_MODE',
  'SIDELINK_AUTH_COOKIE_NAME',
  'SIDELINK_SESSION_TTL_HOURS',
  'SIDELINK_HELPER_PROJECT_DIR',
  'SIDELINK_HELPER_IPA_PATH',
  'SIDELINK_HELPER_BUNDLE_ID',
  'SIDELINK_HELPER_DISPLAY_NAME',
  'SIDELINK_HELPER_API_TOKEN',
  'SIDELINK_AUTO_REFRESH_THRESHOLD_HOURS',
  'SIDELINK_AUTO_REFRESH_INITIAL_BACKOFF_MINUTES',
  'SIDELINK_AUTO_REFRESH_MAX_BACKOFF_MINUTES',
  'SIDELINK_AUTO_REFRESH_WIFI_WAIT_RETRIES'
] as const;

describe('legacy ALTSTORE_* environment compatibility', () => {
  test('uses ALTSTORE_* values when SIDELINK_* keys are unset', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidelink-env-compat-'));

    const oldValues = new Map<string, string | undefined>();
    [...LEGACY_KEYS, ...SIDELINK_KEYS].forEach((key) => oldValues.set(key, process.env[key]));

    SIDELINK_KEYS.forEach((key) => {
      delete process.env[key];
    });

    process.env.ALTSTORE_UPLOAD_DIR = path.join(tempRoot, 'legacy-uploads');
    process.env.ALTSTORE_DB_PATH = path.join(tempRoot, 'legacy.sqlite');
    process.env.ALTSTORE_MODE = 'real';
    process.env.ALTSTORE_AUTH_COOKIE_NAME = 'legacy_cookie';
    process.env.ALTSTORE_SESSION_TTL_HOURS = '36';
    process.env.ALTSTORE_HELPER_PROJECT_DIR = path.join(tempRoot, 'legacy-helper-project');
    process.env.ALTSTORE_HELPER_IPA_PATH = path.join(tempRoot, 'legacy-helper.ipa');
    process.env.ALTSTORE_HELPER_BUNDLE_ID = 'com.legacy.helper';
    process.env.ALTSTORE_HELPER_DISPLAY_NAME = 'Legacy Helper';
    process.env.ALTSTORE_HELPER_API_TOKEN = 'legacy-token';
    process.env.ALTSTORE_AUTO_REFRESH_THRESHOLD_HOURS = '40';
    process.env.ALTSTORE_AUTO_REFRESH_INITIAL_BACKOFF_MINUTES = '10';
    process.env.ALTSTORE_AUTO_REFRESH_MAX_BACKOFF_MINUTES = '600';
    process.env.ALTSTORE_AUTO_REFRESH_WIFI_WAIT_RETRIES = '4';

    let context: ReturnType<typeof createAppContext> | undefined;

    try {
      context = createAppContext();

      expect(context.config.uploadDir).toBe(process.env.ALTSTORE_UPLOAD_DIR);
      expect(context.config.dbPath).toBe(process.env.ALTSTORE_DB_PATH);
      expect(context.config.defaultMode).toBe('real');
      expect(context.config.authCookieName).toBe('legacy_cookie');
      expect(context.config.authSessionTtlHours).toBe(36);
      expect(context.config.helperProjectDir).toBe(process.env.ALTSTORE_HELPER_PROJECT_DIR);
      expect(context.config.helperIpaPath).toBe(process.env.ALTSTORE_HELPER_IPA_PATH);
      expect(context.config.helperBundleId).toBe('com.legacy.helper');
      expect(context.config.helperDisplayName).toBe('Legacy Helper');
      expect(context.config.helperToken).toBe('legacy-token');
      expect(context.config.autoRefreshThresholdHours).toBe(40);
      expect(context.config.autoRefreshInitialBackoffMinutes).toBe(10);
      expect(context.config.autoRefreshMaxBackoffMinutes).toBe(600);
      expect(context.config.autoRefreshWifiWaitRetries).toBe(4);
    } finally {
      context?.shutdown();

      [...LEGACY_KEYS, ...SIDELINK_KEYS].forEach((key) => {
        const oldValue = oldValues.get(key);
        if (oldValue === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = oldValue;
        }
      });
    }
  });
});
