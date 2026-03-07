#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const TIMEOUT_MS = 90_000;

function walk(dirPath, matcher, results = []) {
  if (!fs.existsSync(dirPath)) return results;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (matcher(fullPath, entry)) {
      results.push(fullPath);
    }
    if (entry.isDirectory()) {
      walk(fullPath, matcher, results);
    }
  }

  return results;
}

function resolveExecutablePath() {
  const argPath = process.argv[2];
  if (argPath) {
    return path.resolve(rootDir, argPath);
  }

  if (process.platform === 'darwin') {
    const apps = walk(distDir, (fullPath, entry) => entry.isDirectory() && fullPath.endsWith('.app'));
    const preferredSegment = process.arch === 'x64' ? 'mac-x64' : 'mac-arm64';
    const sortedApps = apps.sort((left, right) => {
      const leftPreferred = left.includes(preferredSegment) ? 0 : 1;
      const rightPreferred = right.includes(preferredSegment) ? 0 : 1;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
      return left.localeCompare(right);
    });
    for (const appPath of sortedApps) {
      const candidate = path.join(appPath, 'Contents', 'MacOS', path.basename(appPath, '.app'));
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  if (process.platform === 'win32') {
    const exes = walk(distDir, (fullPath, entry) => entry.isFile() && fullPath.endsWith('.exe'));
    const preferred = exes.find((value) => value.toLowerCase().includes('win-unpacked'));
    return preferred || exes[0];
  }

  const linuxCandidates = walk(distDir, (fullPath, entry) => entry.isFile() && /\/linux-unpacked\//.test(fullPath.replace(/\\/g, '/')));
  const preferredLinux = linuxCandidates.find((value) => path.basename(value) === 'Sidelink' || path.basename(value) === 'sidelink');
  return preferredLinux || linuxCandidates[0];
}

async function main() {
  const executablePath = resolveExecutablePath();

  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error('Could not find a packaged desktop executable in dist/.');
  }

  console.log(`[desktop:smoke] Launching ${path.relative(rootDir, executablePath)}`);

  await new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      cwd: rootDir,
      env: {
        ...process.env,
        SIDELINK_SMOKE_TEST: '1',
        SIDELINK_SKIP_AUTO_UPDATER: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out after ${TIMEOUT_MS}ms\n${output.trim()}`.trim()));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Packaged app exited with code ${code ?? 'unknown'}\n${output.trim()}`.trim()));
    });
  });
}

main().catch((error) => {
  console.error('[desktop:smoke] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});