// ─── Auth Service ────────────────────────────────────────────────────
// Local dashboard authentication: admin password, sessions, lockout.
// This is NOT Apple auth — see apple-account-service.ts for that.

import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database } from '../state/database';
import type { LogService } from './log-service';
import { AuthError, LockoutError } from '../utils/errors';
import { LOG_CODES } from '../../shared/constants';
import type { UserSession } from '../../shared/types';

const scryptAsync = promisify(scrypt);
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class AuthService {
  constructor(
    private db: Database,
    private logs: LogService,
  ) {
    this.migrateAuthOnVersionChange();
  }

  /**
   * On startup, compare the stored setup version against the running app version.
   * If the major.minor changed (upgrade or stale dev DB), wipe auth so the
   * onboarding wizard re-appears instead of a login wall.
   *
   * If version detection fails entirely, fall back to checking whether any
   * valid sessions exist — if an admin exists but nobody has ever logged in
   * successfully, treat it as stale state and wipe.
   */
  private migrateAuthOnVersionChange(): void {
    const currentVersion = this.getAppMajorMinor();

    if (currentVersion) {
      const storedVersion = this.db.getSetting('auth_setup_version');

      if (storedVersion === currentVersion) return; // same version — nothing to do

      if (this.isSetupComplete()) {
        this.logs.info(LOG_CODES.ADMIN_LOGIN,
          `App version changed (${storedVersion ?? 'none'} → ${currentVersion}), clearing credentials for fresh setup`);
        this.resetAllUsers();
      }

      this.db.setSetting('auth_setup_version', currentVersion);
      return;
    }

    // Version detection failed — fallback: if admin exists but has no valid
    // sessions, treat as stale (e.g. leftover dev database or corrupted state)
    if (this.isSetupComplete() && !this.hasAnyValidSession()) {
      this.logs.info(LOG_CODES.ADMIN_LOGIN,
        'Version detection failed and no valid sessions exist — clearing stale credentials for fresh setup');
      this.resetAllUsers();
    }
  }

  private hasAnyValidSession(): boolean {
    const now = new Date().toISOString();
    const row = this.db.prepare<[string], { count: number }>(
      'SELECT COUNT(*) as count FROM sessions WHERE expires_at > ?',
    ).get(now);
    return (row?.count ?? 0) > 0;
  }

  private getAppMajorMinor(): string | null {
    // Prefer SIDELINK_APP_VERSION (Electron writes it before startup) and fall
    // back to npm_package_version for tests / `npm run` paths. We intentionally
    // avoid require('package.json') because webpack/esbuild bundling strips it
    // from packaged builds, which caused silent auth migrations to skip in
    // prior releases.
    const envVersion = process.env.SIDELINK_APP_VERSION ?? process.env.npm_package_version;
    if (!envVersion) return null;
    const parts = envVersion.split('.');
    if (parts.length < 2) return null;
    return `${parts[0]}.${parts[1]}`;
  }

  // ─── Password Management ────────────────────────────────────────

  /**
   * Hash a password using scrypt with a random salt.
   */
  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${derived.toString('hex')}`;
  }

  /**
   * Verify a password against a stored hash.
   */
  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    const derived = (await scryptAsync(password, salt, 64)) as Buffer;
    const expected = Buffer.from(hash, 'hex');
    return timingSafeEqual(derived, expected);
  }

  // ─── Admin Bootstrap ────────────────────────────────────────────

  /**
   * Check if setup is complete (admin user exists).
   */
  isSetupComplete(): boolean {
    const row = this.db.prepare<[], { count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE role = ?',
    ).get('admin');
    return (row?.count ?? 0) > 0;
  }

  /**
   * Create the initial admin user. Only works if no admin exists.
   */
  async setupAdmin(username: string, password: string): Promise<UserSession> {
    if (password.length < 8) {
      throw new AuthError('Password must be at least 8 characters', 400);
    }
    const hash = await this.hashPassword(password);
    const userId = randomBytes(8).toString('hex');

    // Wrap the check-then-insert in a transaction so concurrent setupAdmin
    // requests from duplicate setup-wizard tabs produce a deterministic 409
    // instead of one request succeeding and the other crashing on the users-
    // username unique index with a raw SqliteError.
    try {
      this.db.runInTransaction(() => {
        const existing = this.db.prepare<[], { count: number }>(
          'SELECT COUNT(*) as count FROM users WHERE role = ?',
        ).get('admin');
        if ((existing?.count ?? 0) > 0) {
          throw new AuthError('Admin user already exists', 409);
        }
        this.db.prepare(
          'INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(userId, username, hash, 'admin', new Date().toISOString());
      });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed/i.test(message)) {
        throw new AuthError('Admin user already exists', 409);
      }
      throw err;
    }

    this.logs.info(LOG_CODES.ADMIN_LOGIN, 'Admin user created', { username });
    return this.createSession(userId);
  }

  // ─── Login / Logout ─────────────────────────────────────────────

  /**
   * Login with username and password.
   */
  async login(username: string, password: string, ip?: string): Promise<UserSession> {
    // Prune stale auth attempts to keep the table bounded
    this.pruneStaleAttempts();

    // Check lockout first
    this.checkLockout(username);

    const user = this.db.prepare<[string], { id: string; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE username = ?',
    ).get(username);

    if (!user || !(await this.verifyPassword(password, user.password_hash))) {
      this.recordFailedAttempt(username, ip);
      throw new AuthError('Invalid username or password');
    }

    // Clear failed attempts on success
    this.clearFailedAttempts(username);
    this.logs.info(LOG_CODES.ADMIN_LOGIN, `Login successful: ${username}`, { username, ip });
    return this.createSession(user.id);
  }

  /**
   * Logout / destroy a session.
   */
  logout(token: string): void {
    const tokenHash = this.hashToken(token);
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash);
  }

  /**
   * Wipe all users and sessions to re-trigger the setup wizard.
   */
  resetAllUsers(): void {
    this.db.prepare('DELETE FROM sessions').run();
    this.db.prepare('DELETE FROM auth_attempts').run();
    this.db.prepare('DELETE FROM users').run();
    this.logs.info(LOG_CODES.ADMIN_LOGIN, 'All users cleared — setup wizard will re-appear');
  }

  // ─── Session Validation ─────────────────────────────────────────

  /**
   * Validate a session token and return the session if valid.
   */
  validateSession(token: string): UserSession | null {
    const tokenHash = this.hashToken(token);
    const row = this.db.prepare<[string], {
      token: string; user_id: string; expires_at: string; created_at: string;
    }>(
      'SELECT token, user_id AS user_id, expires_at, created_at FROM sessions WHERE token = ?',
    ).get(tokenHash);

    if (!row) return null;

    const expiresAt = new Date(row.expires_at);
    if (expiresAt < new Date()) {
      // Expired — clean it up
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash);
      return null;
    }

    return {
      token,  // Return the raw token the caller provided (for cookie consistency)
      userId: row.user_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  /**
   * Periodic cleanup of expired sessions.
   */
  cleanExpiredSessions(): number {
    const result = this.db.prepare(
      'DELETE FROM sessions WHERE expires_at < ?',
    ).run(new Date().toISOString());
    return result.changes;
  }

  // ─── Password Change ───────────────────────────────────────────

  /**
   * Change password for a user.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = this.db.prepare<[string], { password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = ?',
    ).get(userId);

    if (!user) throw new AuthError('User not found');
    if (!(await this.verifyPassword(currentPassword, user.password_hash))) {
      throw new AuthError('Current password is incorrect');
    }
    if (newPassword.length < 8) {
      throw new AuthError('New password must be at least 8 characters');
    }

    const hash = await this.hashPassword(newPassword);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);

    // Invalidate all sessions for this user (force re-login)
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    this.logs.info(LOG_CODES.ADMIN_LOGIN, 'Password changed', { userId });
  }

  // ─── Lockout Logic ──────────────────────────────────────────────

  private checkLockout(username: string): void {
    const cutoff = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString();
    const row = this.db.prepare<[string, string], { count: number }>(
      'SELECT COUNT(*) as count FROM auth_attempts WHERE username = ? AND attempted_at > ? AND success = 0',
    ).get(username, cutoff);

    if ((row?.count ?? 0) >= LOCKOUT_THRESHOLD) {
      // Find the most recent failure to compute lockout end
      const last = this.db.prepare<[string], { attempted_at: string }>(
        'SELECT attempted_at FROM auth_attempts WHERE username = ? AND success = 0 ORDER BY attempted_at DESC LIMIT 1',
      ).get(username);

      if (last) {
        const lockoutEnd = new Date(new Date(last.attempted_at).getTime() + LOCKOUT_DURATION_MS);
        if (lockoutEnd > new Date()) {
          this.logs.warn(LOG_CODES.ADMIN_LOCKOUT, `Account locked: ${username}`, { username });
          const minutesRemaining = Math.ceil((lockoutEnd.getTime() - Date.now()) / 60_000);
          throw new LockoutError(minutesRemaining);
        }
      }
    }
  }

  private recordFailedAttempt(username: string, ip?: string): void {
    this.db.prepare(
      'INSERT INTO auth_attempts (username, ip, success, attempted_at) VALUES (?, ?, 0, ?)',
    ).run(username, ip ?? null, new Date().toISOString());
  }

  private clearFailedAttempts(username: string): void {
    this.db.prepare('DELETE FROM auth_attempts WHERE username = ?').run(username);
  }

  /** Delete auth_attempts older than the lockout window to keep the table bounded. */
  private pruneStaleAttempts(): void {
    const cutoff = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString();
    this.db.prepare('DELETE FROM auth_attempts WHERE attempted_at <= ?').run(cutoff);
  }

  // ─── Session Helpers ────────────────────────────────────────────

  /** Hash a token with SHA-256 for storage (never store raw tokens). */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private createSession(userId: string): UserSession {
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    // Prune excess sessions for this user (max 5 active)
    const existing = this.db.prepare<[string], { token: string }>(
      'SELECT token FROM sessions WHERE user_id = ? ORDER BY created_at DESC',
    ).all(userId);
    if (existing.length >= 5) {
      const toPrune = existing.slice(4);
      for (const s of toPrune) {
        this.db.prepare('DELETE FROM sessions WHERE token = ?').run(s.token);
      }
    }

    this.db.prepare(
      'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    ).run(tokenHash, userId, expiresAt.toISOString(), now.toISOString());

    return {
      token,  // Return raw token to client
      userId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    };
  }
}
