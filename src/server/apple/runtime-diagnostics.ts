import { spawn } from 'node:child_process';
import path from 'node:path';
import { runCommand } from '../utils/command';
import { getPythonBinaryPath, getScriptsPath, hasBundledPython, isPackaged } from '../utils/paths';

export interface AppleRuntimeDiagnostics {
  isPackaged: boolean;
  hasBundledPython: boolean;
  pythonBinaryPath: string;
  scriptsPath: string;
  ready: boolean;
  checks: {
    helperBinary: boolean;
    selfCheck: boolean;
    anisette: boolean;
    gsaDispatch: boolean;
  };
  error?: string;
}

function parseLastJsonLine(output: string): Record<string, unknown> {
  const jsonLine = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));

  if (!jsonLine) {
    throw new Error(`Helper returned invalid JSON: ${output.trim().slice(0, 300)}`);
  }

  try {
    return JSON.parse(jsonLine) as Record<string, unknown>;
  } catch {
    throw new Error(`Helper returned invalid JSON: ${output.trim().slice(0, 300)}`);
  }
}

function parseCommandOutput(output: string, label: string): Record<string, unknown> {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error(`${label} returned no output`);
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return parseLastJsonLine(output);
  }
}

async function runBundledVersionCheck(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let lastResult = await runCommand(command, {
    args: ['--command', 'version'],
    timeoutMs: 30_000,
  });

  if (!lastResult.timedOut) {
    return lastResult;
  }

  lastResult = await runCommand(command, {
    args: ['--command', 'version'],
    timeoutMs: 30_000,
  });

  return lastResult;
}

async function runWithInput(command: string, args: string[], input: string, timeoutMs: number): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let output = '';
    let settled = false;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, output });
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(-1);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on('error', (err) => {
      output += err.message;
      finish(-1);
    });

    child.on('close', (code) => {
      finish(code ?? -1);
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

export async function diagnoseAppleRuntime(): Promise<AppleRuntimeDiagnostics> {
  const pythonBinaryPath = getPythonBinaryPath();
  const scriptsPath = getScriptsPath();
  const bundled = hasBundledPython();

  const diagnostics: AppleRuntimeDiagnostics = {
    isPackaged: isPackaged(),
    hasBundledPython: bundled,
    pythonBinaryPath,
    scriptsPath,
    ready: false,
    checks: {
      helperBinary: Boolean(pythonBinaryPath),
      selfCheck: false,
      anisette: false,
      gsaDispatch: false,
    },
  };

  try {
    if (bundled) {
      const selfCheck = await runBundledVersionCheck(pythonBinaryPath);
      const selfCheckParsed = parseCommandOutput(`${selfCheck.stdout}\n${selfCheck.stderr}`, 'Bundled Python version check');
      if (
        selfCheck.exitCode !== 0
        || selfCheckParsed.bundled !== true
        || typeof selfCheckParsed.python !== 'string'
      ) {
        throw new Error(`Bundled Python boot check failed: ${(selfCheck.stderr || selfCheck.stdout).trim().slice(0, 300)}`);
      }
    }
    diagnostics.checks.selfCheck = true;

    const anisette = bundled
      ? await runCommand(pythonBinaryPath, { args: ['--command', 'anisette'], timeoutMs: 60_000 })
      : await runCommand(pythonBinaryPath, { args: [path.join(scriptsPath, 'anisette-helper.py')], timeoutMs: 60_000 });
    const anisetteParsed = parseLastJsonLine(`${anisette.stdout}\n${anisette.stderr}`);
    if (
      anisette.exitCode !== 0
      || anisetteParsed.error
      || typeof anisetteParsed['X-Apple-I-MD'] !== 'string'
      || typeof anisetteParsed['X-Apple-I-MD-M'] !== 'string'
    ) {
      throw new Error(`Anisette generation failed: ${(anisette.stderr || anisette.stdout).trim().slice(0, 300)}`);
    }
    diagnostics.checks.anisette = true;

    const gsa = bundled
      ? await runWithInput(pythonBinaryPath, ['--command', 'gsa-auth'], JSON.stringify({ command: '__invalid_command__' }), 30_000)
      : await runWithInput(pythonBinaryPath, [path.join(scriptsPath, 'gsa-auth-helper.py')], JSON.stringify({ command: '__invalid_command__' }), 30_000);
    const gsaParsed = parseLastJsonLine(gsa.output);
    if (Number(gsaParsed.error_code ?? 0) !== -101) {
      throw new Error(`GSA helper dispatch failed: ${gsa.output.trim().slice(0, 300)}`);
    }
    diagnostics.checks.gsaDispatch = true;

    diagnostics.ready = true;
    return diagnostics;
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : String(error);
    diagnostics.ready = false;
    return diagnostics;
  }
}