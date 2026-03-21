import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { useSSE } from '../hooks/useSSE';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { PageHeader, SearchInput, relativeTime } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { LogEntry } from '../../../shared/types';
import { UI_LIMITS } from '../../../shared/constants';

const LEVELS = ['info', 'warn', 'error', 'debug'] as const;
const MAX_VISIBLE_LOGS = UI_LIMITS.maxVisibleLogs;

/* ── level-based styling ────────────────────────────────── */
const levelStyle: Record<string, { text: string; bg: string; badge: string }> = {
  error: {
    text: 'text-red-400',
    bg: 'bg-red-500/5',
    badge: 'bg-red-500/15 text-red-400',
  },
  warn: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/5',
    badge: 'bg-amber-500/15 text-amber-400',
  },
  info: {
    text: 'text-[var(--sl-text)] opacity-80',
    bg: '',
    badge: 'bg-sky-500/15 text-sky-400',
  },
  debug: {
    text: 'text-[var(--sl-muted)] opacity-70',
    bg: '',
    badge: 'bg-white/5 text-[var(--sl-muted)]',
  },
};

const defaultLevelStyle = { text: 'text-[var(--sl-muted)]', bg: '', badge: 'bg-white/5 text-[var(--sl-muted)]' };

/* ── tiny inline icons ──────────────────────────────────── */
function CopyIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>
  );
}

function DownloadIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

export default function LogsPage() {
  const warmSnapshot = getUiSnapshot<LogEntry[]>('page:logs', 30_000);
  const [logs, setLogs] = useState<LogEntry[]>(warmSnapshot?.data ?? []);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [filter, setFilter] = useState<string>('');
  const [textSearch, setTextSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const confirmDialog = useConfirm();

  const filtersActive = !!(filter || textSearch);

  /* ── derived data ──────────────────────────────────────── */
  const filteredLogs = useMemo(() => {
    const q = textSearch.toLowerCase().trim();
    if (!q) return logs;
    return logs.filter((log) =>
      log.message.toLowerCase().includes(q)
      || log.code.toLowerCase().includes(q)
      || log.level.toLowerCase().includes(q),
    );
  }, [logs, textSearch]);

  useEffect(() => { document.title = 'Logs — SideLink'; }, []);

  const reload = useCallback(() => {
    api.listLogs(filter || undefined)
      .then((response) => {
        const nextLogs = (response.data ?? []).slice(-MAX_VISIBLE_LOGS);
        setLogs(nextLogs);
        if (!filter) {
          setUiSnapshot('page:logs', nextLogs);
        }
      })
      .finally(() => setLoading(false));
  }, [filter]);

  usePageRefresh(reload, {
    initialForce: !warmSnapshot,
    minIntervalMs: 30_000,
    revalidateOnFocus: false,
    revalidateOnVisibility: false,
    revalidateOnRouteChange: false,
  });

  useEffect(() => {
    void reload();
  }, [reload]);

  useSSE({
    'log': (data) => {
      const entry = data as LogEntry;
      if (!filter || entry.level === filter) {
        setLogs((prev) => {
          const nextLogs = [...prev.slice(-(MAX_VISIBLE_LOGS - 1)), entry];
          if (!filter) {
            setUiSnapshot('page:logs', nextLogs);
          }
          return nextLogs;
        });
      }
    },
  });

  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  /* ── actions ───────────────────────────────────────────── */
  const clearLogs = async () => {
    const ok = await confirmDialog({
      title: 'Clear Logs',
      message: 'Are you sure you want to clear all logs? This cannot be undone.',
      confirmLabel: 'Clear All',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.clearLogs();
      setLogs([]);
      toast('success', 'Logs cleared');
    } catch {
      toast('error', 'Failed to clear logs');
    }
  };

  const copyLogEntry = (log: LogEntry) => {
    const line = `[${new Date(log.at).toLocaleString()}] [${log.level}]${log.code ? ` [${log.code}]` : ''} ${log.message}`;
    navigator.clipboard.writeText(line)
      .then(() => {
        setCopiedId(log.id);
        setTimeout(() => setCopiedId(null), 1500);
      })
      .catch(() => toast('error', 'Failed to copy'));
  };

  const exportLogs = () => {
    const lines = filteredLogs.map(
      (l) => `[${new Date(l.at).toLocaleString()}] [${l.level.toUpperCase()}]${l.code ? ` [${l.code}]` : ''} ${l.message}`,
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sidelink-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('success', `Exported ${filteredLogs.length} log entries`);
  };

  const copyAllLogs = () => {
    const text = filteredLogs.map(
      (l) => `[${new Date(l.at).toLocaleTimeString()}] [${l.level}]${l.code ? ` [${l.code}]` : ''} ${l.message}`,
    ).join('\n');
    navigator.clipboard.writeText(text)
      .then(() => toast('success', `${filteredLogs.length} log entries copied`))
      .catch(() => toast('error', 'Failed to copy logs'));
  };

  const clearFilters = () => {
    setFilter('');
    setTextSearch('');
  };

  return (
    <div className="sl-page h-full animate-fadeIn">
      <PageHeader
        eyebrow="Diagnostics"
        title="Real-time logs without the throwaway tooling feel"
        description="Logs stay live, filterable, and auto-scrolling, but the page now fits the same production shell as installs and settings instead of feeling like a debug leftover."
        stats={[
          { label: 'Visible Logs', value: filteredLogs.length, tone: 'sky' },
          { label: 'Filter', value: filter || 'all', tone: filter ? 'amber' : 'slate' },
          { label: 'Auto Scroll', value: autoScroll ? 'On' : 'Off', tone: autoScroll ? 'teal' : 'slate' },
        ]}
      />

      {/* ── toolbar ───────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* level tab bar */}
          <div className="sl-tab-bar">
            <button
              onClick={() => setFilter('')}
              data-active={filter === ''}
            >
              All
            </button>
            {LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setFilter(filter === l ? '' : l)}
                data-active={filter === l}
              >
                {l}
              </button>
            ))}
          </div>

          {/* search */}
          <SearchInput
            value={textSearch}
            onChange={setTextSearch}
            placeholder="Search logs..."
            className="!w-52"
            debounceMs={150}
          />

          {/* clear filters */}
          {filtersActive && (
            <button
              onClick={clearFilters}
              className="sl-btn-ghost !text-[12px] !px-2 !py-1.5 text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear filters
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* auto-scroll toggle button */}
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`sl-btn-ghost !text-[12px] !px-2.5 !py-1.5 flex items-center gap-1.5 rounded-lg transition-all ${
              autoScroll
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'text-[var(--sl-muted)]'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
            </svg>
            Auto-scroll
          </button>

          {/* export */}
          <button
            onClick={exportLogs}
            className="sl-btn-ghost !text-[12px] !px-2.5 !py-1.5 flex items-center gap-1.5"
          >
            <DownloadIcon />
            Export
          </button>

          {/* copy all */}
          <button
            onClick={copyAllLogs}
            className="sl-btn-ghost !text-[12px] !px-2.5 !py-1.5 flex items-center gap-1.5"
          >
            <CopyIcon />
            Copy
          </button>

          {/* clear logs */}
          <button onClick={clearLogs} className="sl-btn-danger !text-[12px] !px-2.5 !py-1.5">
            Clear
          </button>
        </div>
      </div>

      {/* ── log output ────────────────────────────────────── */}
      {loading ? (
        <div className="sl-card flex-1 flex items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--sl-accent)] border-t-transparent" />
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="sl-card flex-1 flex items-center justify-center py-16">
          <p className="text-[var(--sl-muted)] text-[13px]">
            {textSearch ? `No logs matching "${textSearch}"` : 'No logs yet'}
          </p>
        </div>
      ) : (
        <div className="sl-console flex-1 overflow-x-auto overflow-y-auto p-3 text-[12px]">
          {filteredLogs.map((log) => {
            const style = levelStyle[log.level] ?? defaultLevelStyle;
            return (
              <div
                key={log.id}
                className={`group py-0.5 flex items-start gap-2 hover:bg-white/[0.03] rounded px-1.5 min-w-[420px] ${style.bg}`}
              >
                {/* timestamp */}
                <span
                  className="font-mono text-[var(--sl-muted)] opacity-50 shrink-0 tabular-nums"
                  title={new Date(log.at).toLocaleString()}
                >
                  {new Date(log.at).toLocaleTimeString()}
                </span>

                {/* level badge */}
                <span
                  className={`shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${style.badge}`}
                >
                  {log.level}
                </span>

                {/* code tag */}
                {log.code && (
                  <span className="text-[var(--sl-muted)] shrink-0 font-mono">[{log.code}]</span>
                )}

                {/* message */}
                <span className={`break-all flex-1 ${style.text}`}>
                  {log.message}
                </span>

                {/* copy single log button */}
                <button
                  onClick={() => copyLogEntry(log)}
                  className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10"
                  title="Copy log entry"
                >
                  {copiedId === log.id ? (
                    <svg className="h-3 w-3 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    <CopyIcon className="h-3 w-3" />
                  )}
                </button>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
