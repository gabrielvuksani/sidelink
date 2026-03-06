// ─── Shared UI Components ────────────────────────────────────────────

/** Loading spinner */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--sl-accent)] border-t-transparent" />
    </div>
  );
}

/** Full-page centered spinner with optional message */
export function PageLoader({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 animate-fadeIn">
      <Spinner />
      {message && <p className="text-[13px] text-[var(--sl-muted)]">{message}</p>}
    </div>
  );
}

/** Status badge for job/pipeline status */
export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: 'bg-white/[0.05] text-[var(--sl-muted)]',
    running: 'bg-indigo-500/10 text-indigo-400',
    completed: 'bg-emerald-500/10 text-emerald-400',
    failed: 'bg-red-500/10 text-red-400',
    waiting_2fa: 'bg-amber-500/10 text-amber-400',
    active: 'bg-emerald-500/10 text-emerald-400',
    requires_2fa: 'bg-amber-500/10 text-amber-400',
    session_expired: 'bg-red-500/10 text-red-400',
    locked: 'bg-red-500/10 text-red-400',
    unauthenticated: 'bg-white/[0.04] text-[var(--sl-muted)]',
  };
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-md ${colors[status] ?? 'bg-white/[0.05] text-[var(--sl-muted)]'}`}
    >
      {status === 'running' && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />}
      {status === 'waiting_2fa' && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />}
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/** Empty state placeholder */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="sl-card flex flex-col items-center py-16 px-8 text-center animate-fadeIn">
      {icon && <div className="mb-4 text-[var(--sl-muted)] opacity-40">{icon}</div>}
      <p className="text-[15px] font-semibold text-[var(--sl-text)]">{title}</p>
      {description && <p className="mt-1.5 text-[13px] text-[var(--sl-muted)] max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Section card wrapper */
export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`sl-card ${className}`}>
      {children}
    </div>
  );
}
