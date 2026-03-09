import type { InstalledApp } from '../../shared/types';

type InstalledAppsListener = (apps: InstalledApp[]) => void;

const listeners = new Set<InstalledAppsListener>();

export function onInstalledAppsChanged(listener: InstalledAppsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyInstalledAppsChanged(apps: InstalledApp[]): void {
  for (const listener of listeners) {
    try {
      listener(apps);
    } catch (error) {
      console.warn('[installed-app-events] Listener error:', error);
    }
  }
}