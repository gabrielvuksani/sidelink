// ─── Redaction ──────────────────────────────────────────────────────
// Sanitize sensitive data from logs and error messages.

const SENSITIVE_PATTERNS = [
  // Apple session tokens
  /X-Apple-Session-Token:\s*\S+/gi,
  // Cookies
  /cookie:\s*[^\n]+/gi,
  // Password values (key=value or key: value pairs, NOT the word "password" alone)
  /password['":\s]*=\s*[^\s,;'"}\]]+/gi,
  /["']password["']\s*:\s*["'][^"']*["']/gi,
  // Private keys
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
  // Bearer tokens
  /bearer\s+\S+/gi,
  // Apple ID emails (partial redaction)
  /([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+)/g,
];

/**
 * Redact sensitive information from a string.
 */
export function redact(input: string): string {
  let result = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // For emails, keep first char and domain
      if (match.includes('@')) {
        return match.replace(
          /([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@/g,
          '$1***@',
        );
      }
      // For private keys, just indicate presence
      if (match.includes('PRIVATE KEY')) {
        return '[REDACTED-PRIVATE-KEY]';
      }
      return '[REDACTED]';
    });
  }
  return result;
}

/**
 * Redact an object's string values recursively.
 */
export function redactObject<T>(obj: T): T {
  if (typeof obj === 'string') return redact(obj) as T;
  if (Array.isArray(obj)) return obj.map(redactObject) as T;
  if (obj && typeof obj === 'object') {
    const result = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      // Fully redact known sensitive keys
      if (/password|secret|token|key|cookie/i.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactObject(value);
      }
    }
    return result as T;
  }
  return obj;
}
