// ─── Cross-Platform Path Utilities ──────────────────────────────────
// Platform-aware path resolution for data directories, temp files,
// Python binary, and other resources. Eliminates hardcoded Unix paths.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * Detect if the app is running as a packaged Electron app.
 * When packaged, resources live inside the .asar or extraResources.
 */
export function isPackaged(): boolean {
  // Electron sets this on the app module and also on process
  return (
    !!(process as any).resourcesPath ||
    (typeof process.mainModule?.filename === 'string' && process.mainModule.filename.includes('app.asar'))
  );
}

/**
 * Get the Electron resources path (for extraResources like bundled Python binary).
 * Falls back to a development path if not packaged.
 */
export function getResourcesPath(): string {
  if ((process as any).resourcesPath) {
    return (process as any).resourcesPath;
  }
  // Development fallback: project root
  return process.cwd();
}

/**
 * Get the platform-appropriate default data directory.
 *
 * - macOS:  ~/Library/Application Support/Sidelink
 * - Windows: %APPDATA%/Sidelink
 * - Linux:  ~/.config/sidelink
 * - Dev:    <cwd>/tmp/desktop (when SIDELINK_DEV=1 or not packaged)
 */
export function getDefaultDataDir(): string {
  // Explicit override
  const envDir = process.env.SIDELINK_DATA_DIR || process.env.DATA_DIR;
  if (envDir) return path.resolve(envDir);

  // In development, use local tmp
  if (!isPackaged()) {
    return path.join(process.cwd(), 'tmp', 'desktop');
  }

  // Production: platform-specific app data dir
  const platform = process.platform;
  const home = os.homedir();

  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Sidelink');
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Sidelink');
    case 'linux':
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'sidelink');
  }
}

/**
 * Get default upload directory inside the data dir.
 */
export function getDefaultUploadDir(dataDir?: string): string {
  const envDir = process.env.SIDELINK_UPLOAD_DIR || process.env.UPLOAD_DIR;
  if (envDir) return path.resolve(envDir);
  return path.join(dataDir || getDefaultDataDir(), 'uploads');
}

/**
 * Get default database path inside the data dir.
 */
export function getDefaultDbPath(dataDir?: string): string {
  const envPath = process.env.SIDELINK_DB_PATH;
  if (envPath) return path.resolve(envPath);
  return path.join(dataDir || getDefaultDataDir(), 'sidelink.sqlite');
}

/**
 * Get the temp directory for signing work.
 * Uses os.tmpdir() which is cross-platform.
 */
export function getSigningTempDir(): string {
  return path.join(os.tmpdir(), `sidelink-sign-${Date.now()}`);
}

/**
 * Get the temp directory for general work.
 */
export function getTempDir(prefix = 'sidelink-'): string {
  return path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/**
 * Get the platform/arch identifier for binary resolution.
 * Returns strings like: 'darwin-arm64', 'win32-x64', 'linux-x64'
 */
export function getPlatformArch(): string {
  return `${process.platform}-${process.arch}`;
}

/**
 * Get the executable file extension for the current platform.
 */
export function getExeExtension(): string {
  return process.platform === 'win32' ? '.exe' : '';
}

/**
 * Resolve the path to the bundled Python binary.
 *
 * In production (packaged): <resources>/python/sidelink-python[.exe]
 * In development: falls back to venv or system python3
 */
export function getPythonBinaryPath(): string {
  const exeExt = getExeExtension();
  const binaryName = `sidelink-python${exeExt}`;

  // Check for bundled binary in resources
  const resourcesDir = getResourcesPath();
  const bundledPath = path.join(resourcesDir, 'python', binaryName);
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  // Check for platform-specific binary in project root (CI builds)
  const platformBinary = path.join(process.cwd(), 'python-bundle', 'dist', binaryName);
  if (fs.existsSync(platformBinary)) {
    return platformBinary;
  }

  // Development fallback: venv python
  if (process.platform !== 'win32') {
    const venvPython = path.join(process.cwd(), '.venv', 'bin', 'python3');
    if (fs.existsSync(venvPython)) return venvPython;
  } else {
    const venvPython = path.join(process.cwd(), '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvPython)) return venvPython;
  }

  // Packaged app fallback: find system python3 matching bundled packages
  if (process.platform !== 'win32') {
    // Prefer versioned python matching bundled site-packages (cpython-313)
    const candidates = [
      '/opt/homebrew/bin/python3.13',
      '/usr/local/bin/python3.13',
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // Last resort: system python
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Check if we have a bundled Python binary (vs. falling back to system Python).
 */
export function hasBundledPython(): boolean {
  const exeExt = getExeExtension();
  const binaryName = `sidelink-python${exeExt}`;
  const resourcesDir = getResourcesPath();
  const bundledPath = path.join(resourcesDir, 'python', binaryName);
  return fs.existsSync(bundledPath);
}

/**
 * Locate the pymobiledevice3 CLI executable.
 *
 * Search order:
 *   1. Project venv (installed by system-deps-preflight)
 *   2. Platform-specific user/system pip install locations
 *   3. null (caller should fall back to `python3 -m pymobiledevice3`)
 *
 * The result is cached for the process lifetime.
 */
let _pmd3ExePath: string | null | undefined; // undefined = not yet resolved

export function findPmd3Executable(): string | null {
  if (_pmd3ExePath !== undefined) return _pmd3ExePath;

  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'pymobiledevice3.exe' : 'pymobiledevice3';

  // 1. Project venv (preferred — managed by system-deps-preflight)
  const venvBin = isWin
    ? path.join(process.cwd(), '.venv', 'Scripts', exeName)
    : path.join(process.cwd(), '.venv', 'bin', exeName);
  if (fs.existsSync(venvBin)) {
    _pmd3ExePath = venvBin;
    return venvBin;
  }

  // 2. Platform-specific user/system install locations
  const home = os.homedir();
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    // macOS: user pip installs per Python version, then Homebrew / system-wide
    for (const ver of ['3.13', '3.12', '3.11', '3.10', '3.9']) {
      candidates.push(path.join(home, 'Library', 'Python', ver, 'bin', 'pymobiledevice3'));
    }
    candidates.push('/opt/homebrew/bin/pymobiledevice3', '/usr/local/bin/pymobiledevice3');
  } else if (process.platform === 'linux') {
    // Linux: user pip (~/.local/bin), then system-wide
    candidates.push(
      path.join(home, '.local', 'bin', 'pymobiledevice3'),
      '/usr/local/bin/pymobiledevice3',
      '/usr/bin/pymobiledevice3',
    );
  } else if (isWin) {
    // Windows: user pip installs per Python version
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    for (const ver of ['313', '312', '311', '310']) {
      candidates.push(path.join(appData, 'Python', `Python${ver}`, 'Scripts', exeName));
      candidates.push(path.join(localAppData, 'Programs', 'Python', `Python${ver}`, 'Scripts', exeName));
    }
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _pmd3ExePath = p;
      return p;
    }
  }

  _pmd3ExePath = null;
  return null;
}

/**
 * Resolve the scripts directory.
 * Packaged: <resources>/scripts/
 * Development: <cwd>/scripts/
 */
export function getScriptsPath(): string {
  if (isPackaged()) {
    const resourcesDir = getResourcesPath();
    const bundled = path.join(resourcesDir, 'scripts');
    if (fs.existsSync(bundled)) return bundled;
  }
  return path.join(process.cwd(), 'scripts');
}

/**
 * Resolve the bundled Python packages directory (site-packages).
 * Returns null in development (venv handles it) or if not bundled.
 */
export function getPythonPackagesPath(): string | null {
  if (isPackaged()) {
    const resourcesDir = getResourcesPath();
    const bundled = path.join(resourcesDir, 'python-packages');
    if (fs.existsSync(bundled)) return bundled;
  }
  return null;
}

/**
 * Resolve the path to the bundled helper IPA.
 */
export function getHelperIpaPath(): string {
  // Explicit override
  const envPath = process.env.SIDELINK_HELPER_IPA_PATH;
  if (envPath) return path.resolve(envPath);

  // Bundled in resources
  const resourcesDir = getResourcesPath();
  const bundledPath = path.join(resourcesDir, 'helper', 'SidelinkHelper.ipa');
  if (fs.existsSync(bundledPath)) return bundledPath;

  // Development fallback
  return path.join(process.cwd(), 'tmp', 'helper', 'SidelinkHelper.ipa');
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 * Cross-platform replacement for `mkdir -p`.
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Remove a directory recursively.
 * Cross-platform replacement for `rm -rf`.
 */
export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Get platform display name for UI.
 */
export function getPlatformDisplayName(): string {
  switch (process.platform) {
    case 'darwin': return 'macOS';
    case 'win32': return 'Windows';
    case 'linux': return 'Linux';
    default: return process.platform;
  }
}
