// ─── Apple Account Service ───────────────────────────────────────────
// Orchestrates Apple ID authentication, 2FA flows, session persistence,
// and account management. This is the high-level service that combines
// apple-auth.ts + database for a complete account lifecycle.

import type { Database } from '../state/database';
import type { LogService } from './log-service';
import type { EncryptionProvider } from '../types';
import { initiateAuth, submit2FACode, requestSMS2FA, type AuthSession } from '../apple/apple-auth';
import { AppleDeveloperServicesClient } from '../apple/developer-services';
import type { AppleAccount, Apple2FASubmit } from '../../shared/types';
import { AppleAuthError, Apple2FARequiredError } from '../utils/errors';
import { LOG_CODES } from '../../shared/constants';

/**
 * In-memory store for pending auth sessions (pre-2FA).
 * Keyed by Apple ID. Entries expire after 5 minutes.
 */
const pendingSessions = new Map<string, AuthSession>();
const pendingSessionTimers = new Map<string, NodeJS.Timeout>();

const PENDING_SESSION_TTL_MS = 10 * 60 * 1000;

function storePendingSession(appleId: string, session: AuthSession): void {
  pendingSessions.set(appleId, session);
  // Clear any existing timer
  const existing = pendingSessionTimers.get(appleId);
  if (existing) clearTimeout(existing);
  // Auto-expire after TTL
  const timer = setTimeout(() => {
    pendingSessions.delete(appleId);
    pendingSessionTimers.delete(appleId);
  }, PENDING_SESSION_TTL_MS);
  timer.unref();
  pendingSessionTimers.set(appleId, timer);
}

/**
 * In-memory cache of authenticated sessions.
 * Keyed by account ID. Used to avoid redundant GSA re-auth when the
 * session was just created (e.g., pipeline starts right after sign-in).
 */
interface CachedSession {
  session: AuthSession;
  cachedAt: number;
}

const sessionCache = new Map<string, CachedSession>();

/** Sessions are considered fresh for 30 minutes. */
const SESSION_FRESHNESS_MS = 30 * 60 * 1000;

export class AppleAccountService {
  constructor(
    private db: Database,
    private logs: LogService,
    private encryption: EncryptionProvider,
  ) {}

  // ─── Account CRUD ───────────────────────────────────────────────

  /**
   * List all Apple accounts (without sensitive fields).
   */
  list(): AppleAccount[] {
    return this.db.listAppleAccounts();
  }

  /**
   * Get a specific Apple account.
   */
  get(accountId: string): AppleAccount | null {
    return this.db.getAppleAccount(accountId) ?? null;
  }

  /**
   * Remove an Apple account and all associated data.
   */
  remove(accountId: string): void {
    sessionCache.delete(accountId);
    this.db.deleteAppleAccount(accountId);
    this.logs.info(LOG_CODES.APPLE_AUTH_SUCCESS, 'Apple account removed', { accountId });
  }

  // ─── Authentication Flow ────────────────────────────────────────

  /**
   * Step 1: Start Apple ID sign-in process.
   * Returns either a fully authenticated account or throws Apple2FARequiredError.
   */
  async signIn(appleId: string, password: string): Promise<AppleAccount> {
    this.logs.info(LOG_CODES.APPLE_AUTH_STARTED, `Apple sign-in started: ${appleId}`, {
      appleId,
    });

    try {
      // initiateAuth throws Apple2FARequiredError on 2FA, or returns AuthResult on success
      const result = await initiateAuth(appleId, password);
      const account = await this.finalizeAuth(appleId, password, result.session);
      // Cache the session for reuse by the pipeline
      sessionCache.set(account.id, { session: result.session, cachedAt: Date.now() });
      return account;
    } catch (error) {
      if (error instanceof Apple2FARequiredError) {
        // Store partial session so submit2FA can resume
        storePendingSession(appleId, error.partialSession as AuthSession);
        throw error;
      }
      this.logs.error(LOG_CODES.APPLE_AUTH_FAILED, `Apple sign-in failed: ${appleId}`, {
        appleId, error: String(error),
      });
      throw error;
    }
  }

  /**
   * Step 2: Submit 2FA code.
   */
  async submit2FA(submit: Apple2FASubmit): Promise<AppleAccount> {
    const session = pendingSessions.get(submit.appleId);
    if (!session) {
      throw new AppleAuthError(
        'APPLE_NO_SESSION',
        'No pending authentication session. Please sign in again.',
      );
    }

    try {
      const method = submit.method === 'sms' ? 'sms' : 'trusted-device';
      // submit2FACode validates the code, re-authenticates via GSA, and returns AuthSession
      const updatedSession = await submit2FACode(
        submit.code,
        session,
        method,
        submit.phoneId,
        submit.appleId,
        submit.password,
      );

      pendingSessions.delete(submit.appleId);
      const timer = pendingSessionTimers.get(submit.appleId);
      if (timer) { clearTimeout(timer); pendingSessionTimers.delete(submit.appleId); }
      const account = await this.finalizeAuth(submit.appleId, submit.password, updatedSession);
      // Cache the session for reuse by the pipeline
      sessionCache.set(account.id, { session: updatedSession, cachedAt: Date.now() });
      return account;
    } catch (error) {
      this.logs.error(LOG_CODES.APPLE_AUTH_FAILED, `2FA verification failed: ${submit.appleId}`, {
        appleId: submit.appleId, error: String(error),
      });
      throw error;
    }
  }

  /**
   * Complete 2FA for an account using stored credentials.
   * Used by the pipeline when 2FA is triggered during install.
   */
  async complete2FAForAccount(accountId: string, code: string): Promise<AppleAccount> {
    const account = this.db.getAppleAccount(accountId);
    if (!account) {
      throw new AppleAuthError('APPLE_ACCOUNT_NOT_FOUND', 'Account not found');
    }
    const password = this.encryption.decrypt(account.passwordEncrypted ?? '');
    if (!password) {
      throw new AppleAuthError('APPLE_DECRYPT_FAILED', 'Unable to decrypt stored credentials');
    }
    return this.submit2FA({
      appleId: account.appleId,
      password,
      code,
    });
  }

  /**
   * Step 2 (alt): Request SMS be sent to a specific phone number.
   */
  async requestSMS(appleId: string, phoneNumberId: number): Promise<void> {

    const session = pendingSessions.get(appleId);
    if (!session) {
      throw new AppleAuthError(
        'APPLE_NO_SESSION',
        'No pending authentication session. Please sign in again.',
      );
    }

    await requestSMS2FA(phoneNumberId, session);
    this.logs.info(LOG_CODES.APPLE_AUTH_2FA_SUBMITTED, `SMS 2FA requested for: ${appleId}`, {
      appleId, phoneNumberId,
    });
  }

  // ─── Session Refresh ───────────────────────────────────────────

  /**
   * Re-authenticate an existing account (e.g., before signing).
   * Reuses a cached session if it's still fresh (< 30 min old).
   * Otherwise performs a full GSA re-auth with stored credentials.
   */
  async refreshAuth(accountId: string): Promise<AuthSession> {
    // Check in-memory cache first — avoid unnecessary GSA round-trips
    const cached = sessionCache.get(accountId);
    if (cached && (Date.now() - cached.cachedAt) < SESSION_FRESHNESS_MS) {
      return cached.session;
    }

    const account = this.db.getAppleAccount(accountId);
    if (!account) {
      throw new AppleAuthError('APPLE_ACCOUNT_NOT_FOUND', 'Account not found');
    }

    // Decrypt stored password
    const password = this.encryption.decrypt(account.passwordEncrypted ?? '');
    if (!password) {
      throw new AppleAuthError('APPLE_DECRYPT_FAILED', 'Unable to decrypt stored credentials');
    }

    try {
      const result = await initiateAuth(account.appleId, password);

      // Update cookies
      this.db.updateAppleAccountCookies(accountId, JSON.stringify(result.session.cookies));
      this.db.updateAppleAccountStatus(accountId, 'active');

      // Cache the fresh session
      sessionCache.set(accountId, { session: result.session, cachedAt: Date.now() });

      this.logs.info(LOG_CODES.APPLE_SESSION_REFRESHED, `Auth refreshed: ${account.appleId}`, {
        accountId,
      });

      return result.session;
    } catch (error) {
      if (error instanceof Apple2FARequiredError) {
        this.db.updateAppleAccountStatus(accountId, 'requires_2fa');
        // Store pending session so pipeline 2FA flow can complete
        storePendingSession(account.appleId, error.partialSession as AuthSession);
      }
      throw error;
    }
  }

  /**
   * Re-authenticate an existing account using stored credentials.
   * Called from the UI when an account is in requires_2fa / session_expired state.
   * Throws Apple2FARequiredError if 2FA is needed (caller should prompt the user).
   */
  async reauthenticate(accountId: string): Promise<AppleAccount> {
    const account = this.db.getAppleAccount(accountId);
    if (!account) {
      throw new AppleAuthError('APPLE_ACCOUNT_NOT_FOUND', 'Account not found');
    }

    const password = this.encryption.decrypt(account.passwordEncrypted ?? '');
    if (!password) {
      throw new AppleAuthError('APPLE_DECRYPT_FAILED', 'Unable to decrypt stored credentials');
    }

    // Invalidate cached session — force a full GSA round-trip
    sessionCache.delete(accountId);

    this.logs.info(LOG_CODES.APPLE_AUTH_STARTED, `Re-authenticating: ${account.appleId}`, {
      accountId,
    });

    try {
      const result = await initiateAuth(account.appleId, password);
      const updated = await this.finalizeAuth(account.appleId, password, result.session);
      sessionCache.set(updated.id, { session: result.session, cachedAt: Date.now() });
      return updated;
    } catch (error) {
      if (error instanceof Apple2FARequiredError) {
        this.db.updateAppleAccountStatus(accountId, 'requires_2fa');
        storePendingSession(account.appleId, error.partialSession as AuthSession);
      }
      throw error;
    }
  }

  /**
   * Get a Developer Services client for a specific account.
   * Reuses cached session when fresh, otherwise refreshes.
   */
  async getDevClient(accountId: string): Promise<AppleDeveloperServicesClient> {
    const session = await this.refreshAuth(accountId);
    return new AppleDeveloperServicesClient(session);
  }

  // ─── Internals ─────────────────────────────────────────────────

  /**
   * Finalize authentication: fetch team info, store account.
   */
  private async finalizeAuth(
    appleId: string,
    password: string,
    session: AuthSession,
  ): Promise<AppleAccount> {
    const devClient = new AppleDeveloperServicesClient(session);

    // Fetch team info
    const teams = await devClient.listTeams();
    if (teams.length === 0) {
      throw new AppleAuthError('APPLE_NO_TEAM', 'No developer team found for this Apple ID');
    }

    // Use the first team (most accounts have one)
    const team = teams[0];
    // Determine account type from team data.
    // Free accounts have type "Individual" with no paid memberships.
    // Check multiple possible field names since Apple's plist format varies.
    const memberships = team.memberships || [];
    const isPaid = memberships.length > 0
      ? memberships.some((m: any) => {
          const mType = (m.membershipType || m.type || m.name || '').toLowerCase();
          return mType.includes('paid') || mType.includes('developer') || mType.includes('enterprise');
        })
      : false; // No memberships data → default to free
    const accountType = isPaid ? 'paid' : 'free';
    this.logs.info(LOG_CODES.APPLE_AUTH_STARTED, `Team "${team.name}" type=${team.type}, accountType=${accountType}`, {
      teamId: team.teamId, teamType: team.type, accountType, memberships: memberships.length,
    });

    // Encrypt and store
    const encryptedPassword = this.encryption.encrypt(password);
    const cookiesJson = JSON.stringify(session.cookies);

    const accountId = this.db.upsertAppleAccount({
      appleId,
      teamId: team.teamId,
      teamName: team.name ?? appleId,
      accountType,
      passwordEncrypted: encryptedPassword,
      cookiesJson,
      status: 'active',
    });

    this.logs.info(LOG_CODES.APPLE_AUTH_SUCCESS, `Apple account authenticated: ${appleId}`, {
      appleId, teamId: team.teamId, accountType,
    });

    return this.db.getAppleAccount(accountId)!;
  }
}
