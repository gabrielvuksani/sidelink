import { useEffect, useState } from 'react';

/**
 * Shared 1-second tick counter. `TimeAgo` and similar components that each
 * used to spawn their own `setInterval(1000)` can subscribe here to trigger
 * re-renders from a single global timer. When the last subscriber unmounts
 * the timer stops.
 *
 * Granularity argument (`granularityMs`) lets a caller opt into a slower
 * tick — e.g. 5s for coarse labels — without spinning up another timer.
 * The coarser subscribers still tick off the shared 1s driver, they just
 * ignore updates that don't cross the granularity boundary.
 */
const listeners = new Set<() => void>();
let tickValue = 0;
let intervalId: number | null = null;

function fireTick(): void {
  tickValue += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // never let one subscriber's throw break the rest
    }
  }
}

function addListener(listener: () => void): () => void {
  listeners.add(listener);
  if (intervalId === null) {
    intervalId = window.setInterval(fireTick, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };
}

export function useSharedTick(granularityMs = 1_000): number {
  const [local, setLocal] = useState(tickValue);
  useEffect(() => {
    let lastFiredAt = Date.now();
    return addListener(() => {
      if (Date.now() - lastFiredAt < granularityMs - 50) return;
      lastFiredAt = Date.now();
      setLocal((v) => v + 1);
    });
  }, [granularityMs]);
  return local;
}
