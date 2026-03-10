type SnapshotEntry<T> = {
  data: T;
  updatedAt: number;
};

const DEFAULT_UI_SNAPSHOT_TTL_MS = 5 * 60_000;
const snapshotCache = new Map<string, SnapshotEntry<unknown>>();

export function getUiSnapshot<T>(key: string, ttlMs = DEFAULT_UI_SNAPSHOT_TTL_MS): SnapshotEntry<T> | null {
  const entry = snapshotCache.get(key) as SnapshotEntry<T> | undefined;
  if (!entry) return null;
  if ((Date.now() - entry.updatedAt) > ttlMs) {
    snapshotCache.delete(key);
    return null;
  }
  return entry;
}

export function setUiSnapshot<T>(key: string, data: T): void {
  snapshotCache.set(key, { data, updatedAt: Date.now() });
}

export function clearUiSnapshot(keyPrefix?: string): void {
  if (!keyPrefix) {
    snapshotCache.clear();
    return;
  }

  for (const key of snapshotCache.keys()) {
    if (key.startsWith(keyPrefix)) {
      snapshotCache.delete(key);
    }
  }
}