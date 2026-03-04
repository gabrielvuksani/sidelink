import { commandExists, runCommand } from '../utils/command';

export interface CommandInvocation {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface CommandInvocationResult {
  command: string;
  args: string[];
  cwd?: string;
  code: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface CommandRunner {
  exists(command: string): Promise<boolean>;
  execute(invocation: CommandInvocation): Promise<CommandInvocationResult>;
}

export class ShellCommandRunner implements CommandRunner {
  public async exists(command: string): Promise<boolean> {
    return commandExists(command);
  }

  public async execute(invocation: CommandInvocation): Promise<CommandInvocationResult> {
    try {
      const result = await runCommand(invocation.command, invocation.args, {
        timeoutMs: invocation.timeoutMs,
        cwd: invocation.cwd,
        env: invocation.env
      });

      return {
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        durationMs: result.durationMs
      };
    } catch (error) {
      const startedAt = new Date().toISOString();
      const endedAt = new Date().toISOString();
      return {
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        code: -1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt,
        durationMs: 0
      };
    }
  }
}
