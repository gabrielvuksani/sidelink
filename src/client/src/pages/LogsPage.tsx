import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { useSSE } from '../hooks/useSSE';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { PageHeader, relativeTime } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { LogEntry } from '../../../shared/types';
import { UI_LIMITS } from '../../../shared/constants';

const LEVELS = ['info', 'warn', 'error', 'debug'] as const;
const MAX_VISIBLE_LOGS = UI_LIMITS.maxVisibleLogs;

export default function LogsPage() {
  const warmSnapshot = getUiSnapshot<LogEntry[]>('page:logs', 30_000);
  const [logs, setLogs] = useState<LogEntry[]>(warmSnapshot?.data ?? []);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [filter, setFilter] = useState<string>('');
  const [textSearch, setTextSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const confirmDialog = useConfirm();

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

  const levelColors: Record<string, string> = {
    info: 'text-blue-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
    debug: 'text-gray-500',
  };

  return (
    <div className="sl-page h-full animate-fadeIn">
      <PageHeader
        eyebrow="Diagnostics"
        title="Real-time logs without the throwaway tooling feel"
        description="Logs stay live, filterable, and auto-scrolling, but the page now fits the same production shell as installs and settings instead of feeling like a debug leftover."
        stats={[
          { label: 'Visible Logs', value: logs.length, tone: 'sky' },
          { label: 'Filter', value: filter || 'all', tone: filter ? 'amber' : 'slate' },
          { label: 'Auto Scroll', value: autoScroll ? 'On' : 'Off', tone: autoScroll ? 'teal' : 'slate' },
        ]}
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-0.5 sl-card !p-0.5 !rounded-xl">
            {LEVELS.map(l => (
              <button
                key={l}
                onClick={() => setFilter(filter === l ? '' : l)}
                className={`text-[12px] px-2.5 py-1.5 rounded-lg transition-all ${
                  filter === l
                    ? 'bg-[var(--sl-accent)] text-white font-semibold shadow-sm'
                    : 'text-[var(--sl-muted)] hover:text-[var(--sl-text)]'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={textSearch}
            onChange={(e) => setTextSearch(e.target.value)}
            placeholder="Search logs..."
            className="sl-input !w-48 !py-1.5 !text-[12px]"
          />
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--sl-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="rounded bg-[var(--sl-surface-soft)] border-[var(--sl-border)] text-[var(--sl-accent)] focus:ring-[var(--sl-accent)]"
            />
            Auto-scroll
          </label>
          <button
            onClick={() => {
              const text = filteredLogs.map(l => `[${new Date(l.at).toLocaleTimeString()}] [${l.level}]${l.code ? ` [${l.code}]` : ''} ${l.message}`).join('\n');
              navigator.clipboard.writeText(text).then(() => toast('success', `${filteredLogs.length} log entries copied`)).catch(() => toast('error', 'Failed to copy logs'));
            }}
            className="sl-btn-ghost !text-[12px] !px-2.5 !py-1.5 flex items-center gap-1.5"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
            Copy
          </button>
          <button onClick={clearLogs} className="sl-btn-danger !text-[12px] !px-2.5 !py-1.5">Clear</button>
        </div>
      </div>

      {loading ? (
        <div className="sl-card flex-1 flex items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--sl-accent)] border-t-transparent" />
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="sl-card flex-1 flex items-center justify-center py-16">
          <p className="text-[var(--sl-muted)] text-[13px]">{textSearch ? `No logs matching "${textSearch}"` : 'No logs yet'}</p>
        </div>
      ) : (
        <div className="sl-console flex-1 overflow-x-auto overflow-y-auto p-3 font-mono text-[12px]">
          {filteredLogs.map((log) => (
            <div key={log.id} className="py-0.5 flex gap-2 hover:bg-white/[0.02] rounded px-1 min-w-[420px]">
              <span className="text-[var(--sl-muted)] opacity-50 shrink-0" title={new Date(log.at).toLocaleString()}>
                {new Date(log.at).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 w-12 text-right ${levelColors[log.level] ?? 'text-[var(--sl-muted)]'}`}>
                {log.level}
              </span>
              {log.code && (
                <span className="text-[var(--sl-muted)] shrink-0">[{log.code}]</span>
              )}
              <span className="text-[var(--sl-text)] opacity-80 break-all">{log.message}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
