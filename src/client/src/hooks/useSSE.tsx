// ─── SSE Hook ────────────────────────────────────────────────────────
// Subscribe to server-sent events with auto-reconnect + connection state.

import { useEffect, useRef, useState, useCallback } from 'react';
import { UI_LIMITS } from '../../../shared/constants';

type SSEHandler = (data: unknown) => void;
export type SSEState = 'connected' | 'connecting' | 'disconnected';

const EVENT_TYPES = ['job-update', 'job-log', 'device-update', 'app-update', 'log', 'scheduler-update'] as const;
const MAX_BACKOFF = UI_LIMITS.sseMaxBackoffMs;

type Subscriber = {
  handlersRef: React.MutableRefObject<Record<string, SSEHandler>>;
  setConnectionState: (state: SSEState) => void;
};

let sharedEventSource: EventSource | null = null;
let sharedRetryDelay = 1000;
let sharedRetryTimer: ReturnType<typeof setTimeout> | null = null;
let sharedConnectionState: SSEState = 'disconnected';
let nextSubscriberId = 0;
const subscribers = new Map<number, Subscriber>();

function broadcastConnectionState(state: SSEState) {
  sharedConnectionState = state;
  for (const subscriber of subscribers.values()) {
    subscriber.setConnectionState(state);
  }
}

function dispatchEvent(type: string, data: unknown) {
  for (const subscriber of subscribers.values()) {
    try {
      subscriber.handlersRef.current[type]?.(data);
    } catch (err) {
      console.error(`[SSE] Handler error for ${type}:`, err);
    }
  }
}

function scheduleReconnect() {
  if (sharedRetryTimer || subscribers.size === 0) return;
  sharedRetryTimer = setTimeout(() => {
    sharedRetryTimer = null;
    sharedRetryDelay = Math.min(sharedRetryDelay * 2, MAX_BACKOFF);
    connectSharedStream();
  }, sharedRetryDelay);
}

function connectSharedStream() {
  if (sharedEventSource || subscribers.size === 0) return;

  broadcastConnectionState('connecting');
  sharedEventSource = new EventSource('/api/events');

  sharedEventSource.onopen = () => {
    sharedRetryDelay = 1000;
    broadcastConnectionState('connected');
  };

  for (const type of EVENT_TYPES) {
    sharedEventSource.addEventListener(type, (e: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(e.data);
      } catch (err) {
        console.warn(`[SSE] Failed to parse ${type} event:`, err);
        return;
      }
      dispatchEvent(type, data);
    });
  }

  sharedEventSource.onerror = () => {
    broadcastConnectionState('disconnected');
    sharedEventSource?.close();
    sharedEventSource = null;
    scheduleReconnect();
  };
}

function releaseSharedStreamIfIdle() {
  if (subscribers.size > 0) return;
  if (sharedRetryTimer) {
    clearTimeout(sharedRetryTimer);
    sharedRetryTimer = null;
  }
  sharedEventSource?.close();
  sharedEventSource = null;
  sharedRetryDelay = 1000;
  sharedConnectionState = 'disconnected';
}

export function useSSE(handlers: Record<string, SSEHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [connectionState, setConnectionState] = useState<SSEState>(sharedConnectionState === 'disconnected' ? 'connecting' : sharedConnectionState);

  useEffect(() => {
    const subscriberId = nextSubscriberId++;
    subscribers.set(subscriberId, { handlersRef, setConnectionState });
    setConnectionState(sharedConnectionState === 'disconnected' ? 'connecting' : sharedConnectionState);
    connectSharedStream();

    return () => {
      subscribers.delete(subscriberId);
      releaseSharedStreamIfIdle();
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
