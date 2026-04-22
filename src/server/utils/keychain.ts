// ─── OS Keychain Integration ────────────────────────────────────────
// Uses the OS-level credential store for encryption key management.
// Falls back to the existing AES-256-GCM encryption with improved
// key derivation when keytar is unavailable.
//
// - macOS: Keychain Services
// - Windows: Credential Manager (DPAPI)
// - Linux: libsecret (GNOME Keyring / KWallet)
//
// ─── Fingerprint Sentinel ────────────────────────────────────────────
// Silent master-key drift — keychain returns a different value than the
// one that encrypted the data on disk — produces AES-GCM "Unsupported
// state or unable to authenticate data" errors mid-pipeline, which are
// extremely hard to debug in situ. To catch this at startup, we hash
// the active master key and persist the hash alongside the encrypted
// data as `<dataDir>/.master-key.fp`. On every subsequent boot the hash
// is recomputed from the currently-resolved key and compared to the
// on-disk fingerprint. A mismatch means either (a) the keychain entry
// was rotated or lost, or (b) the dataDir was copied from another
// machine. Either way we fail fast with a clear remediation message
// rather than let the pipeline crash downstream.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EncryptionProvider } from '../types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEYTAR_TIMEOUT_MS = 15_000;
const KEYTAR_RETRY_COUNT = 1;

const SERVICE_NAME = 'com.sidelink.secrets';
const ACCOUNT_NAME = 'master-key';
const FINGERPRINT_FILENAME = '.master-key.fp';

export class KeyFingerprintMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyFingerprintMismatchError';
  }
}

// ─── Key Management ─────────────────────────────────────────────────

/** Cached master key to avoid repeated keychain reads */
let cachedMasterKey: Buffer | null = null;

/** Track which source produced the cached key — surfaced in error messages. */
let cachedMasterKeySource: 'env' | 'keychain' | 'machine' | null = null;

/**
 * Get or generate the master encryption key.
 *
 * Priority:
 *   1. SIDELINK_ENCRYPTION_KEY env var (explicit override)
 *   2. OS keychain (persistent, secure)
 *   3. Machine-derived key (fallback, deterministic)
 */
async function getMasterKey(): Promise<{ key: Buffer; source: 'env' | 'keychain' | 'machine' }> {
  if (cachedMasterKey && cachedMasterKeySource) {
    return { key: cachedMasterKey, source: cachedMasterKeySource };
  }

  if (process.env.SIDELINK_DISABLE_KEYCHAIN === '1'
    || process.env.SIDELINK_SMOKE_TEST === '1'
    || process.env.VITEST) {
    const key = deriveMachineKey();
    cachedMasterKey = key;
    cachedMasterKeySource = 'machine';
    return { key, source: 'machine' };
  }

  // 1. Explicit env override
  const envKey = process.env.SIDELINK_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 16) {
    const key = crypto.createHash('sha256').update(envKey).digest();
    cachedMasterKey = key;
    cachedMasterKeySource = 'env';
    return { key, source: 'env' };
  }

  // 2. Try OS keychain via keytar (with retry + extended timeout)
  for (let attempt = 0; attempt <= KEYTAR_RETRY_COUNT; attempt++) {
    try {
      const keytar = await loadKeytar();
      if (!keytar) break;

      const stored = await withKeytarTimeout(
        keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME),
        'getPassword',
      );
      if (stored) {
        const key = Buffer.from(stored, 'hex');
        cachedMasterKey = key;
        cachedMasterKeySource = 'keychain';
        return { key, source: 'keychain' };
      }

      // Generate a new random key and store it
      const newKey = crypto.randomBytes(32);
      await withKeytarTimeout(
        keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, newKey.toString('hex')),
        'setPassword',
      );
      cachedMasterKey = newKey;
      cachedMasterKeySource = 'keychain';
      console.log('[KEYCHAIN] Generated and stored new master key in OS keychain');
      return { key: newKey, source: 'keychain' };
    } catch (err) {
      const last = attempt === KEYTAR_RETRY_COUNT;
      console.warn(
        `[KEYCHAIN] keytar attempt ${attempt + 1} failed${last ? ' — falling back to machine-derived key' : ', retrying...'}:`,
        String(err).slice(0, 200),
      );
      if (last) break;
    }
  }

  // 3. Fallback: machine-derived key with improved derivation
  const key = deriveMachineKey();
  cachedMasterKey = key;
  cachedMasterKeySource = 'machine';
  return { key, source: 'machine' };
}

/**
 * Synchronous getter for the master key (for use in createEncryptionProvider).
 * Must call initKeychain() first.
 */
function getMasterKeySync(): Buffer {
  if (!cachedMasterKey) {
    // Synchronous fallback — uses machine-derived key
    cachedMasterKey = deriveMachineKey();
    cachedMasterKeySource = 'machine';
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

function withKeytarTimeout<T>(operation: Promise<T>, action: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`keytar ${action} timed out after ${KEYTAR_TIMEOUT_MS}ms`));
    }, KEYTAR_TIMEOUT_MS);
    timer.unref();

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function loadKeytar(): Promise<KeytarLike | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const keytar = require('keytar') as KeytarLike;
    return keytar;
  } catch {
    return null;
  }
}

// ─── Fingerprint sentinel ───────────────────────────────────────────

function computeFingerprint(key: Buffer, source: string): string {
  // Include the source in the fingerprint so a keychain→machine fallback
  // can't silently be mistaken for a valid key swap.
  return crypto.createHash('sha256')
    .update('sidelink-key-fp-v1')
    .update(source)
    .update(key)
    .digest('hex');
}

/**
 * Verify (or write) the master-key fingerprint at `<dataDir>/.master-key.fp`.
 *
 * On first run the file is created. On every subsequent run the stored
 * fingerprint must match the one derived from the currently-resolved
 * master key — otherwise the caller gets a `KeyFingerprintMismatchError`
 * with a clear remediation, BEFORE the pipeline has a chance to try
 * decrypting anything.
 */
function verifyOrPersistFingerprint(dataDir: string | null, key: Buffer, source: string): void {
  if (!dataDir) return; // No data dir context (tests, smoke runs) → skip.
  const fpPath = path.join(dataDir, FINGERPRINT_FILENAME);
  const current = computeFingerprint(key, source);

  let existing: string | null = null;
  try {
    existing = fs.readFileSync(fpPath, 'utf8').trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  if (existing === null) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(fpPath, current, { mode: 0o600 });
    } catch (err) {
      console.warn('[KEYCHAIN] Could not persist master-key fingerprint:', (err as Error).message);
    }
    return;
  }

  if (existing !== current) {
    throw new KeyFingerprintMismatchError(
      [
        'Master encryption key does not match the fingerprint recorded at',
        `  ${fpPath}`,
        '',
        'The data in this SideLink data directory was encrypted by a different key',
        'than the one your OS keychain (or SIDELINK_ENCRYPTION_KEY env var) currently',
        'returns. This typically happens when:',
        '  • The macOS / Windows / Linux keychain entry was deleted or changed',
        '  • The data dir was copied from another machine',
        '  • A previous run fell back to a machine-derived key (no keychain)',
        '',
        `Current key source: ${source}`,
        '',
        'To recover:',
        '  1. Restore the original keychain entry (preferred), OR',
        '  2. Set SIDELINK_ENCRYPTION_KEY to a previously-working secret and restart, OR',
        '  3. Wipe the data directory to start fresh — this will lose installed-app',
        '     records, Apple sessions, and saved certificates:',
        `       rm -rf "${dataDir}"`,
        '',
        'Refusing to start so the pipeline does not fail mid-flight.',
      ].join('\n'),
    );
  }
}

// ─── Initialization ─────────────────────────────────────────────────

/**
 * Initialize the keychain and cache the master key.
 *
 * Pass `dataDir` to activate the fingerprint sentinel. On first run the
 * fingerprint file is created; on subsequent runs a mismatch throws
 * `KeyFingerprintMismatchError` before any pipeline code runs.
 */
export async function initKeychain(dataDir?: string): Promise<void> {
  const { key, source } = await getMasterKey();
  verifyOrPersistFingerprint(dataDir ?? null, key, source);
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
