// ─── Anisette Provider ──────────────────────────────────────────────
// Generates Apple anisette (machine provisioning) data required for
// authenticating with Apple's servers. Uses the bundled sidelink-python
// binary or falls back to the Python venv anisette-helper.py script.

import path from 'node:path';
import fs from 'node:fs';
import { runCommand } from '../utils/command';
import { getPythonBinaryPath, hasBundledPython, getScriptsPath, getPythonPackagesPath } from '../utils/paths';

export interface AnisetteData {
  'X-Apple-I-MD': string;
  'X-Apple-I-MD-M': string;
  'X-Apple-I-MD-RINFO': string;
  'X-Apple-I-MD-LU': string;
  'X-Apple-I-TimeZone': string;
  'X-Apple-I-Client-Time': string;
  'X-Apple-I-Locale': string;
  'X-Mme-Device-Id': string;
  [key: string]: string;
}

let cachedAnisette: { data: AnisetteData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute — anisette data is time-sensitive

/**
 * Resolve the Python binary for anisette generation.
 * Prefers bundled binary, falls back to venv, then system python3.
 */
function resolvePython(): string {
  return getPythonBinaryPath();
}

/**
 * Get anisette data via the bundled Python binary or helper script.
 * Cached for a short duration since it's time-sensitive.
 */
export async function getAnisetteData(): Promise<AnisetteData> {
  // Return cached if fresh enough
  if (cachedAnisette && Date.now() - cachedAnisette.fetchedAt < CACHE_TTL_MS) {
    return cachedAnisette.data;
  }

  let result;

  // Build env with PYTHONPATH for bundled site-packages
  const extraEnv: Record<string, string> = {};
  const pkgPath = getPythonPackagesPath();
  if (pkgPath) {
    extraEnv.PYTHONPATH = pkgPath;
  }

  if (hasBundledPython()) {
    // Use bundled binary: sidelink-python --command anisette
    const pythonBin = resolvePython();
    result = await runCommand(pythonBin, {
      args: ['--command', 'anisette'],
      timeoutMs: 30_000,
      env: extraEnv,
    });
  } else {
    // Fallback: python3 scripts/anisette-helper.py
    const pythonBin = resolvePython();
    const helperScript = path.join(getScriptsPath(), 'anisette-helper.py');
    result = await runCommand(pythonBin, {
      args: [helperScript],
      timeoutMs: 30_000,
      env: extraEnv,
    });
  }

  if (result.exitCode !== 0) {
    // Try to parse error JSON from the helper
    let detail = result.stderr.trim() || result.stdout.trim();
    try {
      const errObj = JSON.parse(result.stdout.trim());
      if (errObj.error) detail = errObj.error;
    } catch { /* ignore parse errors */ }

    throw new Error(
      `Failed to generate anisette data: ${detail}. ` +
      `Ensure the Python venv is set up: npm install`,
    );
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    const data = parsed as AnisetteData;
    cachedAnisette = { data, fetchedAt: Date.now() };
    return data;
  } catch (err) {
    if (err instanceof Error && err.message && !err.message.startsWith('Failed to parse')) {
      throw err;
    }
    throw new Error(`Failed to parse anisette JSON: ${result.stdout.slice(0, 200)}`);
  }
}

/**
 * Build the complete set of Apple auth headers including anisette.
 */
export async function buildAppleHeaders(extraHeaders?: Record<string, string>): Promise<Record<string, string>> {
  const anisette = await getAnisetteData();

  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Xcode',
    'X-Xcode-Version': '15.2 (15C500b)',
    'X-Apple-App-Info': 'com.apple.gs.xcode.auth',
    // Anisette headers — use values from the provider, which include
    // proper timestamps, timezone, locale, and device ID
    'X-Apple-I-MD': anisette['X-Apple-I-MD'],
    'X-Apple-I-MD-M': anisette['X-Apple-I-MD-M'],
    'X-Apple-I-MD-RINFO': anisette['X-Apple-I-MD-RINFO'] || '17106176',
    'X-Apple-I-MD-LU': anisette['X-Apple-I-MD-LU'] || '',
    'X-Apple-I-TimeZone': anisette['X-Apple-I-TimeZone'] || Intl.DateTimeFormat().resolvedOptions().timeZone,
    'X-Apple-I-Client-Time': anisette['X-Apple-I-Client-Time'] || new Date().toISOString(),
    'X-Apple-I-Locale': anisette['X-Apple-I-Locale'] || anisette['X-Apple-Locale'] || 'en_US',
    'X-Apple-Locale': anisette['X-Apple-Locale'] || 'en_US',
    'X-Mme-Device-Id': anisette['X-Mme-Device-Id'] || '',
    'X-Mme-Client-Info': anisette['X-MMe-Client-Info'] ||
      '<iMac20,2> <Mac OS X;13.0;22A380> <com.apple.AuthKit/1 (com.apple.dt.Xcode/3594.4.19)>',
    ...extraHeaders,
  };
}

/**
 * Clear the anisette cache (for testing or after errors).
 */
export function clearAnisetteCache(): void {
  cachedAnisette = null;
}
