import crypto from 'node:crypto';
import type { AppContext } from '../context';

const PAIRING_CODE_KEY = 'helper_pairing_code_sha256';
const PAIRING_EXPIRES_KEY = 'helper_pairing_expires_at';
const HELPER_TOKEN_KEY = 'helper_token';

const CODE_TTL_MS = 10 * 60 * 1000;

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function createToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function getHelperToken(ctx: AppContext): string | null {
  return ctx.db.getSetting(HELPER_TOKEN_KEY) ?? process.env.SIDELINK_HELPER_TOKEN ?? null;
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
  ctx.db.setSetting(HELPER_TOKEN_KEY, token);

  // One-time use code.
  ctx.db.setSetting(PAIRING_CODE_KEY, hashCode(createToken()));
  ctx.db.setSetting(PAIRING_EXPIRES_KEY, new Date().toISOString());

  return { token };
}
