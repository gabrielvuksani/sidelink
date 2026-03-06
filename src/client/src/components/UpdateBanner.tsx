// ─── Update Banner ───────────────────────────────────────────────────
// Shows desktop auto-update notifications in the main layout.
// Only renders when running inside Electron and an update is available.

import { useElectron } from '../hooks/useElectron';
import { isElectron } from '../lib/electron';

type BannerVariant = 'info' | 'progress' | 'ready' | 'error';

const variants: Record<BannerVariant, { bg: string; text: string; border: string }> = {
  info:     { bg: 'bg-indigo-950/40',  text: 'text-indigo-300',  border: 'border-indigo-900/50' },
  progress: { bg: 'bg-indigo-950/40',  text: 'text-indigo-300',  border: 'border-indigo-900/50' },
  ready:    { bg: 'bg-emerald-950/40', text: 'text-emerald-300', border: 'border-emerald-900/50' },
  error:    { bg: 'bg-red-950/40',     text: 'text-red-300',     border: 'border-red-900/50' },
};

export function UpdateBanner() {
  const { updater, checkForUpdates, downloadUpdate, installUpdate } = useElectron();

  // Don't render outside Electron or when idle/checking
  if (!isElectron) return null;
  if (updater.status === 'idle' || updater.status === 'checking') return null;

  let variant: BannerVariant = 'info';
  let message = '';
  let action: { label: string; onClick: () => void } | null = null;

  switch (updater.status) {
    case 'available':
      variant = 'info';
      message = `Update v${updater.version ?? '?'} is available.`;
      action = { label: 'Download', onClick: downloadUpdate };
      break;
    case 'downloading':
      variant = 'progress';
      message = `Downloading update... ${Math.round(updater.percent ?? 0)}%`;
      break;
    case 'downloaded':
      variant = 'ready';
      message = `Update v${updater.version ?? '?'} is ready to install.`;
      action = { label: 'Restart & Update', onClick: installUpdate };
      break;
    case 'error':
      variant = 'error';
      message = `Update failed: ${updater.error ?? 'Unknown error'}`;
      action = { label: 'Retry', onClick: checkForUpdates };
      break;
    case 'not-available':
      // Briefly show "up to date" then fade — handled by not rendering
      return null;
    default:
      return null;
  }

  const v = variants[variant];

  return (
    <div className={`${v.bg} ${v.border} border rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 animate-fadeInDown`}>
      <div className="flex items-center gap-3 min-w-0">
        {variant === 'progress' && (
          <div className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin shrink-0" />
        )}
        {variant === 'ready' && (
          <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        )}
        <p className={`text-sm ${v.text} truncate`}>{message}</p>

        {/* Download progress bar */}
        {variant === 'progress' && (
          <div className="w-24 h-1.5 bg-indigo-950 rounded-full overflow-hidden shrink-0">
            <div
              className="h-full bg-[var(--sl-accent)] rounded-full transition-all duration-300"
              style={{ width: `${updater.percent ?? 0}%` }}
            />
          </div>
        )}
      </div>

      {action && (
        <button
          onClick={action.onClick}
          className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors shrink-0 ${
            variant === 'ready'
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : variant === 'error'
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-[var(--sl-accent)] hover:bg-[var(--sl-accent-hover)] text-white'
          }`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
