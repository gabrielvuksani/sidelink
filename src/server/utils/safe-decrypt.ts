// ─── Safe decrypt ────────────────────────────────────────────────────
// Wrap an AES-GCM decrypt call with a structured error. The raw node:crypto
// error — "Unsupported state or unable to authenticate data" — is produced
// by AES-GCM on auth-tag mismatch and is extremely hard to debug in situ
// because it never says which record failed. With `safeDecrypt` the caller
// annotates the decrypt site with a record type + id + field and re-throws
// a `DecryptContextError` whose message identifies exactly what couldn't
// be decrypted.
//
// Callers may opt into a non-throwing variant (`tryDecrypt`) when they want
// to skip or quarantine an unrecoverable record rather than crash the
// surrounding operation.

import type { EncryptionProvider } from '../types';

export interface DecryptContext {
  /** Kind of record being decrypted, e.g. `'certificate'`, `'apple-account'`. */
  kind: string;
  /** Record identifier, for log + DB cleanup cross-reference. */
  id?: string;
  /** The specific field being decrypted, e.g. `'privateKeyPem'`. */
  field?: string;
}

export class DecryptContextError extends Error {
  readonly kind: string;
  readonly recordId?: string;
  readonly field?: string;
  readonly cause?: unknown;

  constructor(context: DecryptContext, cause: unknown) {
    const location = [
      context.kind,
      context.id ? `id=${context.id}` : null,
      context.field ? `field=${context.field}` : null,
    ].filter(Boolean).join(' ');
    const inner = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to decrypt ${location}: ${inner}. ` +
      'This typically means the OS keychain returned a different master key ' +
      'than the one used to encrypt this record. Check the master-key fingerprint ' +
      'at <dataDir>/.master-key.fp; the server refuses to start on fingerprint ' +
      'mismatch, so seeing this error at runtime usually indicates a stale row ' +
      'that survived a prior manual key change.',
    );
    this.name = 'DecryptContextError';
    this.kind = context.kind;
    this.recordId = context.id;
    this.field = context.field;
    this.cause = cause;
  }
}

export function safeDecrypt(
  encryption: EncryptionProvider,
  ciphertext: string,
  context: DecryptContext,
): string {
  try {
    return encryption.decrypt(ciphertext);
  } catch (err) {
    throw new DecryptContextError(context, err);
  }
}

/**
 * Non-throwing variant. Returns `null` on decryption failure so the caller
 * can decide whether to skip the record, fall back to a default, or
 * surface a user-visible warning.
 */
export function tryDecrypt(
  encryption: EncryptionProvider,
  ciphertext: string,
  context: DecryptContext,
): { ok: true; value: string } | { ok: false; error: DecryptContextError } {
  try {
    return { ok: true, value: encryption.decrypt(ciphertext) };
  } catch (err) {
    return { ok: false, error: new DecryptContextError(context, err) };
  }
}
