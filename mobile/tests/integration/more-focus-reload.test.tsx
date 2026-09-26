import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Once tab hops reuse the mounted More screen (pop-navigation, MSHELL-01), a
 * mount-only stats load would leave the streak/collection numbers stale after
 * a review or a draw. MoreScreen now reloads on every focus via
 * navigation.addListener('focus', ...). This pins that behaviour: the same
 * mounted instance picks up fresh tracker values when Me regains focus.
 */

let streakSnapshotFixture = {
  currentDailyStreak: 0,
  longestDailyStreak: 0,
  weekCompletedDays: 0,
  totalQualifiedSessions: 0,
  lastQualifiedDateKey: null as string | null,
  currentWeekKey: null as string | null,
};
let drawStateFixture: Record<string, string[]> = {};

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
    Linking: { openURL: vi.fn(async () => undefined) },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children) };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => streakSnapshotFixture),
}));

vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  listDrawStateSlugs: vi.fn(async () => Object.keys(drawStateFixture)),
  loadDrawState: vi.fn(async (slug: string) => ({ owned: drawStateFixture[slug] ?? [], pity: null })),
}));

import { MoreScreen } from '../../src/screens/MoreScreen';

function exactTexts(tree: renderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('MoreScreen focus reload', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    streakSnapshotFixture = {
      currentDailyStreak: 2,
      longestDailyStreak: 5,
      weekCompletedDays: 1,
      totalQualifiedSessions: 4,
      lastQualifiedDateKey: '2026-08-19',
      currentWeekKey: '2026-W34',
    };
    drawStateFixture = { csharp: ['c-001', 'c-002'] };
  });

  it('reloads the streak and collection count every time Me regains focus', async () => {
    const focusCallbacks: Array<() => void> = [];
    const navigation = {
      navigate: vi.fn(),
      addListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'focus') focusCallbacks.push(cb);
        return () => undefined;
      }),
    };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <MoreScreen navigation={navigation as any} route={{ key: 'more', name: 'More' } as any} />,
      );
    });
    await flush();

    // Mount load reflects the initial fixtures.
    expect(exactTexts(tree)).toContain('2');
    expect(exactTexts(tree)).toContain('2'); // 2-card collection
    expect(navigation.addListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(focusCallbacks.length).toBeGreaterThan(0);

    // A review + a draw happened while More stayed mounted behind another tab.
    streakSnapshotFixture = { ...streakSnapshotFixture, currentDailyStreak: 8 };
    drawStateFixture = { csharp: ['c-001', 'c-002', 'c-003'], aws: ['a-001'] };

    await act(async () => {
      for (const cb of focusCallbacks) cb();
    });
    await flush();

    const texts = exactTexts(tree);
    expect(texts).toContain('8'); // refreshed streak
    expect(texts).toContain('4'); // refreshed collection count (3 + 1)
  });
});
