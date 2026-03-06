// ─── Paths Utility Tests ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// We test the pure functions from paths.ts
// Some need process.platform mocking which we handle carefully

describe('paths utility', () => {
  let pathsMod: typeof import('../src/server/utils/paths');

  beforeEach(async () => {
    // Fresh import each time
    vi.resetModules();
    pathsMod = await import('../src/server/utils/paths');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isPackaged', () => {
    it('returns false in test environment (no resources path)', () => {
      expect(pathsMod.isPackaged()).toBe(false);
    });
  });

  describe('hasBundledPython', () => {
    it('returns false when python binary does not exist', () => {
      // In test environment, no bundled python
      expect(pathsMod.hasBundledPython()).toBe(false);
    });
  });

  describe('getPlatformDisplayName', () => {
    it('returns a non-empty string', () => {
      const name = pathsMod.getPlatformDisplayName();
      expect(name).toBeTruthy();
      expect(typeof name).toBe('string');
    });

    it('contains platform info', () => {
      const name = pathsMod.getPlatformDisplayName();
      // Should contain one of the known platform names
      expect(name).toMatch(/macOS|Windows|Linux|darwin|win32|linux/i);
    });
  });

  describe('getDefaultDataDir', () => {
    it('returns a non-empty absolute path', () => {
      const dir = pathsMod.getDefaultDataDir();
      expect(dir).toBeTruthy();
      expect(path.isAbsolute(dir)).toBe(true);
    });

    it('respects SIDELINK_DATA_DIR environment variable', () => {
      const original = process.env.SIDELINK_DATA_DIR;
      process.env.SIDELINK_DATA_DIR = '/tmp/test-sidelink';
      try {
        // Re-import to pick up env var
        // Note: since getDefaultDataDir reads env at call time, this should work
        const dir = pathsMod.getDefaultDataDir();
        expect(dir).toBe(path.resolve('/tmp/test-sidelink'));
      } finally {
        if (original !== undefined) process.env.SIDELINK_DATA_DIR = original;
        else delete process.env.SIDELINK_DATA_DIR;
      }
    });
  });

  describe('ensureDir', () => {
    it('creates and returns the directory path', async () => {
      const fs = await import('node:fs');
      const os = await import('node:os');
      const tmpDir = path.join(os.tmpdir(), `sidelink-test-${Date.now()}`);

      try {
        pathsMod.ensureDir(tmpDir);
        expect(fs.existsSync(tmpDir)).toBe(true);
      } finally {
        // Cleanup
        try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
      }
    });

    it('is idempotent (calling twice is fine)', () => {
      const fs = require('node:fs') as typeof import('node:fs');
      const os = require('node:os') as typeof import('node:os');
      const tmpDir = path.join(os.tmpdir(), `sidelink-test2-${Date.now()}`);

      try {
        pathsMod.ensureDir(tmpDir);
        pathsMod.ensureDir(tmpDir); // Should not throw
        expect(fs.existsSync(tmpDir)).toBe(true);
      } finally {
        try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
      }
    });
  });
});
