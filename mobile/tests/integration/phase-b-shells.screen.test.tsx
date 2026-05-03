import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    StyleSheet: { create: (styles: any) => styles },
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

vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
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
    Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
  })),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => [{ stableUid: '1', stage: 0, nextReviewAt: 0 }]),
}));

import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { PoolOverviewScreen } from '../../src/screens/PoolOverviewScreen';
import { PlanOverviewScreen } from '../../src/screens/PlanOverviewScreen';
import { MilestoneHallScreen } from '../../src/screens/MilestoneHallScreen';
import { BacklogWarningScreen } from '../../src/screens/BacklogWarningScreen';

function collectText(node: renderer.ReactTestInstance): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') {
      parts.push(child);
      continue;
    }
    parts.push(collectText(child));
  }
  return parts.join(' ');
}

function textBlob(tree: renderer.ReactTestRenderer): string {
  return collectText(tree.root).replace(/\s+/g, ' ').trim();
}

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0);
}

describe('phase B shells', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('renders library shell with responsive grid metadata', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LibraryScreen navigation={{ navigate } as any} route={{ key: 'lib', name: 'Library' } as any} />);
    });
    const grid = tree.root.find((node) => node.props?.testID === 'library-card-grid');
    expect(grid.props.numColumns).toBe(3);
  });

  it('opens tag explorer from pool overview shell', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PoolOverviewScreen navigation={{ navigate } as any} route={{ key: 'pool', name: 'PoolOverview', params: { poolId: 'csharp' } } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Explore tags').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('TagExplorer', { poolId: 'csharp' });
  });

  it('opens planning subroutes from plan overview shell', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlanOverviewScreen navigation={{ navigate } as any} route={{ key: 'plan', name: 'PlanOverview' } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Study plan and forecast');
    expect(blob).toContain('This week needs');
    expect(blob).not.toContain('Phase B');
    act(() => {
      findPressableByText(tree, 'Today plan').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('PlanToday');
  });

  it('opens milestone detail from hall shell', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<MilestoneHallScreen navigation={{ navigate } as any} route={{ key: 'hall', name: 'MilestoneHall' } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Milestone hall');
    expect(blob).toContain('Unlocked this season');
    act(() => {
      findPressableByText(tree, 'Open detail').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('MilestoneDetail', { milestoneId: 'bronze-collect' });
  });

  it('opens backlog burst from recovery shell', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BacklogWarningScreen navigation={{ navigate } as any} route={{ key: 'backlog', name: 'BacklogWarning' } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Burst session').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('BacklogBurst');
  });
});
