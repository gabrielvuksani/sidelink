import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface CommandRunOptions {
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const resolveOptions = (input?: number | CommandRunOptions): Required<CommandRunOptions> => {
  if (typeof input === 'number') {
    return {
      timeoutMs: input,
      cwd: process.cwd(),
      env: process.env
    };
  }

  return {
    timeoutMs: input?.timeoutMs ?? 8000,
    cwd: input?.cwd ?? process.cwd(),
    env: input?.env ?? process.env
  };
};

export const runCommand = (
  command: string,
  args: string[],
  options?: number | CommandRunOptions
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const normalized = resolveOptions(options);
    const started = Date.now();
    const startedAt = new Date(started).toISOString();

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: normalized.cwd,
      env: normalized.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${normalized.timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, normalized.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const endedAt = new Date().toISOString();
      resolve({
        code: code ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        command,
        args,
        startedAt,
        endedAt,
        durationMs: Date.now() - started
      });
    });
  });

export const commandExists = async (command: string): Promise<boolean> => {
  try {
    const result = await runCommand('which', [command], 3000);
    return result.code === 0 && Boolean(result.stdout);
  } catch {
    return false;
  }
};
