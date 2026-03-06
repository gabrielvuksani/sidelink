// ─── useElectron Hook ────────────────────────────────────────────────
// Provides reactive access to Electron-specific features:
// auto-updater state, app info, and platform detection.

import { useState, useEffect, useCallback } from 'react';
import { getElectronAPI, isElectron } from '../lib/electron';

interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  error?: string;
}

interface ElectronInfo {
  isElectron: boolean;
  platform: string;
  version: string;
  isPackaged: boolean;
}

/**
 * React hook for Electron integration.
 * Returns updater state + app info. All values are safe to use
 * even when running in a regular browser (graceful fallbacks).
 */
export function useElectron() {
  const [updater, setUpdater] = useState<UpdaterState>({ status: 'idle' });
  const [info, setInfo] = useState<ElectronInfo>({
    isElectron,
    platform: 'browser',
    version: '0.0.0',
    isPackaged: false,
  });

  // Fetch app info once on mount
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    Promise.all([api.getPlatform(), api.getVersion(), api.isPackaged()])
      .then(([platform, version, isPackaged]) => {
        setInfo({ isElectron: true, platform, version, isPackaged });
      })
      .catch(() => { /* non-critical */ });
  }, []);

  // Subscribe to updater events
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    const unsubscribe = api.onUpdaterEvent((event) => {
      setUpdater({
        status: event.type === 'not-available' ? 'not-available'
          : event.type === 'available' ? 'available'
          : event.type,
        version: event.info?.version,
        percent: event.info?.percent,
        error: event.error,
      });
    });

    return unsubscribe;
  }, []);

  const checkForUpdates = useCallback(() => {
    const api = getElectronAPI();
    if (api) void api.checkForUpdates();
  }, []);

  const downloadUpdate = useCallback(() => {
    const api = getElectronAPI();
    if (api) void api.downloadUpdate();
  }, []);

  const installUpdate = useCallback(() => {
    const api = getElectronAPI();
    if (api) api.installUpdate();
  }, []);

  return {
    info,
    updater,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}
