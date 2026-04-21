// ─── Shared Signing Utilities ───────────────────────────────────────
// Common constants and helpers used by both the cross-platform
// TypeScript signer and the legacy macOS codesign signer.

import path from 'node:path';
import fs from 'node:fs/promises';
import { parsePlistFile, writePlistFile } from '../utils/plist';

// ─── Constants ──────────────────────────────────────────────────────

/** Entitlement key prefixes stripped from signed apps */
export const STRIP_ENTITLEMENT_PREFIXES = [
  'com.apple.private.',
  'com.apple.security.',
];

/** Exact entitlement keys stripped from signed apps */
export const STRIP_ENTITLEMENT_KEYS = [
  'beta-reports-active',
  'com.apple.developer.team-identifier',
];

// ─── Bundle-ID Rewriting ────────────────────────────────────────────

/**
 * Recursively rewrite all Info.plist bundle identifiers in an app bundle.
 * Handles both exact matches and sub-bundle prefix rewrites.
 */
export async function rewriteBundleIdentifiers(
  appPath: string,
  from: string,
  to: string,
): Promise<void> {
  const plists = await findInfoPlists(appPath);

  for (const plistPath of plists) {
    try {
      const plist = await parsePlistFile(plistPath);
      const currentId = String(plist['CFBundleIdentifier'] || '');

      if (currentId === from) {
        plist['CFBundleIdentifier'] = to;
      } else if (currentId.startsWith(from + '.')) {
        // Sub-bundle: remap prefix
        plist['CFBundleIdentifier'] = to + currentId.slice(from.length);
      } else {
        continue; // Not related to our bundle
      }

      await writePlistFile(plistPath, plist);
    } catch {
      // Skip plists that can't be parsed (e.g., binary-only frameworks)
    }
  }
}

/**
 * Recursively find all Info.plist files in a directory.
 */
export async function findInfoPlists(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findInfoPlists(fullPath));
    } else if (entry.name === 'Info.plist') {
      results.push(fullPath);
    }
  }

  return results;
}

// ─── Entitlement Building ───────────────────────────────────────────

/**
 * Build signing entitlements from the provisioning profile's entitlements.
 * Strips private/dangerous entitlements and sets required keys.
 */
export function buildSigningEntitlements(
  profileEntitlements: Record<string, unknown>,
  teamId: string,
  bundleId: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  const entitlements: Record<string, unknown> = {};

  // Copy all entitlements from profile, filtering out dangerous ones
  for (const [key, value] of Object.entries(profileEntitlements)) {
    if (STRIP_ENTITLEMENT_PREFIXES.some(p => key.startsWith(p))) continue;
    if (STRIP_ENTITLEMENT_KEYS.includes(key)) continue;
    entitlements[key] = value;
  }

  // Set required entitlements
  const appIdentifier = `${teamId}.${bundleId}`;
  entitlements['application-identifier'] = appIdentifier;
  entitlements['com.apple.developer.team-identifier'] = teamId;
  entitlements['get-task-allow'] = true; // Development profile

  // Normalize keychain access groups
  let keychainGroups = entitlements['keychain-access-groups'] as string[] | undefined;
  if (keychainGroups && Array.isArray(keychainGroups)) {
    keychainGroups = keychainGroups.map(g =>
      g.replace('$(AppIdentifierPrefix)', `${teamId}.`)
       .replace('$(TeamIdentifierPrefix)', `${teamId}.`),
    );
  }
  if (!keychainGroups || keychainGroups.length === 0) {
    keychainGroups = [appIdentifier];
  }
  entitlements['keychain-access-groups'] = [...new Set(keychainGroups)];

  // Apply overrides
  if (overrides) {
    Object.assign(entitlements, overrides);
  }

  return entitlements;
}
