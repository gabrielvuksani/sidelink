import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInstallModal } from './InstallModal';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { api } from '../lib/api';
import { getElectronAPI } from '../lib/electron';
import { useToast } from './Toast';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: 'navigate' | 'action' | 'search';
  action: () => void;
  keywords?: string[];
  group?: 'navigation' | 'action';
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { openInstall } = useInstallModal();
  const { toast } = useToast();

  const commands = useMemo<CommandItem[]>(() => [
    // ── Navigation ──────────────────────────────────────────────────
    { id: 'nav-overview', label: 'Overview', description: 'Dashboard and live status', icon: 'navigate', action: () => navigate('/'), keywords: ['dashboard', 'home', 'status'], group: 'navigation' },
    { id: 'nav-install', label: 'Install Center', description: 'Run installs and monitor pipeline', icon: 'navigate', action: () => navigate('/install'), keywords: ['pipeline', 'signing'], group: 'navigation' },
    { id: 'nav-ipas', label: 'IPAs', description: 'Upload and manage IPA library', icon: 'navigate', action: () => navigate('/apps'), keywords: ['upload', 'library', 'apps'], group: 'navigation' },
    { id: 'nav-installed', label: 'Installed Apps', description: 'Track active installs and expiry', icon: 'navigate', action: () => navigate('/installed'), keywords: ['active', 'expiry', 'refresh'], group: 'navigation' },
    { id: 'nav-devices', label: 'Devices', description: 'Connected hardware and pairing', icon: 'navigate', action: () => navigate('/devices'), keywords: ['iphone', 'ipad', 'usb', 'wifi'], group: 'navigation' },
    { id: 'nav-apple', label: 'Apple ID', description: 'Signing accounts and certificates', icon: 'navigate', action: () => navigate('/apple'), keywords: ['account', 'certificate', 'signing', 'team'], group: 'navigation' },
    { id: 'nav-sources', label: 'Sources', description: 'Curated feeds and app catalog', icon: 'navigate', action: () => navigate('/sources'), keywords: ['feed', 'catalog', 'altstore'], group: 'navigation' },
    { id: 'nav-logs', label: 'Logs', description: 'Operational logs and debugging', icon: 'navigate', action: () => navigate('/logs'), keywords: ['debug', 'error', 'history'], group: 'navigation' },
    { id: 'nav-settings', label: 'Settings', description: 'Scheduler, updates, and runtime config', icon: 'navigate', action: () => navigate('/settings'), keywords: ['config', 'scheduler', 'update', 'password'], group: 'navigation' },
    // ── Actions ──────────────────────────────────────────────────────
    { id: 'act-install', label: 'New Install', description: 'Open the install pipeline modal', icon: 'action', action: () => openInstall(), keywords: ['install', 'sign', 'sideload'], group: 'action' },
    { id: 'act-upload', label: 'Upload IPA', description: 'Navigate to library and upload a file', icon: 'action', action: () => navigate('/apps'), keywords: ['upload', 'ipa', 'file', 'add'], group: 'action' },
    { id: 'act-import-url', label: 'Import IPA from URL', description: 'Download an IPA from a direct link', icon: 'action', action: () => navigate('/apps?import=url'), keywords: ['import', 'url', 'download', 'ipa', 'link', 'paste'], group: 'action' },
    { id: 'act-refresh-devices', label: 'Refresh Devices', description: 'Re-scan connected USB and Wi-Fi devices', icon: 'action', action: () => { api.refreshDevices().then(() => toast('success', 'Devices refreshed')).catch(() => toast('error', 'Failed to refresh devices')); }, keywords: ['refresh', 'devices', 'scan', 'usb'], group: 'action' },
    { id: 'act-check-updates', label: 'Check for Updates', description: 'Check for a newer SideLink version', icon: 'action', action: () => { getElectronAPI()?.checkForUpdates(); }, keywords: ['update', 'version', 'upgrade'], group: 'action' },
    { id: 'act-clear-logs', label: 'Clear Logs', description: 'Navigate to log viewer', icon: 'action', action: () => navigate('/logs'), keywords: ['clear', 'logs', 'debug'], group: 'action' },
    { id: 'act-scan-devices', label: 'Scan Devices', description: 'Open devices page to view connections', icon: 'action', action: () => navigate('/devices'), keywords: ['scan', 'devices', 'connect'], group: 'action' },
  ], [navigate, openInstall, toast]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter((cmd) => {
      const haystack = `${cmd.label} ${cmd.description ?? ''} ${(cmd.keywords ?? []).join(' ')}`.toLowerCase();
      return q.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const execute = useCallback((item: CommandItem) => {
    close();
    item.action();
  }, [close]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, open]);

  useEffect(() => {
    if (!open) return;
    const panel = document.querySelector('[data-command-palette]') as HTMLElement | null;
    if (!panel) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  useBodyScrollLock(open);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIndex];
      if (item) execute(item);
    }
  };

  if (!open) return null;

  const iconMap = {
    navigate: (
      <svg className="h-4 w-4 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
      </svg>
    ),
    action: (
      <svg className="h-4 w-4 text-[var(--sl-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
    search: (
      <svg className="h-4 w-4 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Command palette" className="fixed inset-0 z-[100] flex items-start justify-center pt-[min(20vh,160px)] animate-fadeIn" onClick={close}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        data-command-palette
        className="relative w-full max-w-lg rounded-2xl border border-[var(--sl-border)] bg-[linear-gradient(180deg,rgba(16,28,38,0.98),rgba(8,16,25,0.99))] shadow-2xl animate-fadeInDown"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--sl-border)] px-4 py-3">
          <svg className="h-5 w-5 shrink-0 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, pages, actions..."
            aria-activedescendant={filtered[selectedIndex]?.id ? `cmd-${filtered[selectedIndex].id}` : undefined}
            className="flex-1 bg-transparent text-[14px] text-[var(--sl-text)] placeholder:text-[var(--sl-muted)]/60 outline-none"
          />
          <kbd className="hidden rounded-md border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--sl-muted)] sm:inline-block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-[var(--sl-muted)]">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            filtered.map((item, index) => {
              const prevGroup = index > 0 ? filtered[index - 1].group : undefined;
              const showGroupLabel = item.group && item.group !== prevGroup;
              return (
                <div key={item.id}>
                  {showGroupLabel && (
                    <>
                      {index > 0 && <div className="my-1.5 border-t border-[var(--sl-border)]" />}
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sl-muted)]/60">
                        {item.group === 'navigation' ? 'Navigation' : 'Actions'}
                      </p>
                    </>
                  )}
                  <button
                    id={`cmd-${item.id}`}
                    role="option"
                    aria-selected={index === selectedIndex}
                    onClick={() => execute(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      index === selectedIndex
                        ? 'bg-[var(--sl-accent)]/10 text-[var(--sl-text)]'
                        : 'text-[var(--sl-muted)] hover:bg-[var(--sl-surface-soft)]'
                    }`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--sl-surface-soft)]">
                      {iconMap[item.icon]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13px] font-medium ${index === selectedIndex ? 'text-[var(--sl-text)]' : ''}`}>{item.label}</p>
                      {item.description && (
                        <p className="truncate text-[11px] text-[var(--sl-muted)]">{item.description}</p>
                      )}
                    </div>
                    {index === selectedIndex && (
                      <kbd className="rounded-md border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--sl-muted)]">
                        ↵
                      </kbd>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-[var(--sl-border)] px-4 py-2.5 text-[10px] text-[var(--sl-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-1 py-0.5">↑↓</kbd> Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-1 py-0.5">↵</kbd> Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] px-1 py-0.5">ESC</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
