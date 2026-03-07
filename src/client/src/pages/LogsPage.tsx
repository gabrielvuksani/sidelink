import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { useSSE } from '../hooks/useSSE';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { PageHeader } from '../components/Shared';
import type { LogEntry } from '../../../shared/types';
import { UI_LIMITS } from '../../../shared/constants';

const LEVELS = ['info', 'warn', 'error', 'debug'] as const;
const MAX_VISIBLE_LOGS = UI_LIMITS.maxVisibleLogs;

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const confirmDialog = useConfirm();

  useEffect(() => { document.title = 'Logs — Sidelink'; }, []);

  const reload = useCallback(() => {
    api.listLogs(filter || undefined).then(r => setLogs((r.data ?? []).slice(-MAX_VISIBLE_LOGS))).finally(() => setLoading(false));
  }, [filter]);

  usePageRefresh(reload);

  useSSE({
    'log': (data) => {
      const entry = data as LogEntry;
      if (!filter || entry.level === filter) {
        setLogs(prev => [...prev.slice(-(MAX_VISIBLE_LOGS - 1)), entry]);
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
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--sl-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="rounded bg-[var(--sl-surface-soft)] border-[var(--sl-border)] text-[var(--sl-accent)] focus:ring-[var(--sl-accent)]"
            />
            Auto-scroll
          </label>
          <button onClick={clearLogs} className="sl-btn-danger !text-[12px] !px-2.5 !py-1.5">Clear</button>
        </div>
      </div>

      {loading ? (
        <div className="sl-card flex-1 flex items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--sl-accent)] border-t-transparent" />
        </div>
      ) : logs.length === 0 ? (
        <div className="sl-card flex-1 flex items-center justify-center py-16">
          <p className="text-[var(--sl-muted)] text-[13px]">No logs yet</p>
        </div>
      ) : (
        <div className="sl-console flex-1 overflow-y-auto p-3 font-mono text-[12px]">
          {logs.map((log) => (
            <div key={log.id} className="py-0.5 flex gap-2 hover:bg-white/[0.02] rounded px-1">
              <span className="text-[var(--sl-muted)] opacity-50 shrink-0">
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
