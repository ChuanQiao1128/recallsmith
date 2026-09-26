import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proof that HomeScreen itself runs the economy floor.
 *
 * The other Home suites mock `loadHomeDeckSummaries` wholesale, so they can
 * never see the floor: a mocked snapshot carries no starvation counts, and
 * the floor refuses to grant without them. That is the correct behaviour --
 * absent counts are not zero counts -- but it means deleting the floor call
 * out of refreshHome would leave every one of those suites green.
 *
 * This one keeps deckActionResolver, rewardWallet and economyFloor real over
 * an in-memory storage, and asserts on what the user reads on the screen.
 */

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

const DECK = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 3,
  Cards: [
    { StableUid: 'c1', OrderInDeck: 1, Difficulty: 1, Question: 'Q one', Answer: 'A1' },
    { StableUid: 'c2', OrderInDeck: 2, Difficulty: 1, Question: 'Q two', Answer: 'A2' },
    { StableUid: 'c3', OrderInDeck: 3, Difficulty: 1, Question: 'Q three', Answer: 'A3' },
  ],
} as any;

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
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    Alert: { alert: vi.fn() },
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
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

// deckCache reads the user scope through a guarded dynamic import of
// progressScope; mock it so that import resolves to a fixed scope instead of
// dragging in the real authStore -> react-native chain the runner cannot parse.
vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    {
      slug: 'csharp',
      title: 'C# Interview',
      locale: 'en-US',
      version: '1',
      deckType: 1,
      availability: 'live',
      totalCards: 3,
    },
  ]),
  resolveDeckBySlug: vi.fn(async () => DECK),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => true),
}));

vi.mock('../../src/sync/progressSync', () => ({
  forceProgressSync: vi.fn(async () => {}),
  applyCachedRemoteProgress: vi.fn(async () => {}),
}));

vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: vi.fn(async () => {}),
}));

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({ status: 'signed_out', accessToken: '', init: vi.fn(async () => {}), userSub: null }),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/home/homeRemote', () => ({
  fetchServerPremium: vi.fn(async () => false),
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => ({
    currentDailyStreak: 0,
    longestDailyStreak: 0,
    weekCompletedDays: 0,
    totalQualifiedSessions: 0,
    lastQualifiedDateKey: null,
    currentWeekKey: '2026-W34',
  })),
}));

import { HomeScreen } from '../../src/screens/HomeScreen';
import { saveDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import {
  loadRewardWalletState,
  saveRewardWalletState,
} from '../../src/features/gacha/rewards/rewardWallet';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import type { CardProgress } from '../../src/review/model';

function untouched(stableUid: string): CardProgress {
  return { stableUid, stage: 0, nextReviewAt: 0, lastSeenRevision: 0 };
}

async function seed(owned: string[]) {
  store.clear();
  invalidateDrawStateCache();
  setActiveUserSubForStorage(null);
  await saveDeckProgress(DECK, [untouched('c1'), untouched('c2'), untouched('c3')]);
  await saveDrawState('csharp', { owned, pity: null });
  await saveRewardWalletState({ availablePulls: 0, reservePulls: 0 });
}

async function renderHome() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <HomeScreen
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: 'home', name: 'Home' } as any}
      />,
    );
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return tree;
}

function badgeText(tree: renderer.ReactTestRenderer): string {
  const node = tree.root.findByProps({ testID: 'home-draw-status-badge' });
  const children = node.props.children;
  return Array.isArray(children) ? children.join('') : String(children ?? '');
}

describe('HomeScreen — economy floor wiring', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    resetSessionStore();
    vi.clearAllMocks();
  });

  it('shows the starved user a pull on the same load that granted it', async () => {
    await seed([]);

    const tree = await renderHome();

    // The badge reads off homeState.vm.draw, which is built from the wallet
    // refreshHome hands to buildHomeScreenVM. Granting inside the summaries
    // load instead would leave this reading "Clear today's route to unlock
    // pulls" until the next focus -- the screen telling the user they are
    // stuck on the very load that unstuck them.
    expect(badgeText(tree)).toBe('1 pull ready');
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 1, reservePulls: 0 });
    expect(store.get('devcards:u:anon:recallsmith:economy-floor:v1')).toBeTruthy();
  });

  it('leaves a user with cards to study exactly as poor as they were', async () => {
    await seed(['c1']);

    const tree = await renderHome();

    expect(badgeText(tree)).toBe('Learn a new card to earn a pull');
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });
    expect(store.has('devcards:u:anon:recallsmith:economy-floor:v1')).toBe(false);
  });
});
