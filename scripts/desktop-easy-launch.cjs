#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const setupOnly = process.argv.includes('--setup-only');

const dbPath = process.env.SIDELINK_DB_PATH || path.join(rootDir, 'tmp', 'desktop', 'sidelink.sqlite');
const username = process.env.SIDELINK_ADMIN_USERNAME || 'admin';
const password = process.env.SIDELINK_ADMIN_PASSWORD || 'Admin1234!';
const usingDefaultPassword = !process.env.SIDELINK_ADMIN_PASSWORD;

const maskSecret = (value) => {
  if (!value) {
    return '••••';
  }

  if (value.length <= 4) {
    return '••••';
  }

  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
};

const run = (args, env) => {
  const result = spawnSync(npmCmd, args, {
    cwd: rootDir,
    env,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
};

const clearAuthLockouts = (targetDbPath, targetUsername) => {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(targetDbPath);
    db.prepare('DELETE FROM auth_attempts WHERE username = ?').run(targetUsername);
    db.prepare('DELETE FROM sessions').run();
    db.close();
    // eslint-disable-next-line no-console
    console.log('[desktop:easy] Cleared stale auth lockouts/sessions.');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[desktop:easy] Could not clear auth lockouts automatically: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const env = {
  ...process.env,
  SIDELINK_DB_PATH: dbPath,
  SIDELINK_ADMIN_USERNAME: username,
  SIDELINK_ADMIN_PASSWORD: password,
  SIDELINK_ADMIN_RESET_ON_BOOT: '1'
};

// eslint-disable-next-line no-console
console.log(`[desktop:easy] Using DB: ${dbPath}`);

run(['run', 'db:migrate'], env);
run(['run', 'db:bootstrap', '--', '--require-env'], env);
clearAuthLockouts(dbPath, username);

// eslint-disable-next-line no-console
console.log(`[desktop:easy] Admin username: ${username}`);
// eslint-disable-next-line no-console
console.log(
  usingDefaultPassword
    ? `[desktop:easy] Admin password: ${password}`
    : `[desktop:easy] Admin password: ${maskSecret(password)} (from SIDELINK_ADMIN_PASSWORD)`
);

if (setupOnly) {
  // eslint-disable-next-line no-console
  console.log('[desktop:easy] Setup complete (setup-only mode).');
  process.exit(0);
}

run(['run', 'desktop:dev'], env);
