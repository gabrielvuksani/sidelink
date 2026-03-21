import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { DesktopHealthSnapshot } from '../../../shared/types';

type UseDesktopHealthOptions = {
  autoRefreshMs?: number;
  snapshotKey?: string;
  warmTtlMs?: number;
};

export function useDesktopHealth(options: UseDesktopHealthOptions = {}) {
  const snapshotKey = options.snapshotKey ?? 'desktop-health';
  const warmSnapshot = getUiSnapshot<DesktopHealthSnapshot>(snapshotKey, options.warmTtlMs ?? 15_000);
  const hasWarmSnapshot = !!warmSnapshot;
  const [data, setData] = useState<DesktopHealthSnapshot | null>(warmSnapshot?.data ?? null);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [error, setError] = useState<string | null>(null);

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
    } catch (nextError: unknown) {
      setError(getErrorMessage(nextError, 'Failed to load desktop health'));
    } finally {
      if (!opts?.silent) {
        setLoading(false);
      }
    }
  }, [snapshotKey]);

  useEffect(() => {
    void refresh({ silent: hasWarmSnapshot, bypassCache: hasWarmSnapshot });
  }, [hasWarmSnapshot, refresh]);

  useEffect(() => {
    if (!options.autoRefreshMs || options.autoRefreshMs <= 0) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh({ silent: true, bypassCache: true });
      }
    }, options.autoRefreshMs);

    return () => window.clearInterval(interval);
  }, [options.autoRefreshMs, refresh]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}
