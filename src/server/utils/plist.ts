// ─── Plist Utilities ────────────────────────────────────────────────
// Parse and build Apple XML and binary plists.

import plist from 'plist';
import bplistParser from 'bplist-parser';
import { readFile, writeFile } from 'node:fs/promises';

/**
 * Parse a plist file (XML or binary).
 */
export async function parsePlistFile(filePath: string): Promise<Record<string, unknown>> {
  const data = await readFile(filePath);
  return parsePlistBuffer(data);
}

/**
 * Parse plist from a Buffer (XML or binary).
 */
export function parsePlistBuffer(data: Buffer): Record<string, unknown> {
  // Try binary first (starts with 'bplist')
  if (data[0] === 0x62 && data[1] === 0x70) {
    const parsed = bplistParser.parseBuffer(data);
    return (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown>;
  }
  // XML plist
  const xml = data.toString('utf8');
  return plist.parse(xml) as Record<string, unknown>;
}

/**
 * Build an XML plist string from an object.
 */
export function buildPlist(obj: Record<string, unknown>): string {
  return plist.build(obj as any) as unknown as string;
}

/**
 * Write a plist object to a file.
 */
export async function writePlistFile(filePath: string, obj: Record<string, unknown>): Promise<void> {
  const xml = buildPlist(obj);
  await writeFile(filePath, xml, 'utf8');
}

/**
 * Parse a .mobileprovision file.
 * The provision profile is a CMS-signed plist wrapped in DER.
 * We extract the plist XML between <?xml and </plist> tags.
 */
export function parseMobileProvision(data: Buffer): Record<string, unknown> {
  const str = data.toString('latin1');
  const xmlStart = str.indexOf('<?xml');
  const xmlEnd = str.indexOf('</plist>');
  if (xmlStart === -1 || xmlEnd === -1) {
    throw new Error('Invalid mobileprovision: no embedded plist found');
  }
  const xmlStr = str.slice(xmlStart, xmlEnd + '</plist>'.length);
  return plist.parse(xmlStr) as Record<string, unknown>;
}
