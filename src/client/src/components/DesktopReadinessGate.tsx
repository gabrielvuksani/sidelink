import type { ReactNode } from 'react';

/**
 * Previously this component blocked the entire UI until a desktop health
 * snapshot completed. This caused the app to get stuck on a loading modal
 * when backend diagnostics (Apple runtime, xcodebuild checks) were slow
 * or hanging. Now it simply renders children immediately — individual
 * pages and widgets load their own data asynchronously.
 */
export function DesktopReadinessGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
