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

function resolveExecutablePaths() {
  const argPath = process.argv[2];
  if (argPath) {
    return [path.resolve(rootDir, argPath)];
  }

  if (process.platform === 'darwin') {
    const apps = walk(distDir, (fullPath, entry) => entry.isDirectory() && fullPath.endsWith('.app'));
    const preferredSegment = process.arch === 'x64' ? 'mac-x64' : 'mac-arm64';
    const sortedApps = apps.sort((left, right) => {
      const normalize = (value) => value.replace(/\\/g, '/');
      const leftPath = normalize(left);
      const rightPath = normalize(right);
      const score = (value) => {
        if (value.includes(preferredSegment)) return 0;
        if (value.includes('/dist/mac/')) return 1;
        return 2;
      };
      const leftPreferred = score(leftPath);
      const rightPreferred = score(rightPath);
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
      return left.localeCompare(right);
    });
    return sortedApps
      .map((appPath) => path.join(appPath, 'Contents', 'MacOS', path.basename(appPath, '.app')))
      .filter((candidate) => fs.existsSync(candidate));
  }

  if (process.platform === 'win32') {
    const exes = walk(distDir, (fullPath, entry) => entry.isFile() && fullPath.endsWith('.exe'));
    const preferred = exes.find((value) => value.toLowerCase().includes('win-unpacked'));
    return [preferred || exes[0]].filter(Boolean);
  }

  const linuxCandidates = walk(distDir, (fullPath, entry) => entry.isFile() && /\/linux-unpacked\//.test(fullPath.replace(/\\/g, '/')));
  const preferredLinux = linuxCandidates.find((value) => path.basename(value) === 'Sidelink' || path.basename(value) === 'sidelink');
  return [preferredLinux || linuxCandidates[0]].filter(Boolean);
}

async function launchExecutable(executablePath) {
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

async function main() {
  const executablePaths = resolveExecutablePaths();

  if (executablePaths.length === 0) {
    throw new Error('Could not find a packaged desktop executable in dist/.');
  }

  let lastError = null;

  for (const executablePath of executablePaths) {
    try {
      await launchExecutable(executablePath);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (process.platform === 'darwin' && /Unknown system error -86|bad CPU type/i.test(message)) {
        console.warn(`[desktop:smoke] Skipping incompatible macOS build ${path.relative(rootDir, executablePath)} (${message})`);
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new Error('Could not launch any packaged desktop executable in dist/.');
}

main().catch((error) => {
  console.error('[desktop:smoke] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});