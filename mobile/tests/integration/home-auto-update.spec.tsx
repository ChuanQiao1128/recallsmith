import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Free-deck auto-update from the Home load path.
 *
 * The other Home suites mock deckActionResolver wholesale, so none of them
 * can see whether Home actually asks it to apply a stale deck's update. This
 * one keeps the resolver real over an in-memory storage and a controllable
 * installer, and asserts on what the user reads: the "Updating…" chip while
 * the installer runs, its disappearance once the manifest and the installed
 * build agree, the "Update · +N cards" fallback when it fails, and that the
 * owned set and review progress under the deck are exactly what they were.
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

const card = (uid: string, order: number) => ({
  StableUid: uid,
  OrderInDeck: order,
  Difficulty: 1,
  Question: `Q ${uid}`,
  Answer: `A ${uid}`,
});

const INSTALLED_DECK = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: 'build-1',
  DeckType: 1,
  TotalCards: 3,
  Cards: [card('c1', 1), card('c2', 2), card('c3', 3)],
} as any;

const UPDATED_DECK = {
  ...INSTALLED_DECK,
  Version: 'build-2',
  TotalCards: 5,
  Cards: [...INSTALLED_DECK.Cards, card('c4', 4), card('c5', 5)],
} as any;

const REMOTE_URL = 'https://cdn.test/content/decks/csharp/builds/build-2/deck.json';

const STALE_UPDATES = {
  csharp: {
    slug: 'csharp',
    installedVersion: 'build-1',
    remoteVersion: 'build-2',
    hasUpdate: true,
    remoteUrl: REMOTE_URL,
    remoteSha256: null,
  },
};

const CURRENT_UPDATES = {
  csharp: { ...STALE_UPDATES.csharp, installedVersion: 'build-2', hasUpdate: false },
};

let deckFixture: any = INSTALLED_DECK;
let updatesFixture: Record<string, any> = STALE_UPDATES;
let installImpl: () => Promise<boolean> = async () => true;
const installDeckFromUrlMock = vi.fn(
  (_slug: string, _url: string, _version: string | null, _sha: string | null) => installImpl(),
);
const setActiveDeckSlugMock = vi.fn(async (_slug: string) => {});

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
  setActiveDeckSlug: (slug: string) => setActiveDeckSlugMock(slug),
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    {
      slug: 'csharp',
      title: 'C# Interview',
      locale: 'en-US',
      version: 'build-2',
      deckType: 1,
      tier: 'free',
      availability: 'live',
      totalCards: 5,
    },
  ]),
  resolveDeckBySlug: vi.fn(async () => deckFixture),
  checkManifestForUpdates: vi.fn(async () => updatesFixture),
  installDeckFromUrl: (slug: string, url: string, version: string | null, sha: string | null) =>
    installDeckFromUrlMock(slug, url, version, sha),
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
    currentWeekKey: '2026-W38',
  })),
}));

import { HomeScreen } from '../../src/screens/HomeScreen';
import { resetAutoUpdateAttemptsForTests } from '../../src/features/gacha/home/deckActionResolver';
import { readStoredDeckProgress, saveDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import { loadDrawState, saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { saveRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import type { CardProgress } from '../../src/review/model';

const DAY = 86_400_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function seed() {
  store.clear();
  invalidateDrawStateCache();
  setActiveUserSubForStorage(null);
  const now = Date.now();
  const progress: CardProgress[] = [
    { stableUid: 'c1', stage: 2, lastReviewedAt: now - DAY, nextReviewAt: now + 3 * DAY, lastSeenRevision: 1 },
    { stableUid: 'c2', stage: 0, nextReviewAt: 0, lastSeenRevision: 0 },
    { stableUid: 'c3', stage: 0, nextReviewAt: 0, lastSeenRevision: 0 },
  ];
  await saveDeckProgress(INSTALLED_DECK, progress);
  await saveDrawState('csharp', { owned: ['c1', 'c2'], pity: null });
  await saveRewardWalletState({ availablePulls: 0, reservePulls: 0 });
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderHome(navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <HomeScreen navigation={{ navigate } as any} route={{ key: 'home', name: 'Home' } as any} />,
    );
  });
  await flush();
  return tree;
}

function chipText(tree: renderer.ReactTestRenderer): string | null {
  const chips = tree.root.findAll(
    (node) => (node.type as any) === 'View' && node.props?.testID === 'home-pack-update-chip-csharp',
  );
  if (chips.length === 0) return null;
  const text = chips[0].find((node) => (node.type as any) === 'Text');
  return String(text.props.children ?? '');
}

function noticeText(tree: renderer.ReactTestRenderer): string | null {
  const nodes = tree.root.findAll(
    (node) => (node.type as any) === 'Text' && node.props?.testID === 'home-update-notice',
  );
  return nodes.length ? String(nodes[0].props.children ?? '') : null;
}

function packTile(tree: renderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: 'home-pack-visual' }).find(
    (node) =>
      (node.type as any) === 'Pressable'
      && typeof node.props.accessibilityLabel === 'string'
      && node.props.accessibilityLabel.startsWith('C# Interview pack'),
  );
}

describe('HomeScreen — free-deck auto-update', () => {
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    resetSessionStore();
    resetAutoUpdateAttemptsForTests();
    installDeckFromUrlMock.mockClear();
    setActiveDeckSlugMock.mockClear();
    deckFixture = INSTALLED_DECK;
    updatesFixture = STALE_UPDATES;
    installImpl = async () => true;
    await seed();
  });

  it('applies the newer build from the load path and keeps owned cards and progress', async () => {
    const install = deferred<boolean>();
    installImpl = () => install.promise;

    const tree = await renderHome();

    // Started unasked, with the manifest's url + build, and without moving the
    // active deck the way the tap-to-install flow would.
    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(1);
    expect(installDeckFromUrlMock).toHaveBeenCalledWith('csharp', REMOTE_URL, 'build-2', null);
    expect(setActiveDeckSlugMock).not.toHaveBeenCalled();

    // Non-blocking: Home is fully rendered around the in-flight state.
    expect(chipText(tree)).toBe('Updating…');
    expect(noticeText(tree)).toBe('Updating C# Interview · +2 cards…');
    expect(packTile(tree).props.accessibilityLabel).toBe('C# Interview pack — Updating');
    expect(tree.root.findByProps({ testID: 'home-primary-cta' })).toBeTruthy();

    // The installer lands: the manifest and the installed build now agree.
    deckFixture = UPDATED_DECK;
    updatesFixture = CURRENT_UPDATES;
    await act(async () => {
      install.resolve(true);
      await install.promise;
    });
    await flush();

    expect(chipText(tree)).toBeNull();
    expect(noticeText(tree)).toBeNull();
    expect(packTile(tree).props.accessibilityLabel).toBe('C# Interview pack — Ready');
    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(1);

    // What the user holds survives the update untouched, and the two new
    // cards join the deck as unowned strangers rather than free pulls.
    const drawState = await loadDrawState('csharp');
    expect(drawState.owned).toEqual(['c1', 'c2']);
    const stored = await readStoredDeckProgress('csharp');
    const c1 = stored!.find((item) => item.stableUid === 'c1');
    expect(c1?.stage).toBe(2);
    expect(stored!.map((item) => item.stableUid).sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('falls back to the visible chip when the install fails, and does not retry on its own', async () => {
    installImpl = async () => false;

    const tree = await renderHome();

    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(1);
    expect(chipText(tree)).toBe('Update · +2 cards');
    expect(noticeText(tree)).toBe('C# Interview update ready · +2 cards — tap the pack to install.');
    expect(packTile(tree).props.accessibilityLabel).toBe('C# Interview pack — Update');

    // A second Home in the same session sees the same stale deck and leaves
    // it to the chip: one attempt per slug per session.
    const again = await renderHome();
    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(1);
    expect(chipText(again)).toBe('Update · +2 cards');

    expect((await loadDrawState('csharp')).owned).toEqual(['c1', 'c2']);
  });

  it('runs the manual install from the chip and stays on Home', async () => {
    installImpl = async () => false;
    const navigate = vi.fn();
    const tree = await renderHome(navigate);
    expect(chipText(tree)).toBe('Update · +2 cards');

    // The retry succeeds.
    installImpl = async () => {
      deckFixture = UPDATED_DECK;
      updatesFixture = CURRENT_UPDATES;
      return true;
    };
    await act(async () => {
      packTile(tree).props.onPress();
      await Promise.resolve();
    });
    await flush();

    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(2);
    expect(installDeckFromUrlMock).toHaveBeenLastCalledWith('csharp', REMOTE_URL, 'build-2', null);
    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('csharp');
    expect(navigate).not.toHaveBeenCalledWith('Library');
    expect(chipText(tree)).toBeNull();
    expect(noticeText(tree)).toBeNull();
  });

  it('treats a tap on an updating pack as a selection, not a second install', async () => {
    const install = deferred<boolean>();
    installImpl = () => install.promise;
    const navigate = vi.fn();
    const tree = await renderHome(navigate);
    expect(chipText(tree)).toBe('Updating…');

    await act(async () => {
      packTile(tree).props.onPress();
      await Promise.resolve();
    });
    await flush();

    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(1);
    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('csharp');
    expect(navigate).not.toHaveBeenCalled();

    deckFixture = UPDATED_DECK;
    updatesFixture = CURRENT_UPDATES;
    await act(async () => {
      install.resolve(true);
      await install.promise;
    });
    await flush();
    expect(chipText(tree)).toBeNull();
  });

  it('leaves a premium deck alone even when its manifest build is newer', async () => {
    deckFixture = { ...INSTALLED_DECK, DeckType: 2 };
    vi.mocked(
      (await import('../../src/content/deckRepository')).listManifestDecks,
    ).mockResolvedValueOnce([
      {
        slug: 'csharp',
        title: 'C# Interview',
        locale: 'en-US',
        version: 'build-2',
        deckType: 2,
        tier: 'premium',
        availability: 'live',
        totalCards: 5,
      } as any,
    ]);

    await renderHome();

    expect(installDeckFromUrlMock).not.toHaveBeenCalled();
  });
});
