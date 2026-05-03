import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
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
  listManifestDecks: vi.fn(async () => [{ slug: 'csharp' }]),
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    Cards: [{ StableUid: '1', OrderInDeck: 1, Question: 'Q1' }],
  })),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
}));

vi.mock('../../src/features/gacha/planner/sessionPlanner', () => ({
  planChallengeRoute: vi.fn(() => ({
    slug: 'csharp',
    deckTitle: 'C# Interview',
    mode: 'mixed',
    limit: 4,
    minimumGoal: 1,
    dueCount: 2,
    newCount: 1,
    nodes: [{ id: 'warmup-0', role: 'warmup', title: 'Warm-up node', subtitle: 'Start here' }],
    summary: 'C# Interview · 2 due · 1 fresh · clear 1 node to keep momentum',
  })),
}));

vi.mock('../../src/features/gacha/components/RoutePreview', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('View', null, React.createElement('Text', null, 'RoutePreview')),
  };
});

import { ChallengeScreen } from '../../src/screens/ChallengeScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findPressableByLabel(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('ChallengeScreen', () => {
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

  it('starts the planned route and navigates into SessionCard', async () => {
    const navigation = {
      navigate: vi.fn(),
      goBack: vi.fn(),
    } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ChallengeScreen
          navigation={navigation}
          route={{ key: 'challenge', name: 'Challenge', params: { slug: 'csharp' } } as any}
        />,
      );
    });
    await flush();

    const begin = tree.root.find((node) => node.props?.testID === 'challenge-begin-cta');
    act(() => {
      begin.props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith('SessionCard', {
      slug: 'csharp',
      mode: 'mixed',
      limit: 4,
    });
  });

  it('uses route-focused copy instead of placeholder challenge framing', async () => {
    const navigation = {
      navigate: vi.fn(),
      goBack: vi.fn(),
    } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ChallengeScreen
          navigation={navigation}
          route={{ key: 'challenge', name: 'Challenge', params: { slug: 'csharp' } } as any}
        />,
      );
    });
    await flush();

    const textBlob = tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    }).join('\n');

    expect(textBlob).toContain('Today’s challenge');
    expect(textBlob).toContain('Stay on streak');
    expect(textBlob).toContain('Full clear');
    expect(textBlob).toContain('Begin');
    expect(textBlob).not.toContain('Run framing');
    expect(textBlob).not.toContain('Play this run');

    const beginButtons = tree.root.findAll(
      (node) => (node.type as any) === 'Pressable' && node.props?.testID === 'challenge-begin-cta',
    );
    expect(beginButtons).toHaveLength(1);
  });
});
