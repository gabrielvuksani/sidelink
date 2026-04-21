import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { DesktopHealthSnapshot } from '../../../shared/types';

type UseDesktopHealthOptions = {
  autoRefreshMs?: number;
  snapshotKey?: string;
  warmTtlMs?: number;
};

/* ------------------------------------------------------------------ */
/*  Module-level shared polling infrastructure                        */
/*                                                                    */
/*  Multiple components calling useDesktopHealth with the same        */
/*  snapshotKey + autoRefreshMs will share a single setInterval       */
/*  instead of each spinning up their own.  A ref-count tracks        */
/*  active consumers; the interval is torn down only when the last    */
/*  consumer unmounts.                                                */
/* ------------------------------------------------------------------ */

type PollerState = {
  data: DesktopHealthSnapshot | null;
  error: string | null;
  loading: boolean;
};

type PollerListener = (state: PollerState) => void;

type ActivePoller = {
  refCount: number;
  intervalId: number;
  listeners: Set<PollerListener>;
  state: PollerState;
};

const activePollers = new Map<string, ActivePoller>();

/** Build a dedup key from snapshotKey + interval so callers with
 *  different intervals don't accidentally share a timer. */
function pollerKey(snapshotKey: string, autoRefreshMs: number): string {
  return `${snapshotKey}::${autoRefreshMs}`;
}

async function pollerFetch(snapshotKey: string, poller: ActivePoller): Promise<void> {
  try {
    const response = await api.desktopHealth({ bypassCache: true });
    const nextData = response.data ?? null;
    setUiSnapshot(snapshotKey, nextData);
    poller.state = { data: nextData, error: null, loading: false };
  } catch (fetchError: unknown) {
    poller.state = {
      ...poller.state,
      error: getErrorMessage(fetchError, 'Failed to load desktop health'),
      loading: false,
    };
  }
  for (const listener of poller.listeners) {
    listener(poller.state);
  }
}

function registerPoller(
  snapshotKey: string,
  autoRefreshMs: number,
  listener: PollerListener,
): () => void {
  const key = pollerKey(snapshotKey, autoRefreshMs);
  let poller = activePollers.get(key);

  if (poller) {
    poller.refCount++;
    poller.listeners.add(listener);
    // Immediately notify the new consumer with the current shared state
    listener(poller.state);
  } else {
    const newPoller: ActivePoller = {
      refCount: 1,
      intervalId: 0,
      listeners: new Set([listener]),
      state: { data: null, error: null, loading: true },
    };

    newPoller.intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void pollerFetch(snapshotKey, newPoller);
      }
    }, autoRefreshMs);

    activePollers.set(key, newPoller);
    poller = newPoller;
  }

  // Return an unsubscribe function
  return () => {
    const existing = activePollers.get(key);
    if (!existing) return;
    existing.listeners.delete(listener);
    existing.refCount--;
    if (existing.refCount <= 0) {
      window.clearInterval(existing.intervalId);
      activePollers.delete(key);
    }
  };
}

/* ------------------------------------------------------------------ */
/*  The hook                                                          */
/* ------------------------------------------------------------------ */

export function useDesktopHealth(options: UseDesktopHealthOptions = {}) {
  const snapshotKey = options.snapshotKey ?? 'desktop-health';
  const warmSnapshot = getUiSnapshot<DesktopHealthSnapshot>(snapshotKey, options.warmTtlMs ?? 15_000);
  const hasWarmSnapshot = !!warmSnapshot;
  const [data, setData] = useState<DesktopHealthSnapshot | null>(warmSnapshot?.data ?? null);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [error, setError] = useState<string | null>(null);

  // Keep a stable ref to the autoRefreshMs so we can detect changes
  const autoRefreshMsRef = useRef(options.autoRefreshMs);
  autoRefreshMsRef.current = options.autoRefreshMs;

  const refresh = useCallback(async (opts?: { silent?: boolean; bypassCache?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
    }

    try {
      const response = await api.desktopHealth({ bypassCache: opts?.bypassCache ?? false });
      const nextData = response.data ?? null;
      setData(nextData);
      setUiSnapshot(snapshotKey, nextData);
      setError(null);

      // Broadcast only to pollers for the snapshotKey we just fetched, so a
      // DashboardPage poll doesn't overwrite state on an unrelated DevicesPage
      // poller. The `pollerKey` format is `${snapshotKey}::${autoRefreshMs}`
      // — we compare the prefix up to and including `::`.
      const scopedPrefix = `${snapshotKey}::`;
      for (const [key, poller] of activePollers) {
        if (!key.startsWith(scopedPrefix)) continue;
        poller.state = { data: nextData, error: null, loading: false };
        for (const listener of poller.listeners) {
          listener(poller.state);
        }
      }
    } catch (nextError: unknown) {
      setError(getErrorMessage(nextError, 'Failed to load desktop health'));
    } finally {
      if (!opts?.silent) {
        setLoading(false);
      }
    }
  }, [snapshotKey]);

  // Initial fetch
  useEffect(() => {
    void refresh({ silent: hasWarmSnapshot, bypassCache: hasWarmSnapshot });
  }, [hasWarmSnapshot, refresh]);

  // Shared polling — register with the module-level deduplicator
  useEffect(() => {
    const ms = options.autoRefreshMs;
    if (!ms || ms <= 0) return;

    const listener: PollerListener = (state) => {
      setData(state.data);
      setError(state.error);
      // Don't overwrite loading from an explicit refresh() call;
      // shared polling always fetches silently.
    };

    return registerPoller(snapshotKey, ms, listener);
  }, [options.autoRefreshMs, snapshotKey]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}
