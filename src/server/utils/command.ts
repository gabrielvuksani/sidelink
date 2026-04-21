// ─── Command Runner ─────────────────────────────────────────────────
// Unified shell command execution with timeout, audit logging, and
// structured result capture. Used by all adapters.

import { spawn } from 'node:child_process';
import { which } from './which';
import type { CommandResult, CommandOptions } from '../types';

const DEFAULT_TIMEOUT = 120_000; // 2 minutes

/**
 * Execute a shell command and capture its full output.
 * Returns a structured result with exit code, stdout, stderr, timing.
 */
export async function runCommand(
  command: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  const { args = [], cwd, timeoutMs = DEFAULT_TIMEOUT, env } = options;
  const startedAt = Date.now();

  return new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: cwd ?? undefined,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      });
    });
  });
}

/**
 * Run a command and throw if it exits non-zero.
 */
export async function runCommandStrict(
  command: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  const result = await runCommand(command, options);
  if (result.timedOut) {
    throw new Error(`Command timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT}ms: ${command}`);
  }
  if (result.exitCode !== 0) {
    const msg = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    throw new Error(`Command failed (${result.exitCode}): ${command} — ${msg}`);
  }
  return result;
}

/**
 * Run a command and parse stdout as JSON.
 */
export async function runCommandJson<T = unknown>(
  command: string,
  options: CommandOptions = {},
): Promise<T> {
  const result = await runCommandStrict(command, options);
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`Failed to parse JSON from ${command}: ${result.stdout.slice(0, 500)}`);
  }
}

/**
 * Check if a command exists on the system.
 */
export async function commandExists(command: string): Promise<boolean> {
  return which(command);
}
