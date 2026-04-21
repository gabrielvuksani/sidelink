#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const targets = [
  'tmp/desktop/sidelink.sqlite',
  'tmp/desktop/sidelink.sqlite-shm',
  'tmp/desktop/sidelink.sqlite-wal',
  'tmp/desktop/uploads',
];

function isConfirmed() {
  return process.argv.includes('--force') || process.env.CI === 'true';
}

function confirmReset() {
  if (isConfirmed() || !process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('This will delete the local SideLink database and uploads. Continue? [y/N] ', (answer) => {
      rl.close();
      resolve(/^(y|yes)$/i.test(answer.trim()));
    });
  });
}

async function main() {
  const confirmed = await confirmReset();
  if (!confirmed) {
    console.log('[reset] aborted');
    process.exit(1);
  }

  for (const target of targets) {
    const full = path.resolve(process.cwd(), target);
    if (!fs.existsSync(full)) continue;
    fs.rmSync(full, { recursive: true, force: true });
    console.log(`[reset] removed ${target}`);
  }

  fs.mkdirSync(path.resolve(process.cwd(), 'tmp/desktop/uploads'), { recursive: true });
  console.log('[reset] recreated tmp/desktop/uploads');
}

main().catch((error) => {
  console.error('[reset] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
