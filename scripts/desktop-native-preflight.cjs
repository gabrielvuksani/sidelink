#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronBin = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
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

const ensureDesktopDeps = () => {
  run(npmCmd, ['run', 'desktop:deps']);
};

const hardRebuildBetterSqlite3 = () => {
  // eslint-disable-next-line no-console
  console.log('[desktop:preflight] Detected Electron ABI mismatch. Rebuilding better-sqlite3 from source...');

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
  if (!fs.existsSync(electronBin)) {
    throw new Error('Electron binary not found. Run `npm install` first.');
  }

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
      `Native module mismatch persists after rebuild.\n${second.output || '(no diagnostic output)'}\nRun \`npm run desktop:deps\`, then \`npm run desktop:dev\`. If it still fails, reinstall Xcode Command Line Tools and retry.`
    );
  }

  // eslint-disable-next-line no-console
  console.log('[desktop:preflight] Native dependency mismatch recovered.');
};

main();
