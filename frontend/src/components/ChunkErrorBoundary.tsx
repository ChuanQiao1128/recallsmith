// src/components/ChunkErrorBoundary.tsx
//
// Catches the failure mode that route splitting introduces.
//
// Before the routes were split there was no way for navigation to fail: every
// page was already in the one chunk the browser had. Splitting buys a smaller
// first load and pays for it with a new error path — the chunk request can 404
// or time out, `React.lazy`'s thenable rejects, and with no boundary above it
// the error propagates to the root and React unmounts the entire tree. The user
// gets a white page with no message and no way back.
//
// This is not a hypothetical. It fires routinely on deploy: someone has the app
// open, a new build ships, the old hashed chunk filenames stop existing, and the
// next navigation asks for a file that is gone. The copy names that case
// explicitly, because "network error" would send a user to check their wifi
// when the real fix is to reload.
//
// ---------------------------------------------------------------------------
// WHY THE BUTTON RELOADS INSTEAD OF RE-RENDERING
// ---------------------------------------------------------------------------
// The obvious "Retry" — clear the error state and render the children again —
// does not work here, and fails silently. React caches a lazy component's
// rejection on the payload object (`_status = 2`, with the error kept in
// `_result`); the initializer only re-invokes the import factory while status is
// still -1. So a retry that merely re-renders re-throws the SAME cached error
// forever. It would look like a working button and be a dead one, which is the
// exact class of defect this refactor is trying to stop shipping.
//
// A full reload discards that cache along with the whole module registry, and on
// a version-drift deploy it also fetches the new index.html with the new chunk
// names — the only action that can actually succeed.

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Left on console on purpose: this boundary swallows the error for the user,
    // so without this the only record of a failed chunk load would be gone.
    console.error('Route chunk failed to load', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded shadow-sm max-w-md">
          <div className="font-semibold mb-1">页面资源加载失败</div>
          <div className="text-sm">
            可能是网络中断，或者网站刚发布了新版本、旧的页面文件已经不存在。重新加载即可。
          </div>
          <button
            type="button"
            className="mt-3 text-sm px-3 py-1.5 rounded-md border border-red-200 text-red-800 hover:bg-red-100"
            onClick={this.handleReload}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
