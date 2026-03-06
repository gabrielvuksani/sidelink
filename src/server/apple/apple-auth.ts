// ─── Apple ID Authentication (GSA Protocol) ─────────────────────────
// Implements Apple's Grand Slam Authentication (GSA) protocol using
// SRP-6a for password verification, plus 2FA handling.
//
// The SRP-6a cryptographic computation is delegated to a Python helper
// script (scripts/gsa-auth-helper.py) that uses the proven `srp` library
// (pysrp) with Apple-specific configuration (RFC 5054 2048-bit group,
// no_username_in_x). This approach ensures byte-for-byte correctness
// with Apple's SRP implementation.
//
// Flow:
//   1. Python helper: GSA SRP init + complete → decrypted SPD
//   2. If 2FA required → trigger + validate via GSA endpoints (Python)
//   3. Fetch app tokens → decrypt → extract auth token (Python)
//   4. Session = { cookies: [myacinfo=token], dsid: adsid }

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { getAnisetteData, type AnisetteData } from './anisette';
import { AppleAuthError, Apple2FARequiredError } from '../utils/errors';
import { getPythonBinaryPath, hasBundledPython, getScriptsPath, getPythonPackagesPath } from '../utils/paths';

// ─── Module Logger ──────────────────────────────────────────────────
// Can be overridden via setAuthLogger() to route through LogService.

interface AuthLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const consoleLogger: AuthLogger = {
  info: (msg) => console.log(`[APPLE_AUTH] ${msg}`),
  warn: (msg) => console.warn(`[APPLE_AUTH] ${msg}`),
  error: (msg) => console.error(`[APPLE_AUTH] ${msg}`),
};

let logger: AuthLogger = consoleLogger;

/** Override the default console logger (call from context setup). */
export function setAuthLogger(l: AuthLogger): void {
  logger = l;
}

// ─── Types ──────────────────────────────────────────────────────────

export interface AuthSession {
  /** Session cookies (includes myacinfo=<token> for developer services) */
  cookies: string[];
  /** Auth token from GSA app tokens */
  sessionToken: string;
  /** scnt header (empty in GSA flow, kept for interface compat) */
  scnt: string;
  /** Apple DSID (mapped to sessionId for interface compat) */
  sessionId: string;
}

export interface AuthResult {
  session: AuthSession;
  requires2FA: boolean;
  authType?: string;
}

// ─── Pending 2FA Contexts ───────────────────────────────────────────

interface PendingGsaContext {
  adsid: string;
  idmsToken: string;
}

const pending2FAContexts = new Map<string, PendingGsaContext>();

// ─── Python Helper ──────────────────────────────────────────────────

/** Resolve the Python binary for GSA auth. */
function resolvePython(): string {
  return getPythonBinaryPath();
}

/**
 * Call the Python GSA auth helper.
 * Uses bundled binary (sidelink-python --command gsa-auth) when available,
 * or falls back to the Python script (scripts/gsa-auth-helper.py).
 * Pipes the request JSON to stdin, reads JSON result from stdout.
 */
async function callGsaHelper(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  let pythonBin: string;
  let pythonArgs: string[];

  if (hasBundledPython()) {
    pythonBin = resolvePython();
    pythonArgs = ['--command', 'gsa-auth'];
  } else {
    pythonBin = resolvePython();
    const helperScript = path.join(getScriptsPath(), 'gsa-auth-helper.py');
    pythonArgs = [helperScript];
  }

  // Set PYTHONPATH for bundled site-packages (packaged app)
  const spawnEnv = { ...process.env };
  const pkgPath = getPythonPackagesPath();
  if (pkgPath) {
    spawnEnv.PYTHONPATH = pkgPath;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, pythonArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new AppleAuthError(
        'GSA_HELPER_TIMEOUT',
        'Python GSA auth helper timed out after 60 seconds',
      ));
    }, 60_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (stderr) {
        logger.error(`Python helper stderr: ${stderr}`);
      }

      if (!stdout) {
        reject(new AppleAuthError(
          'GSA_HELPER_NO_OUTPUT',
          `Python GSA auth helper produced no output (exit ${code}). stderr: ${stderr.slice(0, 300)}`,
        ));
        return;
      }

      try {
        const result = JSON.parse(stdout) as Record<string, unknown>;
        resolve(result);
      } catch {
        reject(new AppleAuthError(
          'GSA_HELPER_INVALID_JSON',
          `Failed to parse GSA helper output: ${stdout.slice(0, 300)}`,
        ));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new AppleAuthError(
        'GSA_HELPER_SPAWN_FAILED',
        `Failed to spawn Python GSA helper: ${err.message}`,
      ));
    });

    // Write request JSON to stdin and close it
    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

// ─── Main Auth Functions ────────────────────────────────────────────

/**
 * Authenticate with Apple via GSA SRP-6a protocol.
 * Delegates SRP computation to the Python helper (proven pysrp library).
 * Returns AuthResult on success, or throws:
 *   - Apple2FARequiredError if 2FA is needed
 *   - AppleAuthError on invalid credentials or other errors
 */
export async function initiateAuth(
  appleId: string,
  password: string,
): Promise<AuthResult> {
  const anisette = await getAnisetteData();

  logger.info('Starting GSA authentication via Python helper...');

  // ── Step 1: Full SRP handshake via Python ─────────────────────
  const authResult = await callGsaHelper({
    command: 'auth',
    username: appleId,
    password,
    anisette,
  });

  if (authResult.error) {
    const ec = Number(authResult.error_code ?? 0);
    const em = String(authResult.error_message ?? 'Unknown error');
    logger.error(`GSA error ${ec}: ${em}`);

    if (ec === -20101 || ec === -22406) {
      throw new AppleAuthError(
        'APPLE_AUTH_INVALID_CREDENTIALS',
        'Invalid Apple ID or password',
        'Check your credentials and try again.',
      );
    }
    if (ec === -20283) {
      throw new AppleAuthError(
        'APPLE_AUTH_ACCOUNT_NOT_FOUND',
        'Apple account not found',
        'Check the Apple ID and try again.',
      );
    }

    throw new AppleAuthError('GSA_ERROR', `Apple auth error ${ec}: ${em}`);
  }

  const adsid = String(authResult.adsid ?? '');
  const idmsToken = String(authResult.idms_token ?? '');
  const authType = String(authResult.auth_type ?? '');
  const sk_b64 = authResult.sk as string | undefined;
  const c_b64 = authResult.c as string | undefined;

  if (!adsid || !idmsToken) {
    throw new AppleAuthError(
      'GSA_INVALID_SPD',
      'Missing adsid or idms_token in authentication response',
    );
  }

  logger.info(`SRP authenticated, DSID=${adsid.slice(0, 8)}..., authType=${authType || 'none'}`);

  // ── Step 2: Check for 2FA ────────────────────────────────────
  if (authType === 'trustedDeviceSecondaryAuth' || authType === 'secondaryAuth') {
    logger.info(`2FA required (${authType})`);

    // Store context for 2FA completion
    pending2FAContexts.set(appleId, { adsid, idmsToken });

    // Trigger 2FA push notification to trusted devices
    await trigger2FAPush(adsid, idmsToken, anisette);

    // Signal that 2FA is required
    const partialSession: AuthSession = {
      cookies: [],
      sessionToken: '',
      scnt: '',
      sessionId: adsid,
    };

    throw new Apple2FARequiredError(
      { scnt: '', xAppleIdSessionId: adsid, authType },
      partialSession,
    );
  }

  // ── Step 3: Fetch App Tokens ─────────────────────────────────
  if (!sk_b64 || !c_b64) {
    throw new AppleAuthError('GSA_NO_SK', 'Missing sk or c in SPD (needed for app tokens)');
  }

  const authToken = await fetchAppToken(adsid, idmsToken, sk_b64, c_b64, anisette);
  logger.info('Got app token ✓');

  const session: AuthSession = {
    cookies: [`myacinfo=${authToken}`],
    sessionToken: authToken,
    scnt: '',
    sessionId: adsid,
  };

  return { session, requires2FA: false };
}

// ─── 2FA Support ────────────────────────────────────────────────────

/**
 * Trigger 2FA push notification to trusted devices.
 * Delegates to Python helper.
 */
async function trigger2FAPush(
  adsid: string,
  idmsToken: string,
  anisette: AnisetteData,
): Promise<void> {
  try {
    const result = await callGsaHelper({
      command: '2fa_trigger',
      adsid,
      idms_token: idmsToken,
      anisette,
    });
    if (result.triggered) {
      logger.info('2FA push notification triggered');
    } else {
      logger.warn(`2FA push trigger returned: ${result.warning || 'unknown'}`);
    }
  } catch (err) {
    // Push trigger is best-effort — don't fail the auth flow
    logger.warn(`Failed to trigger 2FA push (non-fatal): ${String(err)}`);
  }
}

/**
 * Fetch app token for Xcode auth.
 * Delegates HMAC checksum and AES-GCM decryption to Python.
 */
async function fetchAppToken(
  adsid: string,
  idmsToken: string,
  sk_b64: string,
  c_b64: string,
  anisette: AnisetteData,
): Promise<string> {
  logger.info('Fetching app tokens via Python helper...');

  const result = await callGsaHelper({
    command: 'app_tokens',
    adsid,
    idms_token: idmsToken,
    sk: sk_b64,
    c: c_b64,
    anisette,
  });

  if (result.error) {
    const ec = Number(result.error_code ?? 0);
    const em = String(result.error_message ?? 'Unknown error');
    throw new AppleAuthError('GSA_TOKEN_FAILED', `App token fetch failed (${ec}): ${em}`);
  }

  const token = String(result.token ?? '');
  if (!token) {
    throw new AppleAuthError('GSA_TOKEN_MISSING', 'No Xcode auth token in response');
  }

  return token;
}

// ─── 2FA Verification ───────────────────────────────────────────────

/**
 * Submit 2FA verification code.
 *
 * In the GSA flow:
 *   1. Validate the security code via gsa.apple.com (Python helper)
 *   2. Re-authenticate entirely (the second attempt succeeds without 2FA)
 *   3. Return the fully authenticated session
 *
 * @param code - 6-digit verification code
 * @param session - Partial session from Apple2FARequiredError (mostly unused in GSA)
 * @param method - 'trusted-device' or 'sms'
 * @param phoneId - Phone number ID for SMS fallback
 * @param appleId - Apple ID (required for GSA re-auth)
 * @param password - Password (required for GSA re-auth)
 */
export async function submit2FACode(
  code: string,
  session: AuthSession,
  method: 'trusted-device' | 'sms' = 'trusted-device',
  phoneId?: number,
  appleId?: string,
  password?: string,
): Promise<AuthSession> {
  if (!appleId) {
    throw new AppleAuthError(
      'APPLE_2FA_NO_CONTEXT',
      'Apple ID is required for 2FA code submission',
    );
  }

  const ctx = pending2FAContexts.get(appleId);
  if (!ctx) {
    throw new AppleAuthError(
      'APPLE_NO_SESSION',
      'No pending 2FA session found. Please sign in again.',
    );
  }

  const anisette = await getAnisetteData();

  // Validate the security code via Python helper
  logger.info('Validating 2FA code...');

  const validateResult = await callGsaHelper({
    command: '2fa_validate',
    adsid: ctx.adsid,
    idms_token: ctx.idmsToken,
    code,
    anisette,
  });

  if (validateResult.error) {
    const ec = Number(validateResult.error_code ?? 0);
    const em = String(validateResult.error_message ?? 'Unknown error');

    if (ec === -21669) {
      throw new AppleAuthError(
        'APPLE_2FA_INVALID_CODE',
        'Incorrect verification code',
        'Enter the correct 6-digit code from your trusted device.',
      );
    }
    throw new AppleAuthError('APPLE_2FA_FAILED', `2FA validation error ${ec}: ${em}`);
  }

  logger.info('2FA code validated ✓');

  // Clean up pending context
  pending2FAContexts.delete(appleId);

  // Re-authenticate — after successful 2FA, the second attempt should succeed
  if (!password) {
    throw new AppleAuthError(
      'APPLE_2FA_NO_PASSWORD',
      'Password is required for re-authentication after 2FA',
    );
  }

  logger.info('Re-authenticating after 2FA...');
  const result = await initiateAuth(appleId, password);
  return result.session;
}

/**
 * Request SMS 2FA code to a specific phone number.
 */
export async function requestSMS2FA(
  phoneId: number,
  session: AuthSession,
): Promise<void> {
  // GSA primarily uses trusted device 2FA.
  // For SMS, we'd need the pending context — best effort only.
  logger.warn(
    'SMS 2FA in GSA flow: trusted device push is the primary mechanism. '
    + 'If user has SMS 2FA configured, the code will be sent automatically.',
  );
}

/**
 * Trust the current session (post-2FA).
 * In the GSA flow, trust is implicit after successful re-authentication.
 */
export async function trustSession(session: AuthSession): Promise<void> {
  // No-op in GSA flow — trust is handled by Apple server-side
  // after a successful re-auth following 2FA validation.
}
