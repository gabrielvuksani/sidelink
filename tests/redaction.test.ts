// ─── Redaction Tests ─────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { redact, redactObject } from '../src/server/utils/redaction';

describe('redact', () => {
  it('redacts bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.abc.def';
    const result = redact(input);
    expect(result).not.toContain('eyJhbGciOiJSUzI1NiJ9');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts private keys', () => {
    const input = `Here is a key:
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...base64data...
-----END RSA PRIVATE KEY-----
and more text.`;
    const result = redact(input);
    expect(result).not.toContain('MIIEpAIBAAKCAQEA');
    expect(result).toContain('[REDACTED-PRIVATE-KEY]');
    expect(result).toContain('and more text.');
  });

  it('partially redacts email addresses', () => {
    const input = 'User email: john.doe@example.com';
    const result = redact(input);
    expect(result).not.toContain('john.doe@example.com');
    expect(result).toContain('@example.com'); // Domain preserved
    expect(result).toContain('j***@'); // First char + redaction
  });

  it('redacts cookies', () => {
    const input = 'Cookie: session=abc123; auth=xyz789';
    const result = redact(input);
    expect(result).toContain('[REDACTED]');
  });

  it('leaves non-sensitive text intact', () => {
    const input = 'This is a normal log message about step 3 completing.';
    const result = redact(input);
    expect(result).toBe(input);
  });

  it('handles empty string', () => {
    expect(redact('')).toBe('');
  });
});

describe('redactObject', () => {
  it('redacts string values in objects', () => {
    const input = { message: 'hello', password: 'supersecret' };
    const result = redactObject(input);
    expect(result.message).toBe('hello');
    expect(result.password).toBe('[REDACTED]');
  });

  it('redacts sensitive keys (case-insensitive)', () => {
    const input = {
      APIToken: 'my-token',
      secretKey: 'my-secret',
      Cookie: 'session=abc',
      normal: 'safe value',
    };
    const result = redactObject(input);
    expect(result.APIToken).toBe('[REDACTED]');
    expect(result.secretKey).toBe('[REDACTED]');
    expect(result.Cookie).toBe('[REDACTED]');
    expect(result.normal).toBe('safe value');
  });

  it('handles nested objects', () => {
    const input = {
      user: {
        email: 'test@example.com',
        password: 'hidden',
      },
    };
    const result = redactObject(input);
    expect((result.user as Record<string, string>).password).toBe('[REDACTED]');
  });

  it('handles arrays', () => {
    const input = ['Bearer abc123', 'normal text'];
    const result = redactObject(input);
    expect(result[0]).toContain('[REDACTED]');
    expect(result[1]).toBe('normal text');
  });

  it('passes through non-object/string values', () => {
    expect(redactObject(42)).toBe(42);
    expect(redactObject(null)).toBe(null);
    expect(redactObject(true)).toBe(true);
  });
});
