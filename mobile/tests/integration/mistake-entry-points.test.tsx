import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, style, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
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
  loadStreakSnapshot: vi.fn(async () => ({
    currentDailyStreak: 0,
    longestDailyStreak: 0,
    weekCompletedDays: 0,
    totalQualifiedSessions: 0,
    lastQualifiedDateKey: null,
    currentWeekKey: null,
  })),
}));

vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  listDrawStateSlugs: vi.fn(async () => []),
  loadDrawState: vi.fn(async () => ({ owned: [], pity: null })),
}));

import { LibraryHeader } from '../../src/features/gacha/library/LibraryHeader';
import { MoreScreen } from '../../src/screens/MoreScreen';
import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';

// RemoteFeatures (remoteConfig.ts) types only mcq and paywall; newer flags are read untyped.
const asRemoteConfig = (value: unknown) => value as RemoteConfig;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');

function renderHeader(extra: { mistakeCount?: number; onOpenMistakes?: () => void }) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <LibraryHeader
        title="AWS"
        ownedCount={3}
        totalCount={10}
        deckOptions={[]}
        selectedDeckSlug="aws"
        filters={[]}
        filter="all"
        filterOpen={false}
        onSelectDeck={() => {}}
        onToggleFilterOpen={() => {}}
        onSelectFilter={() => {}}
        topics={[]}
        topicFilter={null}
        onSelectTopic={() => {}}
        {...extra}
      />,
    );
  });
  return tree;
}

async function renderMore(navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <MoreScreen navigation={{ navigate } as any} route={{ key: 'more', name: 'More' } as any} />,
    );
  });
  await flush();
  return tree;
}

describe('Mistake Book entry points', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    applyRemoteFeatures(null);
  });

  afterEach(() => {
    applyRemoteFeatures(null);
  });

  it('shows the Mistakes pill in the Library header only when there are active mistakes', () => {
    const onOpenMistakes = vi.fn();

    const withMistakes = renderHeader({ mistakeCount: 3, onOpenMistakes });
    const pills = byTestID(withMistakes, 'library-mistakes-pill');
    expect(pills).toHaveLength(1);
    expect(pills[0].props.accessibilityRole).toBe('button');
    expect(pills[0].props.accessibilityLabel).toBe('Open Mistake Book, 3 to review');
    const texts = pills[0].findAll((node) => (node.type as any) === 'Text').map((node) => node.props.children);
    expect(texts).toEqual(['Mistakes · 3']);
    act(() => {
      pills[0].props.onPress();
    });
    expect(onOpenMistakes).toHaveBeenCalledTimes(1);

    expect(byTestID(renderHeader({ mistakeCount: 0, onOpenMistakes }), 'library-mistakes-pill')).toHaveLength(0);
    expect(byTestID(renderHeader({ mistakeCount: 2 }), 'library-mistakes-pill')).toHaveLength(0);
    expect(byTestID(renderHeader({}), 'library-mistakes-pill')).toHaveLength(0);
  });

  it('opens the Mistake Book from the More row', async () => {
    const navigate = vi.fn();
    const tree = await renderMore(navigate);

    const row = byTestID(tree, 'more-row-mistakes');
    expect(row).toHaveLength(1);
    const texts = row[0].findAll((node) => (node.type as any) === 'Text').map((node) => node.props.children);
    expect(texts).toEqual(['Mistake Book', 'Cards you missed, plus related review']);

    // Placed directly after the Profile row.
    const rowIds = tree.root
      .findAll((node) => typeof node.type === 'string' && /^more-row-/.test(node.props?.testID ?? ''))
      .map((node) => node.props.testID);
    expect(rowIds.slice(0, 3)).toEqual(['more-row-profile', 'more-row-mistakes', 'more-row-settings']);

    await act(async () => {
      row[0].props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('MistakeBook');
  });

  it('hides the More row when the mistakeBook flag is off', async () => {
    applyRemoteFeatures(asRemoteConfig({ features: { mistakeBook: { enabled: false } } }));
    const tree = await renderMore();

    expect(byTestID(tree, 'more-row-mistakes')).toHaveLength(0);
    expect(byTestID(tree, 'more-row-profile')).toHaveLength(1);
  });
});
