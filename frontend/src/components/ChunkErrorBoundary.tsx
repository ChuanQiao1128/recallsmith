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

// ---------------------------------------------------------------------------
// WHY THE COPY IS CHOSEN AT RENDER TIME AND NOT FIXED
// ---------------------------------------------------------------------------
// A boundary catches everything thrown beneath it, not only the failure it was
// built for. The first version of this file said "page resources failed to
// load, your network may have dropped" for any error at all, so an ordinary
// undefined dereference inside a page told the user to check their wifi. That
// is worse than saying nothing: it sends someone to fix a thing that is not
// broken, and it hides a real bug behind an infrastructure story.
//
// So the cause is tested rather than assumed, and the two cases get different
// copy and different escapes. Reloading is the right move for a chunk that is
// missing; it is the wrong move for a page that crashes deterministically,
// where it just replays the crash. That case is offered a way *out* of the
// route instead.

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /**
   * Changes when the user navigates. A boundary with no reset survives its own
   * cause: one flaky chunk request would pin the error screen for the rest of
   * the session, including routes whose chunks were already cached. Clearing on
   * navigation is safe because navigation is the one event that replaces the
   * subtree that threw.
   */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Whether this error is a chunk that would not load.
 *
 * Matched on the message because there is no shared error type: Chrome throws
 * "Failed to fetch dynamically imported module", Firefox and Safari word it
 * differently, and bundler-injected loaders use the name ChunkLoadError. Any
 * miss here degrades to the generic copy, which claims nothing false — the
 * failure direction is chosen so that a wrong guess is quiet rather than
 * misleading.
 */
function isChunkLoadError(error: Error): boolean {
  if (error.name === 'ChunkLoadError') return true;
  return /dynamically imported module|Importing a module script failed|Loading chunk \S+ failed/i.test(
    error.message,
  );
}

export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Left on console on purpose: this boundary swallows the error for the user,
    // so without this the only record of the failure would be gone. The label
    // follows the same split as the copy, so the console does not assert a
    // cause the screen does not.
    const label = isChunkLoadError(error) ? 'Route chunk failed to load' : 'Route crashed while rendering';
    console.error(label, error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleLeave = (): void => {
    // A full navigation rather than a router push: the crashing subtree is
    // still mounted, and this is the escape offered when re-rendering it is
    // exactly what must not happen again.
    window.location.assign('/');
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    const chunk = isChunkLoadError(error);

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded shadow-sm max-w-md">
          <div className="font-semibold mb-1">
            {chunk ? '页面资源加载失败' : '这个页面出错了'}
          </div>
          <div className="text-sm">
            {chunk
              ? '可能是网络中断，或者网站刚发布了新版本、旧的页面文件已经不存在。重新加载即可。'
              : '页面在渲染时抛出了异常，具体原因已记录在浏览器控制台。重新加载不一定能解决，可以先回到卡组列表。'}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded-md border border-red-200 text-red-800 hover:bg-red-100"
              onClick={this.handleReload}
            >
              重新加载
            </button>
            {!chunk && (
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-md border border-red-200 text-red-800 hover:bg-red-100"
                onClick={this.handleLeave}
              >
                回到卡组列表
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
