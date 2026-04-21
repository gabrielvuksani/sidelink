#!/usr/bin/env node
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function getPreferredPython() {
  const venvPython = process.platform === 'win32'
    ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
    : path.join(process.cwd(), '.venv', 'bin', 'python3');

  if (fs.existsSync(venvPython)) {
    return {
      name: 'Python (.venv)',
      cmd: `"${venvPython}" --version`,
    };
  }

  return {
    name: 'Python',
    cmd: process.platform === 'win32' ? 'python --version' : 'python3 --version',
  };
}

const checks = [
  { name: 'Node.js', cmd: 'node -v' },
  { name: 'npm', cmd: 'npm -v' },
  getPreferredPython(),
  { name: 'Git', cmd: 'git --version' },
];

let failures = 0;

for (const check of checks) {
  try {
    const output = execSync(check.cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    console.log(`[ok] ${check.name}: ${output}`);
  } catch (error) {
    failures += 1;
    console.error(`[fail] ${check.name}: ${error.message.split('\n')[0]}`);
  }
}

try {
  execSync('node scripts/node-native-preflight.cjs', { stdio: 'inherit' });
} catch {
  failures += 1;
}

if (failures > 0) {
  console.error(`\nDoctor found ${failures} issue(s).`);
  process.exit(1);
}

console.log('\nDoctor checks passed.');
