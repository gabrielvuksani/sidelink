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

const toastIcons: Record<ToastType, React.ReactNode> = {
  success: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  error: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  info: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>,
  warning: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>,
};

function ToastContainer({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  const colors: Record<ToastType, string> = {
    success: 'bg-green-500/[0.12] border-green-500/20 text-green-200',
    error: 'bg-red-500/[0.12] border-red-500/20 text-red-200',
    info: 'bg-indigo-500/[0.12] border-indigo-500/20 text-indigo-200',
    warning: 'bg-amber-500/[0.12] border-amber-500/20 text-amber-200',
  };

  return (
    <div className="fixed z-50 flex flex-col gap-2 max-w-sm right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] sm:left-auto" role="status" aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md animate-slideInBottom ${colors[t.type]}`}
          role="alert"
        >
          <span className="shrink-0 mt-0.5">{toastIcons[t.type]}</span>
          <p className="text-[13px] flex-1 leading-relaxed">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="text-current opacity-50 hover:opacity-100 shrink-0 p-0.5 rounded-md transition-opacity"
            aria-label="Dismiss notification"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}
