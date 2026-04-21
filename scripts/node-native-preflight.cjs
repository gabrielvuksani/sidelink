#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const betterSqliteBuildDir = path.join(rootDir, 'node_modules', 'better-sqlite3', 'build');

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
};

const checkNodeNative = () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      "try { const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.prepare('select 1').get(); db.close(); console.log('node-native-check:ok'); } catch (error) { console.error(error?.message ?? String(error)); process.exit(1); }"
    ],
    {
      cwd: rootDir,
      encoding: 'utf8'
    }
  );

  return {
    ok: (result.status ?? 1) === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  };
};

const { installPrebuild } = require('./install-native-prebuild.cjs');

const tryPrebuild = () => {
  // eslint-disable-next-line no-console
  console.log('[node:preflight] Trying bundled prebuild...');
  return installPrebuild('node');
};

const rebuildForNode = () => {
  // eslint-disable-next-line no-console
  console.log('[node:preflight] No prebuild available. Rebuilding better-sqlite3 from source (requires C++ compiler)...');
  fs.rmSync(betterSqliteBuildDir, { recursive: true, force: true });
  run(npmCmd, ['rebuild', 'better-sqlite3', '--build-from-source']);
};

const main = () => {
  const first = checkNodeNative();
  if (first.ok) {
    // eslint-disable-next-line no-console
    console.log('[node:preflight] Native dependency check passed.');
    return;
  }

  // Try bundled prebuild first (no compiler needed)
  if (tryPrebuild()) {
    const afterPrebuild = checkNodeNative();
    if (afterPrebuild.ok) {
      // eslint-disable-next-line no-console
      console.log('[node:preflight] Recovered using bundled prebuild.');
      return;
    }
  }

  // Fall back to compiling from source
  rebuildForNode();

  const second = checkNodeNative();
  if (!second.ok) {
    throw new Error(
      `Host Node still cannot load better-sqlite3 after rebuild.\n${second.output || '(no diagnostic output)'}`
    );
  }

  // eslint-disable-next-line no-console
  console.log('[node:preflight] Native dependency mismatch recovered for host Node.');
};

main();
