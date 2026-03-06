// ─── pymobiledevice3 Device Adapter ─────────────────────────────────
// Handles device discovery, info, pairing, app install, and profiles
// using pymobiledevice3. Supports both USB and Wi-Fi connections.
//
// Uses the bundled Python binary (sidelink-python --command pmd3)
// when available, with fallback to system `python3 -m pymobiledevice3`
// for development.

import { runCommand } from '../utils/command';
import { getPythonBinaryPath, hasBundledPython, findPmd3Executable } from '../utils/paths';
import type { DeviceInfo, DeviceConnectionState, DeviceTransport } from '../../shared/types';
import { DeviceError } from '../utils/errors';

const TIMEOUT = 30_000;

// Module-level logger — defaults to console, override via setDeviceLogger()
interface DeviceLogger {
  warn(msg: string): void;
}
let deviceLog: DeviceLogger = { warn: (msg) => console.warn(`[DEVICE] ${msg}`) };
export function setDeviceLogger(l: DeviceLogger): void { deviceLog = l; }

// ─── Pairing State Cache ────────────────────────────────────────────
// Caches validatePairing results to avoid spawning a subprocess for
// every device on every poll cycle (every 5-15 seconds).
const pairingCache = new Map<string, { paired: boolean; expiresAt: number }>();
const PAIRING_CACHE_TTL_MS = 60_000; // 1 minute

function getCachedPairingState(udid: string): boolean | undefined {
  const entry = pairingCache.get(udid);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    pairingCache.delete(udid);
    return undefined;
  }
  return entry.paired;
}

function setCachedPairingState(udid: string, paired: boolean): void {
  pairingCache.set(udid, { paired, expiresAt: Date.now() + PAIRING_CACHE_TTL_MS });
}

// ─── PMD3 Invocation Helper ─────────────────────────────────────────

/**
 * Cached resolution of the pymobiledevice3 invocation strategy.
 * Resolves once per process: CLI script (venv or system) → python -m fallback.
 */
let _pmd3Resolved: { cmd: string; useModule: boolean } | undefined;

function resolvePmd3(): { cmd: string; useModule: boolean } {
  if (_pmd3Resolved) return _pmd3Resolved;

  const cli = findPmd3Executable();
  if (cli) {
    _pmd3Resolved = { cmd: cli, useModule: false };
  } else {
    // Last resort: python3 -m pymobiledevice3 (may fail if not installed)
    _pmd3Resolved = { cmd: getPythonBinaryPath(), useModule: true };
  }
  return _pmd3Resolved;
}

/**
 * Build cmd + args to invoke pymobiledevice3 correctly.
 *
 * Resolution priority:
 *   1. Bundled sidelink-python binary (packaged Electron app)
 *   2. Standalone CLI (venv or system pip install, resolved by findPmd3Executable)
 *   3. python3 -m pymobiledevice3 fallback
 *
 * Global flags (--no-color) are prepended before subcommands.
 */
function pmd3Args(...subcommandAndArgs: string[]): { cmd: string; args: string[] } {
  if (hasBundledPython()) {
    return {
      cmd: getPythonBinaryPath(),
      args: ['--command', 'pmd3', ...subcommandAndArgs],
    };
  }

  const { cmd, useModule } = resolvePmd3();
  return {
    cmd,
    args: useModule
      ? ['-m', 'pymobiledevice3', '--no-color', ...subcommandAndArgs]
      : ['--no-color', ...subcommandAndArgs],
  };
}

// ─── Availability Check ─────────────────────────────────────────────

/**
 * Check if pymobiledevice3 is installed and accessible.
 */
export async function ensurePmd3Available(): Promise<void> {
  const { cmd, args } = pmd3Args('--help');
  const result = await runCommand(cmd, { args, timeoutMs: 10_000 });
  if (result.exitCode !== 0 && !result.stdout.includes('pymobiledevice3')) {
    throw new DeviceError(
      'PMD3_NOT_FOUND',
      'pymobiledevice3 is not installed. Install it with: pip3 install pymobiledevice3',
      'Run: pip3 install pymobiledevice3',
    );
  }
}

// ─── Device Discovery ───────────────────────────────────────────────

/**
 * List all connected devices (USB via usbmuxd).
 */
export async function listUsbDevices(): Promise<DeviceInfo[]> {
  const { cmd, args } = pmd3Args('usbmux', 'list', '--usb');
  const result = await runCommand(cmd, { args, timeoutMs: TIMEOUT });

  if (result.exitCode !== 0) {
    if (result.stderr.includes('No connected devices') || result.stdout.trim() === '') {
      return [];
    }
    deviceLog.warn(`usbmux list --usb failed: ${result.stderr.slice(0, 200)}`);
    return [];
  }

  return parseDeviceList(result.stdout, 'usb');
}

/**
 * Browse for Wi-Fi devices (iOS 17+ RemotePairing via Bonjour).
 */
export async function browseWifiDevices(): Promise<DeviceInfo[]> {
  const { cmd, args } = pmd3Args('usbmux', 'list', '--network');
  const result = await runCommand(cmd, { args, timeoutMs: 10_000 });

  if (result.exitCode !== 0 || result.stdout.trim() === '') {
    return [];
  }

  return parseDeviceList(result.stdout, 'wifi');
}

/**
 * Get all connected devices (USB + Wi-Fi combined).
 */
export async function listAllDevices(): Promise<DeviceInfo[]> {
  const [usbDevices, wifiDevices] = await Promise.all([
    listUsbDevices().catch(() => []),
    browseWifiDevices().catch(() => []),
  ]);

  // Deduplicate by UDID (USB takes precedence)
  const seen = new Set<string>();
  const devices: DeviceInfo[] = [];

  for (const d of usbDevices) {
    if (!seen.has(d.udid)) {
      seen.add(d.udid);
      devices.push(d);
    }
  }
  for (const d of wifiDevices) {
    if (!seen.has(d.udid)) {
      seen.add(d.udid);
      devices.push(d);
    }
  }

  return devices;
}

// ─── Device Info ────────────────────────────────────────────────────

/**
 * Get detailed information about a specific device.
 */
export async function getDeviceInfo(udid: string): Promise<Record<string, string>> {
  const { cmd, args } = pmd3Args('lockdown', 'info', '--udid', udid);
  const result = await runCommand(cmd, { args, timeoutMs: TIMEOUT });

  if (result.exitCode !== 0) {
    throw new DeviceError(
      'DEVICE_INFO_FAILED',
      `Failed to get info for device ${udid}: ${result.stderr.trim()}`,
    );
  }

  // pymobiledevice3 lockdown info outputs JSON
  try {
    const parsed = JSON.parse(result.stdout);
    const info: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      info[k] = String(v);
    }
    return info;
  } catch {
    // Fallback: parse key: value output
    const info: Record<string, string> = {};
    for (const line of result.stdout.split('\n')) {
      const match = line.match(/^\s*(\S[^:]*?):\s+(.+)$/);
      if (match) {
        info[match[1].trim()] = match[2].trim();
      }
    }
    return info;
  }
}

/**
 * Get a specific lockdown value.
 */
export async function getDeviceValue(udid: string, key: string): Promise<string | null> {
  // No -k flag in pymobiledevice3 v7+ — fetch full info and extract key
  const info = await getDeviceInfo(udid);
  return info[key] || null;
}

// ─── Device Pairing ─────────────────────────────────────────────────

/**
 * Pair with a device (equivalent to "Trust This Computer").
 */
export async function pairDevice(udid: string): Promise<void> {
  const { cmd, args } = pmd3Args('lockdown', 'pair', '--udid', udid);
  const result = await runCommand(cmd, { args, timeoutMs: 60_000 });

  if (result.exitCode !== 0) {
    throw new DeviceError(
      'DEVICE_PAIR_FAILED',
      `Failed to pair device ${udid}: ${result.stderr.trim()}`,
      'Unlock the device and tap "Trust" when prompted.',
    );
  }
  // Invalidate cache so next check re-validates
  pairingCache.delete(udid);
}

/**
 * Validate that a device is paired. Uses a 60-second TTL cache to
 * avoid spawning a subprocess on every poll cycle.
 */
export async function validatePairing(udid: string): Promise<boolean> {
  const cached = getCachedPairingState(udid);
  if (cached !== undefined) return cached;

  // validate-pair doesn't exist in pymobiledevice3 v7+.
  // Use `lockdown info` as a proxy — if it succeeds and returns JSON, the device is paired.
  const { cmd, args } = pmd3Args('lockdown', 'info', '--udid', udid);
  const result = await runCommand(cmd, { args, timeoutMs: TIMEOUT });
  const paired = result.exitCode === 0 && result.stdout.trim().length > 0;
  setCachedPairingState(udid, paired);
  return paired;
}

// ─── App Installation ───────────────────────────────────────────────

// ─── Install Error Parsing ──────────────────────────────────────────

/** Known iOS installation error codes and human-friendly messages */
const INSTALL_ERROR_HINTS: Record<string, string> = {
  '0xe8008001': 'Code signature verification failed. This commonly happens with complex apps (multiple extensions or frameworks) on free developer accounts.',
  '0xe8008005': 'The app\'s entitlements are invalid or not allowed by the provisioning profile.',
  '0xe8008015': 'No valid provisioning profile was found for this app.',
  '0xe8008016': 'The app\'s entitlements do not match the provisioning profile.',
  '0xe8008017': 'The code signature is invalid or corrupted.',
  '0xe800801c': 'This device is not included in the provisioning profile.',
};

const INSTALL_ERROR_TYPES: Record<string, string> = {
  'ApplicationVerificationFailed': 'The device could not verify the app\'s code signature. Complex apps with extensions may not work with free accounts.',
  'MismatchedApplicationIdentifierEntitlement': 'The app\'s bundle identifier does not match the provisioning profile.',
  'PackageInspectionFailed': 'The IPA package appears to be damaged or invalid.',
  'DeviceOSVersionTooLow': 'The device\'s iOS version is too old for this app.',
};

/**
 * Parse pymobiledevice3 install output and return a clean error message.
 * Strips Rich box-drawing tracebacks and maps known error codes.
 */
function parseInstallError(output: string): string {
  // Strip ANSI escape codes and Rich box-drawing characters
  const cleaned = output
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/[╭╮╰╯│─┼┤├┬┴]+/g, ' ');

  // Look for AppInstallError anywhere in the output
  const match = cleaned.match(/AppInstallError:\s*(.+)/s);
  if (match) {
    const errorBody = match[1].replace(/\s+/g, ' ').trim();

    // Check for hex error code (e.g. 0xe8008001)
    const codeMatch = errorBody.match(/(0x[0-9a-fA-F]+)/i);
    if (codeMatch) {
      const hint = INSTALL_ERROR_HINTS[codeMatch[1].toLowerCase()];
      if (hint) return hint;
    }

    // Check for known error type name (e.g. ApplicationVerificationFailed)
    const typeMatch = errorBody.match(/^(\w+):/);
    if (typeMatch) {
      const hint = INSTALL_ERROR_TYPES[typeMatch[1]];
      if (hint) return hint;
    }

    // Return the cleaned error body, capped
    return errorBody.slice(0, 300);
  }

  // Fallback: return last non-empty line
  const lastLine = output.trim().split('\n').filter(l => l.trim()).pop()?.trim();
  return lastLine?.slice(0, 200) ?? 'Installation failed for an unknown reason.';
}

// ─── App Installation ───────────────────────────────────────────────

/**
 * Install an IPA on a device via USB.
 */
export async function installApp(udid: string, ipaPath: string): Promise<void> {
  const { cmd, args } = pmd3Args('apps', 'install', ipaPath, '--udid', udid);
  const result = await runCommand(cmd, { args, timeoutMs: 180_000 });

  if (result.exitCode !== 0) {
    const rawOutput = result.stderr.trim() || result.stdout.trim();
    throw new DeviceError(
      'APP_INSTALL_FAILED',
      parseInstallError(rawOutput),
    );
  }
}

/**
 * Install an IPA on a device via Wi-Fi tunnel.
 */
export async function installAppWifi(
  host: string,
  port: number,
  ipaPath: string,
): Promise<void> {
  const { cmd, args } = pmd3Args('apps', 'install', ipaPath, '--rsd', host, String(port));
  const result = await runCommand(cmd, { args, timeoutMs: 300_000 });

  if (result.exitCode !== 0) {
    const rawOutput = result.stderr.trim() || result.stdout.trim();
    throw new DeviceError(
      'APP_INSTALL_WIFI_FAILED',
      parseInstallError(rawOutput),
    );
  }
}

/**
 * Uninstall an app from a device.
 */
export async function uninstallApp(udid: string, bundleId: string): Promise<void> {
  const { cmd, args } = pmd3Args('apps', 'uninstall', bundleId, '--udid', udid);
  const result = await runCommand(cmd, { args, timeoutMs: TIMEOUT });

  if (result.exitCode !== 0) {
    throw new DeviceError(
      'APP_UNINSTALL_FAILED',
      `Failed to uninstall ${bundleId} from ${udid}: ${result.stderr.trim()}`,
    );
  }
}

/**
 * List installed apps on a device.
 */
export async function listInstalledApps(udid: string): Promise<string[]> {
  const { cmd, args } = pmd3Args('apps', 'list', '--udid', udid);
  const result = await runCommand(cmd, { args, timeoutMs: TIMEOUT });

  if (result.exitCode !== 0) return [];

  // Try JSON parse first, fall back to line-by-line
  try {
    const parsed = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) return parsed.map(String);
    if (typeof parsed === 'object') return Object.keys(parsed);
  } catch {
    // Fallback: parse output for bundle IDs
    const bundleIds: string[] = [];
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && trimmed.includes('.')) {
        bundleIds.push(trimmed);
      }
    }
    return bundleIds;
  }
  return [];
}

// ─── Profile Management ─────────────────────────────────────────────

/**
 * Install a provisioning profile on a device.
 */
export async function installProfile(udid: string, profilePath: string): Promise<void> {
  const { cmd, args } = pmd3Args('profile', 'install', profilePath, '--udid', udid);
  const result = await runCommand(cmd, { args, timeoutMs: TIMEOUT });

  if (result.exitCode !== 0) {
    throw new DeviceError(
      'PROFILE_INSTALL_FAILED',
      `Failed to install provisioning profile: ${result.stderr.trim()}`,
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Parse JSON output from `usbmux list` into DeviceInfo[].
 * The output is an array of objects with keys like:
 *   ConnectionType, DeviceName, Identifier, ProductType, ProductVersion, etc.
 */
async function parseDeviceList(stdout: string, transport: DeviceTransport): Promise<DeviceInfo[]> {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];

    return await Promise.all(
      parsed.map(async (entry: any): Promise<DeviceInfo | null> => {
        const udid = entry.Identifier || entry.UniqueDeviceID || entry.SerialNumber || '';
        if (!udid) return null;

        // usbmux list already gives us some info — use it directly
        // to avoid an extra lockdown call for every device.
        const name = entry.DeviceName || 'Unknown Device';
        const productType = entry.ProductType || 'Unknown';
        const iosVersion = entry.ProductVersion || 'Unknown';
        const wifiAddress = transport === 'wifi' ? extractWifiAddress(entry) : null;

        // Quick pairing check
        const paired = await validatePairing(udid).catch(() => false);

        const device: DeviceInfo = {
          udid,
          name,
          model: productType,
          productType,
          iosVersion,
          connection: paired ? 'online' : 'unpaired',
          transport,
          wifiAddress,
          paired,
        };
        return device;
      }),
    ).then(results => results.filter((d): d is DeviceInfo => d !== null));
  } catch (e) {
    deviceLog.warn(`Failed to parse usbmux list JSON: ${String(e).slice(0, 200)}`);
    return [];
  }
}

function extractWifiAddress(entry: Record<string, unknown>): string | null {
  const host = pickFirstString(entry, [
    'RSDAddress',
    'rsdAddress',
    'Address',
    'Host',
    'Hostname',
    'RemoteAddress',
  ]);

  const port = pickFirstPort(entry, [
    'RSDPort',
    'rsdPort',
    'Port',
    'RemotePort',
  ]);

  if (!host || !port) return null;
  return `${host}:${port}`;
}

function pickFirstString(entry: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickFirstPort(entry: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = entry[key];
    const asNumber = typeof value === 'number'
      ? value
      : (typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN);

    if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= 65535) {
      return asNumber;
    }
  }
  return null;
}

