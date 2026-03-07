#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

function resolvePython() {
  const venvPython = isWin
    ? path.join(rootDir, '.venv', 'Scripts', 'python.exe')
    : path.join(rootDir, '.venv', 'bin', 'python3');

  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  return isWin ? 'python' : 'python3';
}

function mapArch(value) {
  if (value === 'x64') return 'x64';
  if (value === 'arm64') return 'arm64';
  if (value === 'ia32') return 'ia32';
  return value;
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: isWin,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function main() {
  const python = resolvePython();
  const platform = process.platform;
  const arch = mapArch(process.arch);

  console.log(`[python:bundle] Using ${python}`);
  console.log(`[python:bundle] Building for ${platform}-${arch}`);

  run(python, ['-m', 'pip', 'install', 'pyinstaller', '-r', 'python-bundle/requirements.txt']);
  run(python, ['python-bundle/build.py'], {
    SIDELINK_PLATFORM: platform,
    SIDELINK_ARCH: arch,
  });
}

main();