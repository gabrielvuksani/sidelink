import { CommandRunStatus } from '../types';

export interface CommandAuditEntry {
  command: string;
  args: string[];
  cwd?: string;
  startedAt: string;
  endedAt: string;
  exitCode?: number;
  status: CommandRunStatus;
  stdout?: string;
  stderr?: string;
  note?: string;
}

export type CommandAuditWriter = (entry: CommandAuditEntry) => Promise<void> | void;
