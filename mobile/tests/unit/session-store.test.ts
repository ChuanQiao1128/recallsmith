import { beforeEach, describe, expect, it } from 'vitest';
import type { RoutePreviewNode } from '../../src/features/gacha/contracts';
import { resetSessionStore, useSessionStore } from '../../src/features/gacha/session/sessionStore';

const routeNodes: RoutePreviewNode[] = [
  { id: 'warmup-0', role: 'warmup', title: 'Warm-up node', subtitle: 'Start easy' },
  { id: 'boss-1', role: 'boss', title: 'Boss check', subtitle: 'Finish strong' },
];

describe('sessionStore', () => {
  beforeEach(() => {
    resetSessionStore();
  });

  it('starts a session with route metadata and counters reset', () => {
    useSessionStore.getState().startSession({
      sessionId: 'sess-1',
      slug: 'csharp',
      route: routeNodes,
      startedAt: 123,
    });

    const state = useSessionStore.getState();
    expect(state.sessionId).toBe('sess-1');
    expect(state.slug).toBe('csharp');
    expect(state.route).toEqual(routeNodes);
    expect(state.currentIndex).toBe(0);
    expect(state.completedCount).toBe(0);
    expect(state.streakEarned).toBe(false);
    expect(state.sessionRatings).toEqual([]);
    expect(state.startedAt).toBe(123);
  });

  it('records ratings, advances session progress, and earns streak on first non-again rating', () => {
    useSessionStore.getState().startSession({
      sessionId: 'sess-2',
      slug: 'csharp',
      route: routeNodes,
      startedAt: 456,
    });

    useSessionStore.getState().recordRating({ stableUid: 'card-1', rating: 'again' });
    useSessionStore.getState().advanceSession();
    useSessionStore.getState().recordRating({ stableUid: 'card-2', rating: 'good' });
    useSessionStore.getState().advanceSession();

    const state = useSessionStore.getState();
    expect(state.currentIndex).toBe(2);
    expect(state.completedCount).toBe(2);
    expect(state.streakEarned).toBe(true);
    expect(state.sessionRatings).toEqual([
      { stableUid: 'card-1', rating: 'again' },
      { stableUid: 'card-2', rating: 'good' },
    ]);
  });

  it('resets back to the empty session state', () => {
    useSessionStore.getState().startSession({
      sessionId: 'sess-3',
      slug: 'csharp',
      route: routeNodes,
      startedAt: 789,
    });

    resetSessionStore();
    const state = useSessionStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.slug).toBeNull();
    expect(state.route).toEqual([]);
    expect(state.currentIndex).toBe(0);
    expect(state.completedCount).toBe(0);
    expect(state.streakEarned).toBe(false);
    expect(state.sessionRatings).toEqual([]);
    expect(state.startedAt).toBeNull();
  });
});
