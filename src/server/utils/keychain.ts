// ─── OS Keychain Integration ────────────────────────────────────────
// Uses the OS-level credential store for encryption key management.
// Falls back to the existing AES-256-GCM encryption with improved
// key derivation when keytar is unavailable.
//
// - macOS: Keychain Services
// - Windows: Credential Manager (DPAPI)
// - Linux: libsecret (GNOME Keyring / KWallet)

import crypto from 'node:crypto';
import os from 'node:os';
import type { EncryptionProvider } from '../types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

const SERVICE_NAME = 'com.sidelink.secrets';
const ACCOUNT_NAME = 'master-key';

// ─── Key Management ─────────────────────────────────────────────────

/** Cached master key to avoid repeated keychain reads */
let cachedMasterKey: Buffer | null = null;

/**
 * Get or generate the master encryption key.
 *
 * Priority:
 *   1. SIDELINK_ENCRYPTION_KEY env var (explicit override)
 *   2. OS keychain (persistent, secure)
 *   3. Machine-derived key (fallback, deterministic)
 */
async function getMasterKey(): Promise<Buffer> {
  if (cachedMasterKey) return cachedMasterKey;

  // 1. Explicit env override
  const envKey = process.env.SIDELINK_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 16) {
    const key = crypto.createHash('sha256').update(envKey).digest();
    cachedMasterKey = key;
    return key;
  }

  // 2. Try OS keychain via keytar
  try {
    const keytar = await loadKeytar();
    if (keytar) {
      const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (stored) {
        cachedMasterKey = Buffer.from(stored, 'hex');
        return cachedMasterKey;
      }

      // Generate a new random key and store it
      const newKey = crypto.randomBytes(32);
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, newKey.toString('hex'));
      cachedMasterKey = newKey;
      console.log('[KEYCHAIN] Generated and stored new master key in OS keychain');
      return newKey;
    }
  } catch (err) {
    console.warn('[KEYCHAIN] OS keychain unavailable, using fallback key derivation:', String(err).slice(0, 100));
  }

  // 3. Fallback: machine-derived key with improved derivation
  const key = deriveMachineKey();
  cachedMasterKey = key;
  return key;
}

/**
 * Synchronous getter for the master key (for use in createEncryptionProvider).
 * Must call initKeychain() first.
 */
function getMasterKeySync(): Buffer {
  if (!cachedMasterKey) {
    // Synchronous fallback — uses machine-derived key
    cachedMasterKey = deriveMachineKey();
  }
  return cachedMasterKey;
}

/**
 * Derive a machine-local encryption key with improved key stretching.
 * Uses PBKDF2 with 100,000 iterations (versus old single SHA-256).
 */
function deriveMachineKey(): Buffer {
  const seed = `sidelink:${os.hostname()}:${os.userInfo().username}:machine-key`;
  // Use PBKDF2 for proper key stretching
  return crypto.pbkdf2Sync(seed, 'sidelink-salt-v2', 100_000, 32, 'sha256');
}

/**
 * Dynamically load keytar (optional dependency).
 * Returns null if keytar is not installed.
 */
interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

async function loadKeytar(): Promise<KeytarLike | null> {
  try {
    // keytar is an optional dependency — may not be installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const keytar = require('keytar') as KeytarLike;
    return keytar;
  } catch {
    return null;
  }
}

// ─── Initialization ─────────────────────────────────────────────────

/**
 * Initialize the keychain and cache the master key.
 * Call this during app startup (async context).
 */
export async function initKeychain(): Promise<void> {
  await getMasterKey();
}

// ─── Encryption Provider ────────────────────────────────────────────

/**
 * Create an EncryptionProvider backed by the OS keychain.
 * Must call initKeychain() before first use for async key resolution.
 * Falls back to synchronous machine-derived key if not initialized.
 */
export function createKeychainEncryptionProvider(): EncryptionProvider {
  return {
    encrypt(plaintext: string): string {
      const key = getMasterKeySync();
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);

      const tag = cipher.getAuthTag();
      const combined = Buffer.concat([iv, tag, encrypted]);
      return combined.toString('base64');
    },

    decrypt(ciphertext: string): string {
      const key = getMasterKeySync();
      const combined = Buffer.from(ciphertext, 'base64');

      const iv = combined.subarray(0, IV_LENGTH);
      const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    },
  };
}

// ─── Legacy Compatibility ───────────────────────────────────────────

/**
 * The old encryption provider (kept for migration).
 * Uses a provided secret with single SHA-256 (weak).
 */
export function createLegacyEncryptionProvider(secret: string): EncryptionProvider {
  const key = crypto.createHash('sha256').update(secret).digest();

  return {
    encrypt(plaintext: string): string {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]).toString('base64');
    },

    decrypt(ciphertext: string): string {
      const combined = Buffer.from(ciphertext, 'base64');
      const iv = combined.subarray(0, IV_LENGTH);
      const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    },
  };
}

/**
 * Derive a legacy encryption key (for migration from old DB format).
 */
export function deriveLegacyKey(): string {
  const envKey = process.env.SIDELINK_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 16) return envKey;
  const seed = `sidelink:${os.hostname()}:${os.userInfo().username}:machine-key`;
  return crypto.createHash('sha256').update(seed).digest('hex');
}

/**
 * Attempt to migrate encrypted values from legacy to new encryption.
 * Tries to decrypt with legacy provider, re-encrypts with new provider.
 * Returns the re-encrypted value, or the original if migration fails.
 */
export function migrateEncryptedValue(
  encryptedValue: string,
  legacyProvider: EncryptionProvider,
  newProvider: EncryptionProvider,
): string {
  try {
    const plaintext = legacyProvider.decrypt(encryptedValue);
    return newProvider.encrypt(plaintext);
  } catch {
    // Value may already be encrypted with new provider, or is invalid
    return encryptedValue;
  }
}
