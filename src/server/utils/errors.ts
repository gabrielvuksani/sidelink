// ─── Application Errors ─────────────────────────────────────────────
// Typed error hierarchy for the entire application.

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly action?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ─── Apple Auth Errors ──────────────────────────────────────────────

export class AppleAuthError extends AppError {
  constructor(code: string, message: string, action?: string) {
    super(code, message, 401, action);
    this.name = 'AppleAuthError';
  }
}

export class Apple2FARequiredError extends AppError {
  /** Partial session for the caller to resume 2FA. */
  public readonly partialSession: {
    cookies: string[];
    sessionToken: string;
    scnt: string;
    sessionId: string;
  };
  public readonly authType: string;

  constructor(
    sessionData: { scnt: string; xAppleIdSessionId: string; authType: string },
    partialSession?: { cookies: string[]; sessionToken: string; scnt: string; sessionId: string },
  ) {
    super('APPLE_2FA_REQUIRED', 'Two-factor authentication is required', 409);
    this.name = 'Apple2FARequiredError';
    this.authType = sessionData.authType;
    this.partialSession = partialSession ?? {
      cookies: [],
      sessionToken: '',
      scnt: sessionData.scnt,
      sessionId: sessionData.xAppleIdSessionId,
    };
  }
}

// ─── Provisioning Errors ────────────────────────────────────────────

export class ProvisioningError extends AppError {
  constructor(code: string, message: string, action?: string) {
    super(code, message, 422, action);
    this.name = 'ProvisioningError';
  }
}

export class AppIdLimitError extends ProvisioningError {
  constructor(limit: number) {
    super(
      'APP_ID_LIMIT_REACHED',
      `Free account App ID limit reached (${limit} active). Remove an existing app first.`,
      'Remove an installed app to free up an App ID slot.',
    );
    this.name = 'AppIdLimitError';
  }
}

export class WeeklyAppIdLimitError extends ProvisioningError {
  constructor(limit: number) {
    super(
      'APP_ID_WEEKLY_LIMIT_REACHED',
      `Free account weekly App ID creation limit reached (${limit}/7 days). Try again later.`,
      'Wait until the 7-day window rolls forward, or reuse existing installed App IDs.',
    );
    this.name = 'WeeklyAppIdLimitError';
  }
}

// ─── Device Errors ──────────────────────────────────────────────────

export class DeviceError extends AppError {
  constructor(code: string, message: string, action?: string) {
    super(code, message, 422, action);
    this.name = 'DeviceError';
  }
}

// ─── Signing Errors ─────────────────────────────────────────────────

export class SigningError extends AppError {
  constructor(code: string, message: string, action?: string) {
    super(code, message, 500, action);
    this.name = 'SigningError';
  }
}

// ─── Pipeline Errors ────────────────────────────────────────────────

export class PipelineError extends AppError {
  constructor(code: string, message: string, action?: string) {
    super(code, message, 500, action);
    this.name = 'PipelineError';
  }
}

// ─── Not Found ──────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} not found: ${id}`, 404);
    this.name = 'NotFoundError';
  }
}

// ─── Validation ─────────────────────────────────────────────────────

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
    this.name = 'ValidationError';
  }
}

// ─── Auth ───────────────────────────────────────────────────────────

export class AuthError extends AppError {
  constructor(message: string = 'Authentication required') {
    super('AUTH_REQUIRED', message, 401);
    this.name = 'AuthError';
  }
}

export class LockoutError extends AppError {
  constructor(minutesRemaining: number) {
    super(
      'ACCOUNT_LOCKED',
      `Account locked due to too many failed attempts. Try again in ${minutesRemaining} minutes.`,
      429,
    );
    this.name = 'LockoutError';
  }
}
