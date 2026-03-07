#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const SERVICE_NAME = 'com.sidelink.secrets';
const ACCOUNT_NAME = 'master-key';

function isConfirmed() {
  return process.argv.includes('--force') || process.env.CI === 'true';
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function getCandidatePaths() {
  const cwd = process.cwd();
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');

  return unique([
    path.join(cwd, 'tmp', 'desktop'),
    path.join(home, 'Library', 'Application Support', 'Sidelink'),
    path.join(appData, 'Sidelink'),
    path.join(xdgConfigHome, 'sidelink'),
  ]);
}

function confirmReset(targets) {
  if (isConfirmed() || !process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(true);
  }

  console.log('This will remove local Sidelink test state, saved sessions, uploaded files, and the stored OS keychain master key.');
  console.log('Targets:');
  for (const target of targets) {
    console.log(`  - ${target}`);
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Continue with a fresh reset? [y/N] ', (answer) => {
      rl.close();
      resolve(/^(y|yes)$/i.test(answer.trim()));
    });
  });
}

async function deleteKeychainMasterKey() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const keytar = require('keytar');
    const deleted = await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    if (deleted) {
      console.log('[reset:fresh] removed OS keychain master key');
    } else {
      console.log('[reset:fresh] no OS keychain master key found');
    }
  } catch {
    console.log('[reset:fresh] keytar unavailable, skipped OS keychain cleanup');
  }
}

async function main() {
  const targets = getCandidatePaths();
  const confirmed = await confirmReset(targets);

  if (!confirmed) {
    console.log('[reset:fresh] aborted');
    process.exit(1);
  }

  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[reset:fresh] removed ${path.relative(process.cwd(), target) || target}`);
  }

  await deleteKeychainMasterKey();

  const devUploadsDir = path.join(process.cwd(), 'tmp', 'desktop', 'uploads');
  fs.mkdirSync(devUploadsDir, { recursive: true });
  console.log('[reset:fresh] recreated tmp/desktop/uploads');
}

main().catch((error) => {
  console.error('[reset:fresh] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});