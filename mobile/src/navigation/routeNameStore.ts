// A tiny external store holding the current navigation route name. The App root
// used to keep this in React state, which re-rendered the whole navigator tree
// on every navigation just to move the tab highlight (MSHELL-21). Only the
// TabBarHost subscribes to this store now, so navigation no longer re-renders
// the App root.
export type RouteNameStore = {
  get(): string | undefined;
  set(name: string | undefined): void;
  subscribe(listener: () => void): () => void;
};

export function createRouteNameStore(): RouteNameStore {
  let current: string | undefined;
  const listeners = new Set<() => void>();

  return {
    get() {
      return current;
    },
    set(name) {
      // Notify only when the name actually changes so subscribers (and their
      // useSyncExternalStore snapshots) don't churn on no-op state updates.
      if (name === current) return;
      current = name;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
