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
        <div className="flex min-h-[320px] items-center justify-center px-4 py-16 animate-fadeInUp">
          <div className="sl-card max-w-md overflow-hidden p-0 text-center">
            <div
              className="px-6 py-6"
              style={{
                borderBottom: '1px solid color-mix(in oklab, var(--sl-danger) 12%, transparent)',
                background: 'color-mix(in oklab, var(--sl-danger) 3%, transparent)',
              }}
            >
              <div
                className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{ background: 'color-mix(in oklab, var(--sl-danger) 12%, transparent)' }}
              >
                <svg className="h-6 w-6" style={{ color: 'var(--sl-danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <p className="text-[15px] font-semibold" style={{ color: 'var(--sl-danger)' }}>
                Something went wrong
              </p>
              <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--sl-muted)' }}>
                {this.state.error?.message || 'An unexpected error occurred in this view.'}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 px-6 py-4">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="sl-btn-ghost sl-btn-sm"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="sl-btn-primary sl-btn-sm"
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
