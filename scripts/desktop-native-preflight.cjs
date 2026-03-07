#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const npmCmd = 'npm';

const resolveElectronBinary = () => {
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
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron'
  );

  return fs.existsSync(fallback) ? fallback : null;
};

const electronBin = resolveElectronBinary();

const run = (command, args, options = {}) => {
  const resolvedCommand = process.platform === 'win32' && command === 'npm.cmd' ? 'npm' : command;
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${resolvedCommand} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
};

const checkElectronNative = () => {
  const result = spawnSync(
    electronBin,
    [
      '-e',
      "try { const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.prepare('select 1').get(); db.close(); console.log('electron-native-check:ok'); } catch (error) { console.error(error?.message ?? String(error)); process.exit(1); }"
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
      },
      encoding: 'utf8'
    }
  );

  return {
    ok: (result.status ?? 1) === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  };
};

const { installPrebuild } = require('./install-native-prebuild.cjs');

const tryElectronPrebuild = () => {
  // eslint-disable-next-line no-console
  console.log('[desktop:preflight] Trying bundled Electron prebuild...');
  return installPrebuild('electron');
};

const ensureDesktopDeps = () => {
  run(npmCmd, ['run', 'desktop:deps']);
};

const hardRebuildBetterSqlite3 = () => {
  // eslint-disable-next-line no-console
  console.log('[desktop:preflight] No Electron prebuild available. Rebuilding from source (requires C++ compiler)...');

  try {
    run(npmCmd, ['rebuild', 'better-sqlite3', '--build-from-source']);
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[desktop:preflight] Source rebuild fallback failed (${error?.message ?? error}). Continuing with Electron-specific dependency rebuild.`
    );
    return false;
  }
};

const main = () => {
  if (!electronBin || !fs.existsSync(electronBin)) {
    throw new Error('Electron binary not found. Run `npm install` first.');
  }

  // Try bundled prebuild first (no compiler needed)
  if (tryElectronPrebuild()) {
    const afterPrebuild = checkElectronNative();
    if (afterPrebuild.ok) {
      // eslint-disable-next-line no-console
      console.log('[desktop:preflight] Electron native check passed via bundled prebuild.');
      return;
    }
  }

  // Prebuild didn't work — try electron-builder install-app-deps
  ensureDesktopDeps();

  const first = checkElectronNative();
  if (first.ok) {
    // eslint-disable-next-line no-console
    console.log('[desktop:preflight] Native dependency check passed.');
    return;
  }

  hardRebuildBetterSqlite3();
  ensureDesktopDeps();

  const second = checkElectronNative();
  if (!second.ok) {
    throw new Error(
      `Native module mismatch persists after rebuild.\n${second.output || '(no diagnostic output)'}\nRun \`npm run desktop:deps\`, then \`npm run desktop:dev\`. If it still fails, install Xcode Command Line Tools (xcode-select --install) and retry.`
    );
  }

  // eslint-disable-next-line no-console
  console.log('[desktop:preflight] Native dependency mismatch recovered.');
};

main();
