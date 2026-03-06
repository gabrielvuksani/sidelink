// ─── Security Utilities Tests ─────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeString,
  isValidEmail,
  isValidUUID,
  isValidUDID,
} from '../src/server/utils/security';

describe('sanitizeString', () => {
  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('removes null bytes', () => {
    expect(sanitizeString('he\0llo')).toBe('hello');
  });

  it('truncates to maxLength', () => {
    expect(sanitizeString('abcdefgh', 5)).toBe('abcde');
  });

  it('returns undefined for non-string input', () => {
    expect(sanitizeString(123)).toBeUndefined();
    expect(sanitizeString(null)).toBeUndefined();
    expect(sanitizeString(undefined)).toBeUndefined();
    expect(sanitizeString({})).toBeUndefined();
  });

  it('handles empty strings', () => {
    expect(sanitizeString('')).toBe('');
    expect(sanitizeString('   ')).toBe('');
  });
});

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user.name@domain.co.uk')).toBe(true);
    expect(isValidEmail('a@b.cc')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@domain.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('user @domain.com')).toBe(false);
  });

  it('rejects emails over 254 chars', () => {
    const longEmail = 'a'.repeat(250) + '@b.cc';
    expect(isValidEmail(longEmail)).toBe(false);
  });
});

describe('isValidUUID', () => {
  it('accepts valid UUID v4', () => {
    expect(isValidUUID('12345678-1234-4123-8123-123456789abc')).toBe(true);
    expect(isValidUUID('00000000-0000-4000-a000-000000000000')).toBe(true);
  });

  it('rejects non-v4 UUIDs', () => {
    expect(isValidUUID('12345678-1234-1234-1234-123456789abc')).toBe(false); // version 1
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('')).toBe(false);
  });
});

describe('isValidUDID', () => {
  it('accepts 40-char hex UDIDs', () => {
    expect(isValidUDID('a'.repeat(40))).toBe(true);
    expect(isValidUDID('0123456789abcdef0123456789ABCDEF01234567')).toBe(true);
  });

  it('accepts UUID-style UDIDs (newer devices)', () => {
    expect(isValidUDID('00008110-001234560A12401E')).toBe(true);
  });

  it('rejects invalid UDIDs', () => {
    expect(isValidUDID('too-short')).toBe(false);
    expect(isValidUDID('')).toBe(false);
    expect(isValidUDID('g'.repeat(40))).toBe(false); // not hex
  });
});
