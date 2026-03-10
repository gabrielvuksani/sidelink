import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[320px] items-center justify-center px-4 py-16 animate-fadeIn">
          <div className="sl-card max-w-md overflow-hidden p-0 text-center">
            <div className="border-b border-red-500/10 bg-red-500/[0.03] px-6 py-6">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10">
                <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <p className="text-[15px] font-semibold text-red-300">Something went wrong</p>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--sl-muted)]">
                {this.state.error?.message || 'An unexpected error occurred in this view.'}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 px-6 py-4">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="sl-btn-ghost !text-[12px]"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="sl-btn-primary !text-[12px]"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
