import bplistParser from 'bplist-parser';
import plist from 'plist';

export const parsePlistBuffer = (buffer: Buffer): Record<string, unknown> => {
  const header = buffer.subarray(0, 8).toString('utf8');

  if (header === 'bplist00') {
    const parsed = bplistParser.parseBuffer(buffer);
    if (!parsed.length || typeof parsed[0] !== 'object' || parsed[0] === null) {
      throw new Error('Binary plist is empty or malformed');
    }

    return parsed[0] as Record<string, unknown>;
  }

  const raw = buffer.toString('utf8').trim();
  const parsed = plist.parse(raw);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Plist did not parse into an object');
  }

  return parsed as Record<string, unknown>;
};

const extractMobileProvisionPlistXml = (buffer: Buffer): string | undefined => {
  const text = buffer.toString('utf8');
  const start = text.indexOf('<?xml');
  const end = text.indexOf('</plist>');

  if (start === -1 || end === -1) {
    return undefined;
  }

  return text.slice(start, end + '</plist>'.length);
};

export const parseMobileProvision = (buffer: Buffer): Record<string, unknown> => {
  const xml = extractMobileProvisionPlistXml(buffer);
  if (!xml) {
    return {};
  }

  const parsed = plist.parse(xml);
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }

  return parsed as Record<string, unknown>;
};

export const parseMobileProvisionEntitlements = (buffer: Buffer): Record<string, unknown> => {
  const parsed = parseMobileProvision(buffer);

  const entitlements = parsed.Entitlements;
  if (!entitlements || typeof entitlements !== 'object') {
    return {};
  }

  return entitlements as Record<string, unknown>;
};

export const normalizeEntitlements = (input: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  Object.entries(input).forEach(([key, value]) => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      normalized[key] = value;
      return;
    }

    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : item));
      return;
    }

    if (typeof value === 'object') {
      normalized[key] = JSON.stringify(value);
      return;
    }

    normalized[key] = String(value);
  });

  return normalized;
};
