import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// deckCache memoizes deck reads at module scope; clear it between tests so a
// changed resolveDeckBySlug mock is not shadowed by a prior test's entry (G30).
beforeEach(() => {
  invalidateDeckCache();
});

let manifestFixture: any[] = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
let resolveDeckFixture: any = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
};

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
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

vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => {
    if (typeof manifestFixture === 'function') return (manifestFixture as any)();
    return manifestFixture;
  }),
  resolveDeckBySlug: vi.fn(async (slug: string) => {
    if (typeof resolveDeckFixture === 'function') return resolveDeckFixture(slug);
    return resolveDeckFixture;
  }),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => false),
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  loadRewardWalletState: vi.fn(async () => ({ availablePulls: 12, reservePulls: 0 })),
  consumePullsFromStoredWallet: vi.fn(async () => ({ wallet: { availablePulls: 12, reservePulls: 0 }, spent: 0, promotedFromReserve: 0 })),
  saveRewardWalletState: vi.fn(async () => {}),
  refundPullsToStoredWallet: vi.fn(async () => ({ availablePulls: 12, reservePulls: 0 })),
}));

vi.mock('../../src/features/gacha/draw/drawCommit', () => ({
  commitDraw: vi.fn(async () => null),
}));

vi.mock('../../src/sync/progressSync', () => ({
  scheduleProgressSync: vi.fn(),
}));

import { DrawScreen } from '../../src/screens/DrawScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function collectText(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

describe('friendly load errors', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    manifestFixture = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
    resolveDeckFixture = {
      Slug: 'csharp',
      Title: 'C# Interview',
      Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
    };
  });

  it('shows friendly offline copy instead of the raw transport error on Draw', async () => {
    manifestFixture = (() => {
      throw new TypeError('Network request failed');
    }) as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen
          navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any}
          route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any}
        />,
      );
    });
    await flush();

    const text = collectText(tree);
    expect(text).toContain("You're offline. Check your connection and try again.");
    expect(text).not.toContain('Network request failed');
    expect(tree.root.findByProps({ testID: 'screen-draw-primary-cta' })).toBeTruthy();
  });

  it('shows friendly content copy for a failed pack download on Draw', async () => {
    resolveDeckFixture = () => {
      throw new Error('download_failed_http_404: <html><body>Not Found</body></html>');
    };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen
          navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any}
          route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any}
        />,
      );
    });
    await flush();

    const text = collectText(tree);
    expect(text).toContain("This pack couldn't be loaded. Try again, or pick another pack.");
    expect(text).not.toContain('<html>');
  });
});
