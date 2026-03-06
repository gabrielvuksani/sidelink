// ─── Toast System ────────────────────────────────────────────────────
// Global toast notifications to replace alert()/confirm().

import { useState, useCallback, createContext, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import { UI_LIMITS } from '../../../shared/constants';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastCtx {
  toasts: Toast[];
  toast: (type: ToastType, message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastCtx>({
  toasts: [],
  toast: () => {},
  dismiss: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++nextId.current;
    setToasts(prev => [...prev.slice(-4), { id, type, message }]); // max 5
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), UI_LIMITS.toastTimeoutMs);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext value={{ toasts, toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext>
  );
}

function ToastContainer({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  const colors: Record<ToastType, string> = {
    success: 'bg-green-500/[0.12] border-green-500/20 text-green-200',
    error: 'bg-red-500/[0.12] border-red-500/20 text-red-200',
    info: 'bg-indigo-500/[0.12] border-indigo-500/20 text-indigo-200',
    warning: 'bg-amber-500/[0.12] border-amber-500/20 text-amber-200',
  };

  const icons: Record<ToastType, string> = {
    success: '✓',
    error: '✗',
    info: 'ℹ',
    warning: '⚠',
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md animate-slideInBottom ${colors[t.type]}`}
          role="alert"
        >
          <span className="text-sm shrink-0 mt-0.5">{icons[t.type]}</span>
          <p className="text-sm flex-1">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="text-current opacity-50 hover:opacity-100 text-sm shrink-0"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
