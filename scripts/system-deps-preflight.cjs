#!/usr/bin/env node

// ─── System Dependency Preflight ─────────────────────────────────────
// Ensures all external (non-npm) tools are available.
// Runs automatically via npm postinstall.
//
// Cross-platform strategy:
//   1. macOS only: Check for Homebrew
//   2. Check for Python 3.10+ (Homebrew on macOS, system on Linux/Windows)
//   3. Create project-local .venv with required Python packages
//      (anisette, pymobiledevice3, etc.)
//   4. Check for platform-specific USB stack:
//      - macOS:   libimobiledevice (via Homebrew)
//      - Linux:   usbmuxd service
//      - Windows: Apple Mobile Device Service (via iTunes)
//
// Note: Xcode CLI Tools are NOT required. Native modules (better-sqlite3)
// use bundled prebuilt binaries. The pure TS signer replaces codesign.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PLATFORM = os.platform(); // 'darwin' | 'linux' | 'win32'
const IS_WIN = PLATFORM === 'win32';
const IS_MAC = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Cross-platform which: find an executable on PATH.
 * Returns the full path or null.
 */
function which(cmd) {
  if (IS_WIN) {
    const r = spawnSync('where', [cmd], {
      encoding: 'utf8', timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0].trim() : null;
  }
  const r = spawnSync('which', [cmd], {
    encoding: 'utf8', timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts.timeout ?? 30000,
    stdio: opts.stdio ?? 'inherit',
    ...opts,
  });
}

/**
 * Extract the bare package name from a pip specifier (e.g. 'foo>=1.2' → 'foo').
 */
function pkgName(specifier) {
  return specifier.split(/[><=!~]/)[0];
}

const ok   = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`\x1b[33m⚠\x1b[0m ${msg}`);
const fail = (msg) => console.log(`\x1b[31m✗\x1b[0m ${msg}`);
const info = (msg) => console.log(`  ${msg}`);

// ── Python Discovery ─────────────────────────────────────────────────

/**
 * Find the best Python 3 binary (3.10+ required).
 * Checks platform-specific locations, then falls back to PATH.
 */
function findPython3() {
  if (IS_MAC) {
    // Prefer Homebrew pythons (descending version)
    const brewPrefix = which('brew')
      ? spawnSync('brew', ['--prefix'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).stdout.trim()
      : '/opt/homebrew';

    for (const ver of ['3.13', '3.12', '3.11', '3.10']) {
      const candidate = path.join(brewPrefix, 'bin', `python${ver}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  if (IS_WIN) {
    // Windows: check common Python install locations
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    for (const ver of ['313', '312', '311', '310']) {
      const candidate = path.join(localAppData, 'Programs', 'Python', `Python${ver}`, 'python.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // All platforms: try python3 (or python on Windows) on PATH
  const pythonCmd = IS_WIN ? 'python' : 'python3';
  const sys = which(pythonCmd);
  if (sys) {
    const r = spawnSync(sys, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = (r.stdout || '') + (r.stderr || '');
    const m = output.match(/Python 3\.(\d+)/);
    if (m && parseInt(m[1], 10) >= 10) return sys;
  }

  // Windows: also try the py launcher
  if (IS_WIN) {
    const py = which('py');
    if (py) {
      const r = spawnSync(py, ['-3', '--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
      const output = (r.stdout || '') + (r.stderr || '');
      const m = output.match(/Python 3\.(\d+)/);
      if (m && parseInt(m[1], 10) >= 10) return py;
    }
  }

  return null;
}

// ── Check: Homebrew (macOS only) ─────────────────────────────────────

function checkBrew() {
  if (!IS_MAC) return true; // N/A on other platforms

  if (which('brew')) {
    ok('Homebrew');
    return true;
  }

  warn('Homebrew not found.');
  info('Install manually: https://brew.sh');
  return false;
}

// ── Check: Python 3.10+ ─────────────────────────────────────────────

function checkPython() {
  const py = findPython3();
  if (py) {
    const r = spawnSync(py, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    const ver = (r.stdout || r.stderr || '').trim();
    ok(`Python 3 (${ver} — ${py})`);
    return true;
  }

  fail('Python 3.10+ not found.');
  if (IS_MAC) {
    info('Install: brew install python@3.13');
  } else if (IS_LINUX) {
    info('Install: sudo apt install python3 python3-venv  (Debian/Ubuntu)');
    info('     or: sudo dnf install python3              (Fedora)');
  } else if (IS_WIN) {
    info('Install from: https://www.python.org/downloads/');
    info('Make sure to check "Add Python to PATH" during installation.');
  }
  return false;
}

// ── Check: Python venv with all packages ─────────────────────────────

function checkVenv() {
  const venvDir = path.join(process.cwd(), '.venv');
  const venvPython = IS_WIN
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3');
  const venvPip = IS_WIN
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');

  const py = findPython3();
  if (!py) {
    warn('Cannot set up Python venv — Python 3.10+ not available.');
    return false;
  }

  // Create venv if it doesn't exist or if it's stale (broken interpreter)
  let needsCreation = !fs.existsSync(venvPython);
  if (!needsCreation) {
    // Verify the venv interpreter actually works (catches moved/renamed projects)
    const probe = run(venvPython, ['-c', 'print("ok")'], {
      timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (probe.status !== 0 || !(probe.stdout || '').includes('ok')) {
      warn('Existing .venv is stale (broken interpreter). Recreating...');
      fs.rmSync(venvDir, { recursive: true, force: true });
      needsCreation = true;
    }
  }
  if (needsCreation) {
    info('Creating Python virtual environment (.venv)...');
    const r = run(py, ['-m', 'venv', venvDir], { timeout: 30000 });
    if (r.status !== 0) {
      warn('Failed to create .venv');
      info(`Run manually: ${py} -m venv .venv`);
      if (IS_LINUX) info('You may need: sudo apt install python3-venv');
      return false;
    }
  }

  // All Python packages the server needs at runtime:
  //   anisette            — provisioning data generation
  //   srp, etc.           — GSA Apple authentication
  //   truststore          — system CA store access (macOS SSL)
  //   pymobiledevice3     — USB/WiFi device detection, app install, profiles
  const requiredPackages = [
    'anisette>=1.2.0',
    'srp==1.0.21',
    'requests==2.32.3',
    'cryptography==44.0.3',
    'truststore>=0.10.0',
    'pymobiledevice3>=4.0.0',
  ];

  // Check if all packages are already installed in venv
  let allInstalled = true;
  for (const pkg of requiredPackages) {
    const name = pkgName(pkg);
    const checkR = run(venvPip, ['show', name], { timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (checkR.status !== 0) {
      allInstalled = false;
      break;
    }
  }
  if (allInstalled) {
    ok('Python venv + all packages');
    return true;
  }

  // Install all required packages into venv
  info('Installing Python packages into .venv (this may take a minute)...');
  const installR = run(venvPip, ['install', ...requiredPackages], { timeout: 300000 });
  if (installR.status === 0) {
    ok('Python venv + packages installed');
    return true;
  }

  warn('Failed to install Python packages into .venv.');
  info(`Run manually: ${venvPip} install ${requiredPackages.map(p => `'${p}'`).join(' ')}`);
  return false;
}

// ── Check: USB stack (platform-specific) ─────────────────────────────

function checkUsbStack() {
  if (IS_MAC) return checkUsbStackMac();
  if (IS_LINUX) return checkUsbStackLinux();
  if (IS_WIN) return checkUsbStackWindows();
  return false;
}

/** macOS: libimobiledevice via Homebrew */
function checkUsbStackMac() {
  if (which('idevice_id') || which('ideviceinfo')) {
    ok('libimobiledevice');
    return true;
  }

  if (!which('brew')) {
    warn('libimobiledevice not found and Homebrew is unavailable.');
    info('Install Homebrew (https://brew.sh) then: brew install libimobiledevice');
    return false;
  }

  info('Installing libimobiledevice...');
  const r = run('brew', ['install', 'libimobiledevice'], { timeout: 300000 });
  if (r.status === 0) {
    ok('libimobiledevice installed');
    return true;
  }

  warn('Failed to install libimobiledevice.');
  info('Install manually: brew install libimobiledevice');
  return false;
}

/** Linux: usbmuxd daemon (talks to iOS devices over USB) */
function checkUsbStackLinux() {
  // usbmuxd may be running as a service even if the binary isn't on PATH
  if (which('usbmuxd') || fs.existsSync('/run/usbmuxd') || fs.existsSync('/var/run/usbmuxd')) {
    ok('usbmuxd');
    return true;
  }

  warn('usbmuxd not found.');
  info('Install: sudo apt install usbmuxd         (Debian/Ubuntu)');
  info('     or: sudo dnf install usbmuxd         (Fedora)');
  info('     or: sudo pacman -S usbmuxd           (Arch)');
  return false;
}

/** Windows: Apple Mobile Device Service (bundled with iTunes) */
function checkUsbStackWindows() {
  // Check if Apple Mobile Device Service is registered and running
  const r = spawnSync('sc', ['query', 'Apple Mobile Device Service'], {
    encoding: 'utf8', timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status === 0 && (r.stdout || '').includes('RUNNING')) {
    ok('Apple Mobile Device Service (iTunes)');
    return true;
  }

  // Fallback: check for Apple Mobile Device Support directory
  const commonFiles = process.env['CommonProgramFiles'] || 'C:\\Program Files\\Common Files';
  const amdDir = path.join(commonFiles, 'Apple', 'Mobile Device Support');
  if (fs.existsSync(amdDir)) {
    ok('Apple Mobile Device Support');
    return true;
  }

  warn('Apple Mobile Device Service not found.');
  info('Install iTunes from https://www.apple.com/itunes/ or the Microsoft Store.');
  info('iTunes includes the USB drivers needed for iOS device communication.');
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  console.log('\n\x1b[1m[sidelink] Checking system dependencies...\x1b[0m\n');

  const brew   = checkBrew();
  const python = checkPython();
  const venv   = python ? checkVenv() : false;
  const usb    = checkUsbStack();

  console.log('');

  if (python && venv && usb) {
    console.log('\x1b[32m\x1b[1m[sidelink] All dependencies ready.\x1b[0m\n');
  } else {
    console.log('\x1b[33m\x1b[1m[sidelink] Some dependencies are missing \u2014 see above.\x1b[0m');
    console.log('The server will start but some features may not work until they are installed.\n');
  }
}

main();
