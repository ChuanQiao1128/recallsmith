import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// deckCache memoizes deck reads at module scope; clear it between tests so a
// changed resolveDeckBySlug mock is not shadowed by a prior test's entry.
beforeEach(() => {
  invalidateDeckCache();
});

/**
 * DrawScreen over the REAL deckWallet and a real (in-memory) AsyncStorage, with
 * two packs installed. Proves the badge, the spend and the refund all follow the
 * selected pack and never bleed into another pack's pool.
 */

const store = new Map<string, string>();
let failNavigate = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null] as [string, string | null])),
  },
}));

const SCOPE = 'devcards:u:anon:';
const WALLET_KEY = `${SCOPE}recallsmith:deck-wallets:v1`;

function seedWallets(pulls: Record<string, { availablePulls: number; reservePulls: number }>): void {
  const bootstrappedAtMs: Record<string, number> = {};
  for (const slug of Object.keys(pulls)) bootstrappedAtMs[slug] = 1;
  store.set(
    WALLET_KEY,
    JSON.stringify({ migratedAtMs: 1, decks: pulls, bootstrappedAtMs }),
  );
}
function readPack(slug: string): { availablePulls: number; reservePulls: number } {
  const raw = store.get(WALLET_KEY);
  if (!raw) return { availablePulls: 0, reservePulls: 0 };
  return JSON.parse(raw).decks?.[slug] ?? { availablePulls: 0, reservePulls: 0 };
}

function makeDeck(slug: string, title: string) {
  return {
    Slug: slug,
    Title: title,
    Locale: 'en',
    Version: '1',
    DeckType: 1,
    IsFreeStarter: true,
    TotalCards: 3,
    FreeCardCount: 3,
    Cards: Array.from({ length: 3 }, (_, i) => ({
      StableUid: `${slug}-c${i + 1}`,
      Question: `${slug} Q${i + 1}`,
      Difficulty: 1,
      OrderInDeck: i + 1,
    })),
  };
}
const DECKS: Record<string, any> = {
  aws: makeDeck('aws', 'AWS Core'),
  csharp: makeDeck('csharp', 'C# Interview'),
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
  loadActiveDeckSlug: vi.fn(async () => 'aws'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    { slug: 'aws', availability: 'live', title: 'AWS Core' },
    { slug: 'csharp', availability: 'live', title: 'C# Interview' },
  ]),
  resolveDeckBySlug: vi.fn(async (slug: string) => DECKS[slug] ?? null),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => false),
}));

vi.mock('../../src/review/storage', () => ({
  getUserScopedKey: vi.fn(async (baseKey: string) => `${SCOPE}${baseKey}`),
  loadDeckProgress: vi.fn(async () => []),
}));

vi.mock('../../src/sync/progressSync', () => ({
  scheduleProgressSync: vi.fn(),
}));

import { DrawScreen } from '../../src/screens/DrawScreen';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { flushDrawHistory } from '../../src/features/gacha/draw/drawCommit';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function armPackSwipe(tree: renderer.ReactTestRenderer) {
  const swipeZone = tree.root.findByProps({ testID: 'draw-card-stack-stage' });
  act(() => {
    swipeZone.props.onResponderGrant({ nativeEvent: { pageX: 10 } });
    swipeZone.props.onResponderRelease({ nativeEvent: { pageX: 120 } });
  });
}

function badgeLabel(tree: renderer.ReactTestRenderer): string {
  return tree.root.findByProps({ testID: 'draw-pack-pulls-badge' }).props.accessibilityLabel;
}

async function mountDraw(navigate: ReturnType<typeof vi.fn>, slug = 'aws') {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <DrawScreen
        navigation={{ goBack: vi.fn(), navigate } as any}
        route={{ key: 'draw', name: 'Draw', params: { slug } } as any}
      />,
    );
  });
  await flush();
  return tree;
}

describe('DrawScreen · per-pack wallet', () => {
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    failNavigate = false;
    seedWallets({ aws: { availablePulls: 5, reservePulls: 0 }, csharp: { availablePulls: 2, reservePulls: 0 } });
    // Both packs have unopened cards so a draw returns something.
    await saveDrawState('aws', { owned: [], pity: { draws: 0, threshold: 10 } });
    await saveDrawState('csharp', { owned: [], pity: { draws: 0, threshold: 10 } });
  });

  it('shows the selected pack pulls on the badge and switches with the pack', async () => {
    const tree = await mountDraw(vi.fn(), 'aws');
    expect(badgeLabel(tree)).toBe('5 pulls for AWS Core');

    // Switch to the neighbour pack; the badge follows the selected pack.
    await act(async () => {
      tree.root.findByProps({ testID: 'draw-neighbor-right' }).props.onPress();
      await Promise.resolve();
    });
    await flush();

    expect(badgeLabel(tree)).toBe('2 pulls for C# Interview');
  });

  it('charges an open to the selected pack only', async () => {
    const navigate = vi.fn();
    const tree = await mountDraw(navigate, 'aws');
    armPackSwipe(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalled();
    expect(readPack('aws')).toEqual({ availablePulls: 4, reservePulls: 0 });
    // The other pack is untouched.
    expect(readPack('csharp')).toEqual({ availablePulls: 2, reservePulls: 0 });
  });

  it('refunds a failed open to the pack it was charged from', async () => {
    const navigate = vi.fn(() => {
      throw new Error('navigation exploded after the charge landed');
    });
    const tree = await mountDraw(navigate, 'aws');
    armPackSwipe(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Charged then refunded to aws: net back to 5. csharp never moved.
    expect(readPack('aws')).toEqual({ availablePulls: 5, reservePulls: 0 });
    expect(readPack('csharp')).toEqual({ availablePulls: 2, reservePulls: 0 });
  });
});
