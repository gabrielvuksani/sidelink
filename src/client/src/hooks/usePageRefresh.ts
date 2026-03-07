import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export function usePageRefresh(reload: () => Promise<unknown> | unknown, options?: { enabled?: boolean; minIntervalMs?: number }) {
  const location = useLocation();
  const enabled = options?.enabled ?? true;
  const minIntervalMs = options?.minIntervalMs ?? 1_500;
  const lastRunAtRef = useRef(0);
  const runningRef = useRef(false);

  const triggerRefresh = useCallback(async (force = false) => {
    if (!enabled || runningRef.current) return;

    const now = Date.now();
    if (!force && now - lastRunAtRef.current < minIntervalMs) {
      return;
    }

    runningRef.current = true;
    try {
      await reload();
      lastRunAtRef.current = Date.now();
    } finally {
      runningRef.current = false;
    }
  }, [enabled, minIntervalMs, reload]);

  useEffect(() => {
    void triggerRefresh(true);
  }, [location.key, triggerRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void triggerRefresh();
      }
    };

    const onFocus = () => {
      void triggerRefresh();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, triggerRefresh]);
}