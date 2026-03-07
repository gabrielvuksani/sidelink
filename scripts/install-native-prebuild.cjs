#!/usr/bin/env node

// ─── Native Prebuild Installer ───────────────────────────────────────
// Copies the correct pre-compiled better_sqlite3.node binary into
// node_modules/better-sqlite3/build/Release/ based on the current
// platform, architecture, and runtime (Node vs Electron).
//
// This eliminates the need for Xcode CLI Tools / node-gyp at install
// time — prebuilt binaries for supported platforms are committed to
// the prebuilds/ directory.
//
// Usage:
//   node scripts/install-native-prebuild.cjs [--runtime node|electron]
//
// Supported prebuilds:
//   prebuilds/<platform>-<arch>/better_sqlite3.node.<runtime>-abi-<N>

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

function resolveElectronBinary() {
  try {
    const electronPath = require('electron');
    if (typeof electronPath === 'string' && fs.existsSync(electronPath)) {
      return electronPath;
    }
  } catch {
    // Fall through to the local .bin shim.
  }

  const fallback = path.join(
    rootDir,
    'node_modules', '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron',
  );

  return fs.existsSync(fallback) ? fallback : null;
}

function getNodeAbi() {
  return process.versions.modules;
}

function getElectronAbi() {
  const electronBin = resolveElectronBinary();
  if (!fs.existsSync(electronBin)) return null;

  const r = spawnSync(electronBin, ['-e', 'process.stdout.write(process.versions.modules)'], {
    cwd: rootDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 10_000,
  });

  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * Install a prebuild for the given runtime.
 * @param {'node'|'electron'} runtime
 * @returns {boolean} true if installed
 */
function installPrebuild(runtime) {
  const platform = process.platform;
  const arch = process.arch;
  const abi = runtime === 'electron' ? getElectronAbi() : getNodeAbi();

  if (!abi) {
    console.warn(`[prebuild] Could not determine ${runtime} ABI.`);
    return false;
  }

  const prebuildDir = path.join(rootDir, 'prebuilds', `${platform}-${arch}`);
  const prebuildFile = path.join(prebuildDir, `better_sqlite3.node.${runtime}-abi-${abi}`);

  if (!fs.existsSync(prebuildFile)) {
    console.warn(`[prebuild] No prebuild found for ${platform}-${arch} ${runtime} ABI ${abi}`);
    console.warn(`[prebuild] Expected: ${prebuildFile}`);
    return false;
  }

  const targetDir = path.join(rootDir, 'node_modules', 'better-sqlite3', 'build', 'Release');
  fs.mkdirSync(targetDir, { recursive: true });

  const targetFile = path.join(targetDir, 'better_sqlite3.node');
  fs.copyFileSync(prebuildFile, targetFile);
  console.log(`[prebuild] Installed ${runtime} ABI ${abi} prebuild for ${platform}-${arch}`);
  return true;
}

// ── CLI ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const runtimeIdx = args.indexOf('--runtime');
  const runtime = runtimeIdx >= 0 ? args[runtimeIdx + 1] : 'node';

  if (runtime !== 'node' && runtime !== 'electron') {
    console.error('Usage: install-native-prebuild.cjs [--runtime node|electron]');
    process.exit(1);
  }

  if (!installPrebuild(runtime)) {
    console.warn(`[prebuild] Prebuild not available — falling back to npm rebuild.`);
    process.exit(1);
  }
}

module.exports = { installPrebuild };
