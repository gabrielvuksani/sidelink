// ─── SSE Hook ────────────────────────────────────────────────────────
// Subscribe to server-sent events with auto-reconnect + connection state.

import { useEffect, useRef, useState, useCallback } from 'react';
import { UI_LIMITS } from '../../../shared/constants';

type SSEHandler = (data: unknown) => void;
export type SSEState = 'connected' | 'connecting' | 'disconnected';

const EVENT_TYPES = ['job-update', 'job-log', 'device-update', 'app-update', 'log', 'scheduler-update'] as const;
const MAX_BACKOFF = UI_LIMITS.sseMaxBackoffMs;

export function useSSE(handlers: Record<string, SSEHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [connectionState, setConnectionState] = useState<SSEState>('connecting');

  useEffect(() => {
    let es: EventSource | null = null;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout>;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      setConnectionState('connecting');
      es = new EventSource('/api/events');

      es.onopen = () => {
        if (unmounted) return;
        retryDelay = 1000; // reset backoff
        setConnectionState('connected');
      };

      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (e: MessageEvent) => {
          let data: unknown;
          try {
            data = JSON.parse(e.data);
          } catch (err) {
            console.warn(`[SSE] Failed to parse ${type} event:`, err);
            return;
          }
          try {
            handlersRef.current[type]?.(data);
          } catch (err) {
            console.error(`[SSE] Handler error for ${type}:`, err);
          }
        });
      }

      es.onerror = () => {
        if (unmounted) return;
        setConnectionState('disconnected');
        es?.close();
        es = null;
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, MAX_BACKOFF);
          connect();
        }, retryDelay);
      };
    }

    connect();

    return () => {
      unmounted = true;
      clearTimeout(retryTimer);
      es?.close();
    };
  }, []);

  return connectionState;
}

/** Tiny connection indicator */
export function SSEIndicator({ state }: { state: SSEState }) {
  const label: Record<SSEState, string> = {
    connected: 'Live',
    connecting: 'Connecting...',
    disconnected: 'Offline',
  };
  const dot: Record<SSEState, string> = {
    connected: 'bg-green-400',
    connecting: 'bg-amber-400 animate-pulse',
    disconnected: 'bg-red-400',
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--sl-muted)]">
      <span className={`w-1.5 h-1.5 rounded-full ${dot[state]}`} />
      {label[state]}
    </span>
  );
}
