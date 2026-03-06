// ─── Security Middleware ──────────────────────────────────────────────
// Rate limiting, brute-force protection, and request sanitization.
// Zero external dependencies — uses in-memory token bucket.

import type { Request, Response, NextFunction } from 'express';

// ── In-memory rate limiter (token bucket) ────────────────────────────

interface BucketEntry {
  tokens: number;
  lastRefill: number;
}

interface RateLimiterOptions {
  /** Max tokens (requests) per window */
  maxTokens: number;
  /** Refill rate: tokens per second */
  refillRate: number;
  /** Response message when rate limited */
  message?: string;
  /** Key extractor (default: IP address) */
  keyFn?: (req: Request) => string;
}

/**
 * Create a rate-limiting middleware using the token bucket algorithm.
 * Each unique key (default: IP) gets its own bucket.
 */
export function rateLimit(opts: RateLimiterOptions) {
  const { maxTokens, refillRate, message = 'Too many requests, please try again later' } = opts;
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown');
  const buckets = new Map<string, BucketEntry>();

  // Periodic cleanup to prevent memory leaks
  const CLEANUP_INTERVAL = 60_000;
  const STALE_THRESHOLD = 300_000; // 5 min
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (now - entry.lastRefill > STALE_THRESHOLD) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL);
  cleanup.unref(); // Don't prevent process exit

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();

    let entry = buckets.get(key);
    if (!entry) {
      entry = { tokens: maxTokens, lastRefill: now };
      buckets.set(key, entry);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - entry.lastRefill) / 1000;
    entry.tokens = Math.min(maxTokens, entry.tokens + elapsed * refillRate);
    entry.lastRefill = now;

    if (entry.tokens < 1) {
      const retryAfter = Math.ceil((1 - entry.tokens) / refillRate);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ ok: false, error: message });
    }

    entry.tokens -= 1;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', String(maxTokens));
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(entry.tokens)));

    next();
  };
}

// ── Pre-configured limiters ──────────────────────────────────────────

/** Auth endpoints: 20 attempts per minute */
export const authRateLimit = rateLimit({
  maxTokens: 20,
  refillRate: 20 / 60,  // 20 tokens per 60 seconds
  message: 'Too many authentication attempts. Please wait a minute.',
});

/** Apple sign-in: 5 attempts per minute (they hit Apple's servers) */
export const appleAuthRateLimit = rateLimit({
  maxTokens: 5,
  refillRate: 5 / 60,
  message: 'Too many Apple sign-in attempts. Please wait a minute.',
});

/** File upload: 10 per 5 minutes */
export const uploadRateLimit = rateLimit({
  maxTokens: 10,
  refillRate: 10 / 300,
  message: 'Too many uploads. Please wait before uploading again.',
});

/** General API: 120 requests per minute */
export const generalRateLimit = rateLimit({
  maxTokens: 120,
  refillRate: 120 / 60,
  message: 'Rate limit exceeded. Please slow down.',
});

// ── Input sanitization helpers ───────────────────────────────────────

/**
 * Sanitize string input: trim, remove null bytes, limit length.
 */
export function sanitizeString(input: unknown, maxLength = 1000): string | undefined {
  if (typeof input !== 'string') return undefined;
  return input
    .trim()
    .replace(/\0/g, '')  // Remove null bytes
    .slice(0, maxLength);
}

/**
 * Validate that a string looks like an email address.
 */
export function isValidEmail(input: string): boolean {
  // Simple but effective email regex — not RFC 5322 compliant, but good enough
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) && input.length <= 254;
}

/**
 * Validate a UUID v4 string.
 */
export function isValidUUID(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}

/**
 * Validate a UDID (40 hex chars for classic, or UUID format for newer devices).
 */
export function isValidUDID(input: string): boolean {
  return /^[0-9a-fA-F]{40}$/.test(input) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{16}$/.test(input);
}


// CSRF Protection (double-submit cookie)
import crypto from 'node:crypto';
interface CsrfOptions { skipPaths?: string[] }
export function csrfProtection(opts: CsrfOptions = {}) {
  if (process.env.NODE_ENV === 'test') return (_req: Request, _res: Response, next: NextFunction) => next();
  const skip = (opts.skipPaths ?? []).map(path => normalizePath(path));
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.cookies || !req.cookies._csrf) {
      const token = crypto.randomBytes(24).toString('base64url');
      res.cookie('_csrf', token, { sameSite: 'strict', path: '/' });
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const requestPaths = [req.path, req.baseUrl + req.path, req.originalUrl]
      .map(path => normalizePath(path));
    if (requestPaths.some(path => skip.some(skipPath => path === skipPath || path.startsWith(skipPath + '/')))) {
      return next();
    }
    const cookieToken = req.cookies._csrf as string | undefined;
    const headerToken = req.headers['x-csrf-token'] as string | undefined;
    if (!cookieToken || !headerToken ||
        cookieToken.length !== headerToken.length ||
        !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
      return res.status(403).json({ ok: false, error: 'CSRF token mismatch' });
    }
    next();
  };
}

function normalizePath(path: string): string {
  const withoutQuery = path.split('?')[0] ?? path;
  return withoutQuery.replace(/\/+$/, '') || '/';
}
