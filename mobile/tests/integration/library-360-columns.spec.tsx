import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockWidth = 360;

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    FlatList: ({ data = [], renderItem, ListHeaderComponent, ...props }: any) =>
      React.createElement(
        'FlatList',
        props,
        ListHeaderComponent,
        ...(data as any[]).map((item, index) => renderItem({ item, index })),
      ),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    useWindowDimensions: () => ({ width: mockWidth, height: 844 }),
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: any) => {
    React.useEffect(() => callback(), [callback]);
  },
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [{ slug: 'csharp', title: 'C# Interview', availability: 'live' }]),
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    Cards: [
      { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' },
      { StableUid: '2', OrderInDeck: 2, Difficulty: 2, Question: 'Q2' },
      { StableUid: '3', OrderInDeck: 3, Difficulty: 3, Question: 'Q3' },
    ],
  })),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => [
    { stableUid: '1', stage: 0, nextReviewAt: 0 },
    { stableUid: '2', stage: 2, lastReviewedAt: Date.now() - 1000, nextReviewAt: Date.now() + 86400000 },
    { stableUid: '3', stage: 4, lastReviewedAt: Date.now() - 2000, nextReviewAt: Date.now() + 86400000 },
  ]),
}));

import { LibraryScreen } from '../../src/screens/LibraryScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('LibraryScreen responsive columns', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('uses 2 columns at 360pt', async () => {
    mockWidth = 360;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    const grid = tree.root.find((node) => node.props?.testID === 'library-card-grid');
    expect(grid.props.numColumns).toBe(2);
  });

  // The one-line clamp this test was written for is gone. LibraryCardTile now
  // gives owned questions two lines, and a missing card shows a "?" mystery
  // placeholder instead of its question at all (both decisions are documented
  // in LibraryCardTile.tsx). What still has to hold at 360pt is that every body
  // text is line-bounded, so tile height cannot run away.
  it('keeps card body text line-bounded at 360pt', async () => {
    mockWidth = 360;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    // Q1 belongs to the "new" card, which renders the placeholder instead.
    const missingCards = tree.root.findAll(
      (node) => (node.type as any) === 'Text' && node.props.children === 'Q1',
    );
    expect(missingCards).toHaveLength(0);

    const placeholder = tree.root.find(
      (node) => (node.type as any) === 'Text' && node.props.children === '?',
    );
    expect(placeholder.props.numberOfLines).toBe(1);

    const question = tree.root.find(
      (node) => (node.type as any) === 'Text' && node.props.children === 'Q2',
    );
    expect(question.props.numberOfLines).toBe(2);
  });

  it('renders per-card Missing/Learning/Mastered status badges', async () => {
    mockWidth = 360;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    const statusOne = tree.root.findByProps({ testID: 'library-card-status-1' });
    const statusTwo = tree.root.findByProps({ testID: 'library-card-status-2' });
    const statusThree = tree.root.findByProps({ testID: 'library-card-status-3' });

    const readBadgeText = (node: any) =>
      node.find((child: any) => (child.type as any) === 'Text').props.children;

    expect(readBadgeText(statusOne)).toBe('Missing');
    expect(readBadgeText(statusTwo)).toBe('Learning');
    expect(readBadgeText(statusThree)).toBe('Mastered');
  });

  it('uses 3 columns at 390pt', async () => {
    mockWidth = 390;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    const grid = tree.root.find((node) => node.props?.testID === 'library-card-grid');
    expect(grid.props.numColumns).toBe(3);
  });

  it('uses 2 columns at 375pt', async () => {
    mockWidth = 375;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    const grid = tree.root.find((node) => node.props?.testID === 'library-card-grid');
    expect(grid.props.numColumns).toBe(2);
  });

  it('uses 3 columns at 430pt', async () => {
    mockWidth = 430;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'library', name: 'Library' } as any} />,
      );
    });
    await flush();

    const grid = tree.root.find((node) => node.props?.testID === 'library-card-grid');
    expect(grid.props.numColumns).toBe(3);
  });
});
