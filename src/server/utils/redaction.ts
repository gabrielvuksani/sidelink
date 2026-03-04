const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /(password|passwd|passphrase|token|secret|api[_-]?key|authorization|cookie|session(?:id)?|credential)/i;
const CLI_SECRET_FLAG = /(\s--?(?:password|passphrase|token|secret|api[-_]?key|session(?:id)?)(?:=|\s+))([^\s]+)/gi;
const KV_SECRET = /((?:x-(?:sidelink|altstore)-helper-token|authorization|cookie|password|passphrase|token|secret|api[_-]?key|session(?:id)?)\s*[:=]\s*["']?)([^\s,;"'\]}]+)/gi;
const BEARER_SECRET = /(\bBearer\s+)([A-Za-z0-9._~+\/-]+=*)/gi;

const isSensitiveKey = (key: string | undefined): boolean => {
  if (!key) {
    return false;
  }

  return SENSITIVE_KEY.test(key.trim());
};

const isPreviewValue = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return trimmed.includes('••••') || /^\*{4,}$/.test(trimmed);
};

export const redactSensitiveText = (value: string): string => {
  if (!value) {
    return value;
  }

  return value
    .replace(BEARER_SECRET, `$1${REDACTED}`)
    .replace(CLI_SECRET_FLAG, `$1${REDACTED}`)
    .replace(KV_SECRET, `$1${REDACTED}`);
};

export const redactUnknown = (value: unknown, keyHint?: string, seen = new WeakSet<object>()): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (isSensitiveKey(keyHint)) {
    if (typeof value === 'string') {
      return isPreviewValue(value) ? value : REDACTED;
    }

    return REDACTED;
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, keyHint, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[Circular]';
    }

    seen.add(value as object);

    if (value instanceof Date) {
      seen.delete(value);
      return value.toISOString();
    }

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactUnknown(nested, key, seen);
    }

    seen.delete(value as object);
    return output;
  }

  return value;
};

export { REDACTED };
