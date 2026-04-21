import crypto from 'node:crypto';
import type { AppContext } from '../context';

const PAIRING_CODE_KEY = 'helper_pairing_code_sha256';
const PAIRING_EXPIRES_KEY = 'helper_pairing_expires_at';
// Historical storage of the raw helper token — kept so existing deployments
// keep authenticating. `HELPER_TOKEN_HASH_KEY` is the new, hashed form.
const HELPER_TOKEN_KEY = 'helper_token';
const HELPER_TOKEN_HASH_KEY = 'helper_token_sha256';
const HELPER_PAIRED_AT_KEY = 'helper_paired_at';

const CODE_TTL_MS = 60_000;

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function createToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Return the SHA-256 of the currently authorised helper token, or null
 * if pairing has not happened yet. The raw token never leaves the
 * pairing flow — the middleware authenticates by re-hashing the
 * inbound header and comparing hashes with timingSafeEqual.
 *
 * During migration: if only the legacy plaintext token setting exists,
 * we transparently hash it once and persist the hashed form. That way
 * existing paired iOS helpers keep working across the upgrade without
 * user action.
 */
export function getHelperTokenHash(ctx: AppContext): string | null {
  const stored = ctx.db.getSetting(HELPER_TOKEN_HASH_KEY);
  if (stored) return stored;

  const legacyPlain = ctx.db.getSetting(HELPER_TOKEN_KEY);
  if (legacyPlain) {
    const hashed = hashCode(legacyPlain);
    ctx.db.setSetting(HELPER_TOKEN_HASH_KEY, hashed);
    // Best-effort wipe of the legacy plaintext row.
    ctx.db.setSetting(HELPER_TOKEN_KEY, '');
    return hashed;
  }

  const envToken = process.env.SIDELINK_HELPER_TOKEN?.trim();
  if (envToken) return hashCode(envToken);

  return null;
}

/**
 * Timing-safe check that the raw token from the `x-sidelink-helper-token`
 * header corresponds to the currently-paired helper. Returns false for
 * any shape mismatch, including empty tokens or unpaired state.
 */
export function verifyHelperToken(ctx: AppContext, presentedToken: string | null | undefined): boolean {
  if (!presentedToken || typeof presentedToken !== 'string') return false;
  const expected = getHelperTokenHash(ctx);
  if (!expected) return false;
  const actual = hashCode(presentedToken);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function getHelperTokenSource(ctx: AppContext): 'db' | 'env' | 'none' {
  if (ctx.db.getSetting(HELPER_TOKEN_HASH_KEY) || ctx.db.getSetting(HELPER_TOKEN_KEY)) return 'db';
  if (process.env.SIDELINK_HELPER_TOKEN?.trim()) return 'env';
  return 'none';
}

export function getHelperPairingState(ctx: AppContext): {
  paired: boolean;
  tokenSource: 'db' | 'env' | 'none';
  pairedAt: string | null;
  pairingCodeExpiresAt: string | null;
  pairingCodeActive: boolean;
} {
  const tokenSource = getHelperTokenSource(ctx);
  const expiresAt = ctx.db.getSetting(PAIRING_EXPIRES_KEY);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;

  return {
    paired: getHelperTokenHash(ctx) !== null,
    tokenSource,
    pairedAt: tokenSource === 'db' ? ctx.db.getSetting(HELPER_PAIRED_AT_KEY) : null,
    pairingCodeExpiresAt: expiresAt,
    pairingCodeActive: Number.isFinite(expiresAtMs) && expiresAtMs > Date.now(),
  };
}

export function createPairingCode(ctx: AppContext): { code: string; expiresAt: string; ttlMs: number } {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  ctx.db.setSetting(PAIRING_CODE_KEY, hashCode(code));
  ctx.db.setSetting(PAIRING_EXPIRES_KEY, expiresAt);

  return { code, expiresAt, ttlMs: CODE_TTL_MS };
}

export function consumePairingCode(ctx: AppContext, code: string): { token: string } | null {
  const currentHash = ctx.db.getSetting(PAIRING_CODE_KEY);
  const expiresAt = ctx.db.getSetting(PAIRING_EXPIRES_KEY);
  if (!currentHash || !expiresAt) return null;

  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires) || expires <= Date.now()) {
    return null;
  }

  const incomingHash = hashCode(code);
  if (incomingHash.length !== currentHash.length || !crypto.timingSafeEqual(Buffer.from(incomingHash), Buffer.from(currentHash))) {
    return null;
  }

  const token = createToken();
  // Persist ONLY the hash. The caller returns the raw token to the iOS
  // helper exactly once over the pairing response; a filesystem read of
  // sidelink.sqlite must never surface the bearer.
  ctx.db.setSetting(HELPER_TOKEN_HASH_KEY, hashCode(token));
  // Clear any legacy plaintext row that may have existed on this install.
  ctx.db.setSetting(HELPER_TOKEN_KEY, '');
  ctx.db.setSetting(HELPER_PAIRED_AT_KEY, new Date().toISOString());

  // One-time use code.
  ctx.db.setSetting(PAIRING_CODE_KEY, hashCode(createToken()));
  ctx.db.setSetting(PAIRING_EXPIRES_KEY, new Date().toISOString());

  return { token };
}
