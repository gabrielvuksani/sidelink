// ─── Log Service ────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type { LogEntry, LogLevel } from '../../shared/types';
import type { Database } from '../state/database';

type LogListener = (entry: LogEntry) => void;

export class LogService {
  private listeners: LogListener[] = [];

  constructor(private db: Database) {}

  /** Subscribe to new log entries (for SSE streaming). Returns unsubscribe fn. */
  onLog(listener: LogListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  log(level: LogLevel, code: string, message: string, meta?: Record<string, unknown>): LogEntry {
    const entry: LogEntry = {
      id: uuid(),
      level,
      code,
      message,
      meta: meta ?? null,
      at: new Date().toISOString(),
    };
    this.db.appendLog(entry);

    // Notify SSE listeners
    for (const listener of this.listeners) {
      try { listener(entry); } catch (err) {
        console.warn('[log-service] Listener error:', err);
      }
    }

    // Also log to console in development
    const prefix = `[${level.toUpperCase()}] [${code}]`;
    if (level === 'error') console.error(prefix, message, meta || '');
    else if (level === 'warn') console.warn(prefix, message, meta || '');
    else if (level === 'debug') {
      if (process.env.SIDELINK_DEBUG) console.debug(prefix, message, meta || '');
    } else {
      console.log(prefix, message, meta || '');
    }

    return entry;
  }

  info(code: string, message: string, meta?: Record<string, unknown>): LogEntry {
    return this.log('info', code, message, meta);
  }

  warn(code: string, message: string, meta?: Record<string, unknown>): LogEntry {
    return this.log('warn', code, message, meta);
  }

  error(code: string, message: string, meta?: Record<string, unknown>): LogEntry {
    return this.log('error', code, message, meta);
  }

  debug(code: string, message: string, meta?: Record<string, unknown>): LogEntry {
    return this.log('debug', code, message, meta);
  }

  list(limit = 200): LogEntry[] {
    return this.db.listLogs(limit);
  }

  clear(): void {
    this.db.clearLogs();
  }
}
