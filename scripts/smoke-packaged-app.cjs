#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const TIMEOUT_MS = 90_000;

function resolveResourcesDir(executablePath) {
  if (process.platform === 'darwin') {
    return path.join(path.dirname(executablePath), '..', 'Resources');
  }

  return path.join(path.dirname(executablePath), 'resources');
}

function resolveBundledPythonPath(executablePath) {
  const resourcesDir = resolveResourcesDir(executablePath);
  const binaryName = process.platform === 'win32' ? 'sidelink-python.exe' : 'sidelink-python';
  return path.join(resourcesDir, 'python', binaryName);
}

async function validateBundledPython(executablePath) {
  const helperPath = resolveBundledPythonPath(executablePath);
  if (!fs.existsSync(helperPath)) {
    throw new Error(`Missing bundled Python helper: ${helperPath}`);
  }

  const runHelper = ({ args, input = null, timeoutMs = 30_000, expectExitCode = 0, label }) =>
    new Promise((resolve, reject) => {
      const child = spawn(helperPath, args, {
        cwd: rootDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${label} timed out\n${output.trim()}`.trim()));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if ((code ?? -1) !== expectExitCode) {
          reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}\n${output.trim()}`.trim()));
          return;
        }

        resolve(output);
      });

      if (input !== null) {
        child.stdin.write(input);
      }
      child.stdin.end();
    });

  const parseLastJsonLine = (output, label) => {
    const jsonLine = output
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse()
      .find((line) => line.startsWith('{') && line.endsWith('}'));

    if (!jsonLine) {
      throw new Error(`${label} returned invalid JSON\n${output.trim()}`.trim());
    }

    try {
      return JSON.parse(jsonLine);
    } catch {
      throw new Error(`${label} returned invalid JSON\n${output.trim()}`.trim());
    }
  };

  const checkOutput = await runHelper({
    args: ['--command', 'check'],
    label: 'Bundled Python helper self-check',
  });

  const checkParsed = parseLastJsonLine(checkOutput, 'Bundled Python helper self-check');
  if (!checkParsed.ok) {
    throw new Error(`Bundled Python helper reported missing modules\n${checkOutput.trim()}`.trim());
  }

  const anisetteOutput = await runHelper({
    args: ['--command', 'anisette'],
    timeoutMs: 60_000,
    label: 'Bundled Python anisette check',
  });

  const anisetteParsed = parseLastJsonLine(anisetteOutput, 'Bundled Python anisette check');
  if (anisetteParsed.error || !anisetteParsed['X-Apple-I-MD'] || !anisetteParsed['X-Apple-I-MD-M']) {
    throw new Error(`Bundled Python anisette check failed\n${anisetteOutput.trim()}`.trim());
  }

  await runHelper({
    args: ['--command', 'pmd3', 'usbmux', 'list', '--usb'],
    timeoutMs: 30_000,
    label: 'Bundled Python pmd3 usbmux check',
  });

  const gsaOutput = await runHelper({
    args: ['--command', 'gsa-auth'],
    input: JSON.stringify({ command: '__invalid_command__' }),
    label: 'Bundled Python gsa-auth check',
  });

  const gsaParsed = parseLastJsonLine(gsaOutput, 'Bundled Python gsa-auth check');
  if (gsaParsed.error_code !== -101) {
    throw new Error(`Bundled Python gsa-auth dispatch is broken\n${gsaOutput.trim()}`.trim());
  }
}

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
  const preferredLinux = linuxCandidates.find((value) => path.basename(value) === 'SideLink' || path.basename(value) === 'sidelink');
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
        SIDELINK_DISABLE_KEYCHAIN: '1',
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
      await validateBundledPython(executablePath);
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