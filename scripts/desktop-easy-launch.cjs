#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const setupOnly = process.argv.includes('--setup-only');

const dbPath = process.env.SIDELINK_DB_PATH || path.join(rootDir, 'tmp', 'desktop', 'sidelink.sqlite');

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

const looksLikeSqliteCorruption = (value) => /SQLITE_CORRUPT|database disk image is malformed|file is not a database|malformed/i.test(String(value || ''));

const quarantineCorruptDb = (targetDbPath, reason) => {
  if (!targetDbPath || targetDbPath === ':memory:' || !fs.existsSync(targetDbPath)) {
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(path.dirname(targetDbPath), 'corrupt-backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const baseName = path.basename(targetDbPath);
  const backupBase = path.join(backupDir, `${baseName}.${timestamp}`);

  const variants = [
    { suffix: '', from: targetDbPath, to: backupBase },
    { suffix: '-wal', from: `${targetDbPath}-wal`, to: `${backupBase}-wal` },
    { suffix: '-shm', from: `${targetDbPath}-shm`, to: `${backupBase}-shm` }
  ];

  for (const item of variants) {
    if (!fs.existsSync(item.from)) {
      continue;
    }

    fs.renameSync(item.from, item.to);
  }

  // eslint-disable-next-line no-console
  console.warn(`[desktop:easy] Quarantined corrupt SQLite DB (${reason}) -> ${backupBase}`);
};

const ensureHealthyDb = (targetDbPath) => {
  if (!targetDbPath || targetDbPath === ':memory:' || !fs.existsSync(targetDbPath)) {
    return;
  }

  const result = spawnSync('sqlite3', [targetDbPath, 'PRAGMA integrity_check;'], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn('[desktop:easy] sqlite3 CLI not found; skipping preflight integrity check.');
      return;
    }

    throw result.error;
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();

  if (looksLikeSqliteCorruption(output)) {
    quarantineCorruptDb(targetDbPath, output || `exit=${result.status ?? 'unknown'}`);
    return;
  }

  if ((result.status ?? 0) !== 0) {
    throw new Error(`sqlite3 integrity check failed: ${output || `exit ${result.status ?? 'unknown'}`}`);
  }

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const isHealthy = lines.length === 0 || (lines.length === 1 && lines[0].toLowerCase() === 'ok');

  if (!isHealthy) {
    quarantineCorruptDb(targetDbPath, `integrity_check=${lines.join(' | ')}`);
  }
};

const env = {
  ...process.env,
  SIDELINK_DB_PATH: dbPath
};

// eslint-disable-next-line no-console
console.log(`[desktop:easy] Using DB: ${dbPath}`);

ensureHealthyDb(dbPath);

run(['run', 'db:migrate'], env);
ensureHealthyDb(dbPath);

if (setupOnly) {
  // eslint-disable-next-line no-console
  console.log('[desktop:easy] Database ready (setup-only mode). Launch the app and create an admin account on first run.');
  process.exit(0);
}

run(['run', 'desktop:dev'], env);
