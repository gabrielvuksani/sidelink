// ─── Crypto & Keychain Tests ──────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';

// ─── createEncryptionProvider (Legacy AES-256-GCM) ──────────────────

describe('createEncryptionProvider (legacy)', () => {
  let createEncryptionProvider: typeof import('../src/server/utils/crypto').createEncryptionProvider;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/server/utils/crypto');
    createEncryptionProvider = mod.createEncryptionProvider;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encrypts and decrypts a string round-trip', () => {
    const provider = createEncryptionProvider('test-secret-key-123');
    const plaintext = 'Hello, Sidelink! 🔐';
    const encrypted = provider.encrypt(plaintext);
    const decrypted = provider.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces base64-encoded ciphertext', () => {
    const provider = createEncryptionProvider('my-secret');
    const encrypted = provider.encrypt('test');
    // Should be valid base64
    expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
    const buf = Buffer.from(encrypted, 'base64');
    // iv (16) + tag (16) + at least 1 byte ciphertext
    expect(buf.length).toBeGreaterThanOrEqual(33);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const provider = createEncryptionProvider('my-secret');
    const a = provider.encrypt('same');
    const b = provider.encrypt('same');
    expect(a).not.toBe(b);
  });

  it('fails to decrypt with wrong key', () => {
    const provider1 = createEncryptionProvider('key-one');
    const provider2 = createEncryptionProvider('key-two');
    const encrypted = provider1.encrypt('secret data');
    expect(() => provider2.decrypt(encrypted)).toThrow();
  });

  it('fails on tampered ciphertext', () => {
    const provider = createEncryptionProvider('my-secret');
    const encrypted = provider.encrypt('sensitive');
    const buf = Buffer.from(encrypted, 'base64');
    // Flip a byte in the ciphertext area
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => provider.decrypt(tampered)).toThrow();
  });

  it('handles empty string', () => {
    const provider = createEncryptionProvider('my-secret');
    const encrypted = provider.encrypt('');
    expect(provider.decrypt(encrypted)).toBe('');
  });

  it('handles long plaintext', () => {
    const provider = createEncryptionProvider('my-secret');
    const longText = 'x'.repeat(100_000);
    const encrypted = provider.encrypt(longText);
    expect(provider.decrypt(encrypted)).toBe(longText);
  });

  it('handles unicode / emoji text', () => {
    const provider = createEncryptionProvider('my-secret');
    const text = '你好世界 🌍 مرحبا';
    const encrypted = provider.encrypt(text);
    expect(provider.decrypt(encrypted)).toBe(text);
  });
});

// ─── deriveEncryptionKey (Legacy) ────────────────────────────────────

describe('deriveEncryptionKey (legacy)', () => {
  let deriveEncryptionKey: typeof import('../src/server/utils/crypto').deriveEncryptionKey;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/server/utils/crypto');
    deriveEncryptionKey = mod.deriveEncryptionKey;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SIDELINK_ENCRYPTION_KEY;
  });

  it('returns a 64-character hex string by default', () => {
    const key = deriveEncryptionKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic (same machine, same result)', () => {
    const a = deriveEncryptionKey();
    const b = deriveEncryptionKey();
    expect(a).toBe(b);
  });

  it('uses SIDELINK_ENCRYPTION_KEY env var when set', () => {
    process.env.SIDELINK_ENCRYPTION_KEY = 'my-custom-key-that-is-long-enough';
    const key = deriveEncryptionKey();
    expect(key).toBe('my-custom-key-that-is-long-enough');
  });

  it('ignores short env var', () => {
    process.env.SIDELINK_ENCRYPTION_KEY = 'short'; // < 16 chars
    const key = deriveEncryptionKey();
    // Should fall back to machine-derived key
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Keychain Functions ─────────────────────────────────────────────

describe('keychain', () => {
  let keychain: typeof import('../src/server/utils/keychain');

  beforeEach(async () => {
    vi.resetModules();
    keychain = await import('../src/server/utils/keychain');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createKeychainEncryptionProvider', () => {
    it('encrypts and decrypts round-trip', () => {
      const provider = keychain.createKeychainEncryptionProvider();
      const plaintext = 'keychain-protected-data';
      const encrypted = provider.encrypt(plaintext);
      expect(provider.decrypt(encrypted)).toBe(plaintext);
    });

    it('produces different ciphertext each time (random IV)', () => {
      const provider = keychain.createKeychainEncryptionProvider();
      const a = provider.encrypt('data');
      const b = provider.encrypt('data');
      expect(a).not.toBe(b);
    });

    it('fails with tampered data', () => {
      const provider = keychain.createKeychainEncryptionProvider();
      const encrypted = provider.encrypt('secure');
      const buf = Buffer.from(encrypted, 'base64');
      buf[20] ^= 0xff; // Tamper with tag or ciphertext
      expect(() => provider.decrypt(buf.toString('base64'))).toThrow();
    });
  });

  describe('createLegacyEncryptionProvider', () => {
    it('encrypts and decrypts round-trip', () => {
      const provider = keychain.createLegacyEncryptionProvider('legacy-secret');
      const encrypted = provider.encrypt('old-data');
      expect(provider.decrypt(encrypted)).toBe('old-data');
    });
  });

  describe('deriveLegacyKey', () => {
    it('returns a 64-character hex string', () => {
      const key = keychain.deriveLegacyKey();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic', () => {
      const a = keychain.deriveLegacyKey();
      const b = keychain.deriveLegacyKey();
      expect(a).toBe(b);
    });
  });

  describe('migrateEncryptedValue', () => {
    it('migrates from legacy to new provider', () => {
      const legacy = keychain.createLegacyEncryptionProvider('old-key');
      const newProv = keychain.createKeychainEncryptionProvider();

      const encrypted = legacy.encrypt('migrate-me');
      const migrated = keychain.migrateEncryptedValue(encrypted, legacy, newProv);

      // Should be decryptable by new provider
      expect(newProv.decrypt(migrated)).toBe('migrate-me');
    });

    it('returns original value if migration fails', () => {
      const legacy = keychain.createLegacyEncryptionProvider('wrong-key');
      const newProv = keychain.createKeychainEncryptionProvider();

      // Encrypt with a different key than what legacy expects
      const otherProvider = keychain.createLegacyEncryptionProvider('other-key');
      const encrypted = otherProvider.encrypt('data');

      // Migration should fail silently and return original
      const result = keychain.migrateEncryptedValue(encrypted, legacy, newProv);
      expect(result).toBe(encrypted);
    });
  });

  describe('initKeychain', () => {
    it('completes without error', async () => {
      // Should not throw even without keytar installed
      await expect(keychain.initKeychain()).resolves.toBeUndefined();
    });
  });
});
