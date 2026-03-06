// ─── Encryption Utilities ────────────────────────────────────────────
// AES-256-GCM encryption for at-rest secrets (private keys, session tokens).
//
// This module now delegates to the keychain module for improved security.
// The legacy functions are kept for backward compatibility during migration.

import crypto from 'node:crypto';
import os from 'node:os';
import type { EncryptionProvider } from '../types';

// Re-export new keychain-backed provider
export {
  createKeychainEncryptionProvider,
  initKeychain,
  createLegacyEncryptionProvider,
  deriveLegacyKey,
  migrateEncryptedValue,
} from './keychain';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Creates an EncryptionProvider using AES-256-GCM.
 * The key is derived from the provided secret using SHA-256.
 *
 * @deprecated Use createKeychainEncryptionProvider() for new installations.
 */
export function createEncryptionProvider(secret: string): EncryptionProvider {
  // Derive a 32-byte key from the secret
  const key = crypto.createHash('sha256').update(secret).digest();

  return {
    encrypt(plaintext: string): string {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);

      const tag = cipher.getAuthTag();

      // Format: base64(iv + tag + ciphertext)
      const combined = Buffer.concat([iv, tag, encrypted]);
      return combined.toString('base64');
    },

    decrypt(ciphertext: string): string {
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

/**
 * Derive a machine-local encryption key.
 * Uses hostname + username as seed (stable across reboots, unique per machine).
 * Can be overridden via SIDELINK_ENCRYPTION_KEY env var.
 *
 * @deprecated Use the keychain-backed provider which uses PBKDF2 with 100k iterations.
 */
export function deriveEncryptionKey(): string {
  const envKey = process.env.SIDELINK_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 16) return envKey;

  const seed = `sidelink:${os.hostname()}:${os.userInfo().username}:machine-key`;
  return crypto.createHash('sha256').update(seed).digest('hex');
}
