import { randomUUID } from 'node:crypto';
import { LogEntry, LogLevel } from '../types';
import { AppStore } from '../state/store';

interface LogInput {
  level: LogLevel;
  code: string;
  message: string;
  action?: string;
  context?: Record<string, unknown>;
}

export interface LogQueryInput {
  limit?: number;
  levels?: LogLevel[];
  code?: string;
  search?: string;
  before?: string;
  after?: string;
}

export interface LogQueryResult {
  items: LogEntry[];
  totalStored: number;
  matched: number;
  hasMore: boolean;
}

const normalizeNeedle = (value: string | undefined): string | undefined => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
};

const toEpochMs = (iso: string | undefined): number | undefined => {
  if (!iso) {
    return undefined;
  }

  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
};

export class LogService {
  private readonly maxEntries: number;

  constructor(
    private readonly store: AppStore,
    maxEntries = 1200
  ) {
    this.maxEntries = maxEntries;
  }

  public push(input: LogInput): LogEntry {
    const entry: LogEntry = {
      id: `log_${randomUUID()}`,
      at: new Date().toISOString(),
      level: input.level,
      code: input.code,
      message: input.message,
      action: input.action,
      context: input.context
    };

    this.store.appendLog(entry, this.maxEntries);
    return entry;
  }

  public list(limit = 200): LogEntry[] {
    const safeLimit = Math.max(1, Math.min(limit, this.maxEntries));
    return this.store.listLogs(safeLimit);
  }

  public query(input: LogQueryInput = {}): LogQueryResult {
    const requestedLimit = Number(input.limit ?? 200);
    const normalizedLimit = Number.isFinite(requestedLimit) ? requestedLimit : 200;
    const safeLimit = Math.max(0, Math.min(Math.floor(normalizedLimit), this.maxEntries));
    const allLogs = this.store.listLogs(this.maxEntries);

    const levelSet = input.levels?.length ? new Set(input.levels) : undefined;
    const codeNeedle = normalizeNeedle(input.code);
    const searchNeedle = normalizeNeedle(input.search);
    const beforeMs = toEpochMs(input.before);
    const afterMs = toEpochMs(input.after);

    const filtered = allLogs.filter((entry) => {
      if (levelSet && !levelSet.has(entry.level)) {
        return false;
      }

      if (codeNeedle && !entry.code.toLowerCase().includes(codeNeedle)) {
        return false;
      }

      const entryMs = toEpochMs(entry.at);

      if (beforeMs !== undefined && entryMs !== undefined && entryMs > beforeMs) {
        return false;
      }

      if (afterMs !== undefined && entryMs !== undefined && entryMs < afterMs) {
        return false;
      }

      if (searchNeedle) {
        const contextText = entry.context ? JSON.stringify(entry.context) : '';
        const haystack = [entry.code, entry.message, entry.action ?? '', contextText].join(' ').toLowerCase();
        if (!haystack.includes(searchNeedle)) {
          return false;
        }
      }

      return true;
    });

    const items = safeLimit > 0 ? filtered.slice(0, safeLimit) : [];

    return {
      items,
      totalStored: allLogs.length,
      matched: filtered.length,
      hasMore: filtered.length > items.length
    };
  }

  public clear(): void {
    this.store.clearLogs();
  }
}
