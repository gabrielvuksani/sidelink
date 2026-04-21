import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

type UsePageRefreshOptions = {
  enabled?: boolean;
  minIntervalMs?: number;
  initialForce?: boolean;
  revalidateOnFocus?: boolean;
  revalidateOnVisibility?: boolean;
  revalidateOnRouteChange?: boolean;
};

export function usePageRefresh(reload: (force?: boolean) => Promise<unknown> | unknown, options?: UsePageRefreshOptions) {
  const location = useLocation();
  const enabled = options?.enabled ?? true;
  const minIntervalMs = options?.minIntervalMs ?? 10_000;
  const initialForce = options?.initialForce ?? false;
  const revalidateOnFocus = options?.revalidateOnFocus ?? true;
  const revalidateOnVisibility = options?.revalidateOnVisibility ?? true;
  const revalidateOnRouteChange = options?.revalidateOnRouteChange ?? true;
  const lastRunAtRef = useRef(0);
  const runningRef = useRef(false);
  const reloadRef = useRef(reload);

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  const triggerRefresh = useCallback(async (force = false) => {
    if (!enabled || runningRef.current) return;

    const now = Date.now();
    if (!force && now - lastRunAtRef.current < minIntervalMs) {
      return;
    }

    runningRef.current = true;
    try {
      await reloadRef.current(force);
      lastRunAtRef.current = Date.now();
    } finally {
      runningRef.current = false;
    }
  }, [enabled, minIntervalMs]);

  useEffect(() => {
    if (!enabled || !revalidateOnRouteChange) return;
    void triggerRefresh(initialForce);
  }, [enabled, initialForce, location.pathname, revalidateOnRouteChange, triggerRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const onVisible = () => {
      if (revalidateOnVisibility && document.visibilityState === 'visible') {
        void triggerRefresh();
      }
    };

    const onFocus = () => {
      if (revalidateOnFocus) {
        void triggerRefresh();
      }
    };

    if (revalidateOnVisibility) {
      document.addEventListener('visibilitychange', onVisible);
    }
    if (revalidateOnFocus) {
      window.addEventListener('focus', onFocus);
    }
    return () => {
      if (revalidateOnVisibility) {
        document.removeEventListener('visibilitychange', onVisible);
      }
      if (revalidateOnFocus) {
        window.removeEventListener('focus', onFocus);
      }
    };
  }, [enabled, revalidateOnFocus, revalidateOnVisibility, triggerRefresh]);
}