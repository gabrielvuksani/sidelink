// ─── Error Utilities ─────────────────────────────────────────────────
// Centralized error message extraction for API + unknown errors.

/**
 * Extract a human-readable error message from any thrown value.
 * Works with API errors (have `.data.error`), regular Errors, and unknown.
 */
export function getErrorMessage(error: unknown, fallback = 'An unexpected error occurred'): string {
  if (typeof error === 'object' && error !== null) {
    // API error shape: { data: { error: string } }
    if ('data' in error) {
      const apiErr = error as { data?: { error?: string } };
      if (apiErr.data?.error) return apiErr.data.error;
    }
    // Standard Error
    if (error instanceof Error && error.message) return error.message;
    // Object with message property
    if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
  }
  if (typeof error === 'string') return error;
  return fallback;
}

// ─── Pipeline / Job Error Formatting ─────────────────────────────────

export interface FormattedError {
  title: string;
  description: string;
  action?: string;
}

const ERROR_PATTERNS: Array<{ test: RegExp } & FormattedError> = [
  {
    test: /code signature.*verif|ApplicationVerificationFailed|0xe8008001/i,
    title: 'Code Signature Verification Failed',
    description: 'The device rejected the app\u2019s code signature. This commonly occurs with complex apps containing multiple extensions or frameworks.',
    action: 'Try a simpler IPA or use a paid Apple Developer account.',
  },
  {
    test: /entitlement.*(?:invalid|mismatch|failed)|0xe800800[56]|MismatchedApplicationIdentifier/i,
    title: 'Entitlements Mismatch',
    description: 'The app requests permissions not available in the provisioning profile.',
    action: 'Some entitlements require a paid developer account.',
  },
  {
    test: /provisioning.*(?:profile|not found)|0xe8008015/i,
    title: 'Provisioning Profile Error',
    description: 'No valid provisioning profile was found for this app and device combination.',
    action: 'Try re-installing to generate a fresh profile.',
  },
  {
    test: /device.*not.*(?:included|registered)|0xe800801c/i,
    title: 'Device Not Registered',
    description: 'This device is not included in the provisioning profile.',
    action: 'The device should be auto-registered. Try removing and re-adding it.',
  },
  {
    test: /no pending auth|sign in again/i,
    title: 'Session Expired',
    description: 'The Apple account authentication session has expired.',
    action: 'Re-authenticate your Apple account and try again.',
  },
  {
    test: /2fa.*(?:timeout|not submitted)|TWO_FA_TIMEOUT/i,
    title: '2FA Timeout',
    description: 'The two-factor authentication code was not submitted in time.',
    action: 'Start the installation again and enter the code promptly.',
  },
  {
    test: /device.*not.*connect|DEVICE_NOT_CONNECTED/i,
    title: 'Device Disconnected',
    description: 'The target device is no longer connected.',
    action: 'Reconnect the device via USB and try again.',
  },
  {
    test: /app.*id.*limit|APP_ID_LIMIT/i,
    title: 'App ID Limit Reached',
    description: 'Free Apple accounts can only create 10 App IDs per week.',
    action: 'Remove an existing app to free up a slot, or wait 7 days.',
  },
  {
    test: /certificate|signing.*identity|SIGNING_IDENTITY/i,
    title: 'Signing Error',
    description: 'The signing certificate could not be found or is invalid.',
    action: 'Try re-authenticating your Apple account.',
  },
  {
    test: /IPA.*not found|IPA_NOT_FOUND/i,
    title: 'IPA Not Found',
    description: 'The selected IPA file could not be found on the server.',
    action: 'Re-upload the IPA and try again.',
  },
  {
    test: /server restart/i,
    title: 'Interrupted',
    description: 'The installation was interrupted by a server restart.',
    action: 'Start the installation again.',
  },
];

/**
 * Format a raw pipeline/job error string into a structured,
 * human-friendly error with title, description, and action hint.
 */
export function formatJobError(error: string): FormattedError {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test.test(error)) {
      return { title: pattern.title, description: pattern.description, action: pattern.action };
    }
  }

  // Fallback: strip common prefixes and clean up
  let cleaned = error
    .replace(/^(DeviceError|AppleAuthError|SigningError|PipelineError|ProvisioningError):\s*/i, '');

  // Strip pymobiledevice3 tracebacks — extract the final error line
  const tracebackMatch = cleaned.match(/(?:Error|Exception):\s*(.+?)$/ms);
  if (tracebackMatch) {
    cleaned = tracebackMatch[1].trim();
  }

  if (cleaned.length > 300) cleaned = cleaned.slice(0, 297) + '\u2026';

  return {
    title: 'Installation Failed',
    description: cleaned || 'An unexpected error occurred during installation.',
  };
}
