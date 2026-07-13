// src/components/ErrorBoundary.tsx
//
// Catches render-time exceptions anywhere below it so the entire app doesn't
// white-screen. Wrap once at the root in main.tsx. The fallback intentionally
// avoids depending on routing/auth so it works even if those subsystems threw.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry hookup yet — at least leave a breadcrumb for the dev tools.
    console.error('[ErrorBoundary] Render crashed:', error, info.componentStack);
  }

  private handleReload = () => {
    // Hard reload bypasses any corrupt in-memory state.
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const showDetails = import.meta.env.DEV;

    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-lg shadow-sm p-6">
          <div className="text-lg font-semibold text-slate-900">Something went wrong</div>
          <p className="mt-2 text-sm text-slate-600">
            The page hit an unexpected error and stopped rendering. Reloading usually fixes it.
            If it keeps happening, please report it with the details below.
          </p>

          {showDetails && (
            <pre
              className="mt-4 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-3
                         max-h-56 overflow-auto whitespace-pre-wrap"
            >
              {this.state.error.name}: {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
            </pre>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium
                         bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800"
            >
              Reload
            </button>
            <a
              href="/"
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              Go to home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
