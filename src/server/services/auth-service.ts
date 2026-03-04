import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppStore } from '../state/store';
import { AppError } from '../utils/errors';
import { AuthSessionResult, AuthenticatedUser, UserRecord, UserSessionRecord } from '../types';
import { LogService } from './log-service';
import { readEnv } from '../utils/env';

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'Admin1234!';
const MAX_ACTIVE_SESSIONS_PER_USER = 5;

interface AuthServiceOptions {
  cookieName: string;
  sessionTtlHours: number;
}

interface LoginInput {
  username: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

interface BootstrapOptions {
  requireExplicitEnv?: boolean;
}

export class AuthService {
  public readonly cookieName: string;
  private readonly sessionTtlHours: number;
  private readonly failedWindowMs = 10 * 60 * 1000;
  private readonly lockoutMs = 15 * 60 * 1000;
  private readonly maxFailedAttempts = 5;
  private readonly failedAttemptRetentionMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly store: AppStore,
    private readonly logs: LogService,
    options: AuthServiceOptions
  ) {
    this.cookieName = options.cookieName;
    this.sessionTtlHours = options.sessionTtlHours;
  }

  public bootstrapAdminFromEnv(options: BootstrapOptions = {}): void {
    const envUsername = readEnv('SIDELINK_ADMIN_USERNAME', 'ALTSTORE_ADMIN_USERNAME');
    const envPassword = readEnv('SIDELINK_ADMIN_PASSWORD', 'ALTSTORE_ADMIN_PASSWORD');

    if (options.requireExplicitEnv && (!envUsername || !envPassword)) {
      throw new AppError(
        'ADMIN_BOOTSTRAP_ENV_REQUIRED',
        'SIDELINK_ADMIN_USERNAME and SIDELINK_ADMIN_PASSWORD are required.',
        400,
        'Set admin env vars and rerun bootstrap script.'
      );
    }

    const username = envUsername || DEFAULT_ADMIN_USERNAME;
    const password = envPassword || DEFAULT_ADMIN_PASSWORD;

    if (!this.store.countUsers()) {
      this.createOrUpdateAdmin(username, password);

      this.logs.push({
        level: envUsername && envPassword ? 'info' : 'warn',
        code: 'AUTH_ADMIN_BOOTSTRAPPED',
        message: envUsername && envPassword
          ? `Bootstrapped admin user "${username}" from environment.`
          : `Bootstrapped default local admin user "${username}".`,
        action: envUsername && envPassword
          ? 'Use /api/auth/login to create a session.'
          : 'Set SIDELINK_ADMIN_USERNAME and SIDELINK_ADMIN_PASSWORD to replace default credentials.'
      });
      return;
    }

    const resetOnBoot = readEnv('SIDELINK_ADMIN_RESET_ON_BOOT', 'ALTSTORE_ADMIN_RESET_ON_BOOT') === '1';
    if (envUsername && envPassword && resetOnBoot) {
      this.createOrUpdateAdmin(envUsername, envPassword);
      this.logs.push({
        level: 'info',
        code: 'AUTH_ADMIN_RESET',
        message: `Admin credentials for "${envUsername}" were reset from environment.`
      });
    }
  }

  public login(input: LoginInput): AuthSessionResult {
    const username = input.username.trim();
    const attemptKey = this.attemptKey(username, input.ipAddress);

    this.assertNotLockedOut(attemptKey);

    if (!username || !input.password) {
      this.registerFailedAttempt(attemptKey, username);
      throw new AppError('AUTH_INPUT_INVALID', 'Username and password are required.', 400);
    }

    const user = this.store.getUserByUsername(username);
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      this.registerFailedAttempt(attemptKey, username);
      throw new AppError('AUTH_INVALID_CREDENTIALS', 'Invalid username or password.', 401, 'Retry credentials.');
    }

    this.clearAttempt(attemptKey);

    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.sessionTtlHours * 60 * 60 * 1000).toISOString();

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);

    const session: UserSessionRecord = {
      id: this.store.newId('sess'),
      userId: user.id,
      tokenHash,
      createdAt,
      expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress
    };

    this.store.purgeExpiredSessions(createdAt);
    this.store.saveSession(session);
    this.store.pruneActiveSessions(user.id, MAX_ACTIVE_SESSIONS_PER_USER);

    const updatedUser: UserRecord = {
      ...user,
      lastLoginAt: createdAt,
      updatedAt: createdAt
    };
    this.store.saveUser(updatedUser);

    this.logs.push({
      level: 'info',
      code: 'AUTH_LOGIN_SUCCESS',
      message: `User ${user.username} logged in.`
    });

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    };
  }

  public authenticate(token: string | undefined): AuthenticatedUser | undefined {
    if (!token) {
      return undefined;
    }

    const now = new Date().toISOString();
    this.store.purgeExpiredSessions(now);

    const session = this.store.getActiveSessionByTokenHash(hashToken(token), now);
    if (!session) {
      return undefined;
    }

    const user = this.store.getUserById(session.userId);
    if (!user) {
      this.store.revokeSession(session.id, now);
      return undefined;
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role
    };
  }

  public logout(token: string | undefined): void {
    if (!token) {
      return;
    }

    const now = new Date().toISOString();
    const session = this.store.getActiveSessionByTokenHash(hashToken(token), now);
    if (!session) {
      return;
    }

    this.store.revokeSession(session.id, now);
    this.logs.push({
      level: 'info',
      code: 'AUTH_LOGOUT',
      message: `Session ${session.id} was revoked.`
    });
  }

  private createOrUpdateAdmin(username: string, password: string): void {
    this.assertPasswordStrength(password);

    const now = new Date().toISOString();
    const existing = this.store.getUserByUsername(username);

    const user: UserRecord = {
      id: existing?.id ?? this.store.newId('user'),
      username,
      passwordHash: hashPassword(password),
      role: 'admin',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastLoginAt: existing?.lastLoginAt
    };

    this.store.saveUser(user);
  }

  private attemptKey(username: string, ipAddress: string | undefined): string {
    return `${username.toLowerCase()}::${(ipAddress || 'unknown').trim()}`;
  }

  private assertNotLockedOut(key: string): void {
    const attempt = this.store.getAuthAttempt(key);
    if (!attempt?.lockUntil) {
      return;
    }

    if (Date.now() < attempt.lockUntil) {
      const minutes = Math.ceil((attempt.lockUntil - Date.now()) / 60000);
      throw new AppError(
        'AUTH_LOCKED_OUT',
        `Too many failed login attempts. Try again in ~${minutes} minute(s).`,
        429,
        'Wait for lockout window to pass or use the correct credentials.'
      );
    }

    this.store.deleteAuthAttempt(key);
  }

  private registerFailedAttempt(key: string, username: string): void {
    const now = Date.now();
    const current = this.store.getAuthAttempt(key);

    const withinWindow = current && now - current.firstFailedAt <= this.failedWindowMs;
    const nextCount = withinWindow ? current.count + 1 : 1;
    const firstFailedAt = withinWindow ? current.firstFailedAt : now;
    const lockUntil = nextCount >= this.maxFailedAttempts ? now + this.lockoutMs : undefined;

    this.store.saveAuthAttempt({
      key,
      username,
      count: nextCount,
      firstFailedAt,
      lockUntil
    });

    this.store.purgeStaleAuthAttempts(now - this.failedAttemptRetentionMs);

    if (lockUntil) {
      this.logs.push({
        level: 'warn',
        code: 'AUTH_LOCKOUT_TRIGGERED',
        message: `Login lockout triggered for ${username}.`,
        action: 'Wait 15 minutes before retrying. Confirm credentials and avoid repeated failures.'
      });
    }
  }

  private clearAttempt(key: string): void {
    this.store.deleteAuthAttempt(key);
  }

  private assertPasswordStrength(password: string): void {
    const okLength = password.length >= 10;
    const okUpper = /[A-Z]/.test(password);
    const okLower = /[a-z]/.test(password);
    const okNumber = /[0-9]/.test(password);

    if (okLength && okUpper && okLower && okNumber) {
      return;
    }

    throw new AppError(
      'AUTH_PASSWORD_WEAK',
      'Admin password must be at least 10 characters and include upper/lowercase letters and a number.',
      400
    );
  }
}

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
};

export const verifyPassword = (password: string, encoded: string): boolean => {
  const [algorithm, salt, hashHex] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !hashHex) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
};

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
