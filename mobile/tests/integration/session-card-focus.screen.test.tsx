import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// deckCache memoizes deck reads at module scope; clear it between tests so a
// changed resolveDeckBySlug mock is not shadowed by a prior test's entry (G30).
beforeEach(() => {
  invalidateDeckCache();
});

const announceMock = vi.hoisted(() => vi.fn());

vi.mock('react-native', () => {
  const React = require('react');
  class MockAnimatedValue {
    value: number;
    constructor(value: number) {
      this.value = value;
    }
    interpolate(config: any) {
      return config.outputRange?.[0] ?? this.value;
    }
    setValue(value: number) {
      this.value = value;
    }
    stopAnimation() {}
  }
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
    Animated: {
      View: ({ children, ...props }: any) => React.createElement('AnimatedView', props, children),
      Value: MockAnimatedValue,
      spring: (_value: any, _config: any) => ({ start: (cb?: any) => cb?.() }),
    },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Alert: { alert: vi.fn() },
    StyleSheet: { create: (styles: any) => styles },
    // Read through readRN('AccessibilityInfo', null) at module level, so it must exist at import time.
    AccessibilityInfo: { announceForAccessibility: (text: string) => announceMock(text) },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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

vi.mock('../../src/components/CodeBlock', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('View', null, React.createElement('Text', null, 'CodeBlock')),
  };
});

const featureFlagsMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/config/featureFlags', () => ({
  useFeatureFlags: () => featureFlagsMock(),
  getFeatureFlags: () => featureFlagsMock(),
}));

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => store.delete(key));
    }),
  },
}));

// deckCache reads the user scope through a guarded dynamic import of
// progressScope; mock it so that import resolves to a fixed scope instead of
// dragging in the real authStore -> react-native chain the runner cannot parse.
vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async () => null),
  listManifestDecks: vi.fn(async () => []),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => true),
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  saveDeckProgress: vi.fn(async () => {}),
  loadOrInitDailyStats: vi.fn(async () => ({ dateKey: '2026-09-22', plannedCount: 0, doneCount: 0 })),
}));

vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: vi.fn(async () => {}),
}));

vi.mock('../../src/sync/progressSync', () => ({
  recordReviewEvent: vi.fn(async () => 'evt-1'),
  scheduleProgressSync: vi.fn(async () => {}),
  applyCachedRemoteProgress: vi.fn(async () => {}),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(),
}));

vi.mock('../../src/premium/revenuecat', () => ({
  rcGetCustomerInfoSafe: vi.fn(async () => null),
  isPremiumActive: vi.fn(() => false),
}));

vi.mock('../../src/features/gacha/session/reviewContentHelpers', () => ({
  buildCardMap: vi.fn(() => new Map()),
  buildPreviewDeck: vi.fn((deck: any, previewCount: number) => ({
    ...deck,
    Cards: (deck.Cards ?? []).slice(0, previewCount),
  })),
  normalizeCodeLanguage: vi.fn(() => 'text'),
  renderSimpleMarkdown: vi.fn(() => []),
  showTrialUpsellDialog: vi.fn(),
  sortCards: vi.fn((deck: any) => deck.Cards ?? []),
}));

vi.mock('../../src/features/gacha/planner/sessionPlanner', () => ({
  countDueToday: vi.fn(() => 0),
  pickNextCard: vi.fn(() => null),
  planChallengeRoute: vi.fn(() => ({
    slug: 'csharp',
    deckTitle: 'C# Interview',
    mode: 'mixed',
    limit: 1,
    minimumGoal: 1,
    dueCount: 0,
    newCount: 1,
    nodes: [{ id: 'warmup-0', role: 'warmup', title: 'Warm-up node', subtitle: 'Start.' }],
    summary: 'C# Interview',
  })),
}));

vi.mock('../../src/features/gacha/rewards/sessionRewards', () => {
  const PAID_STEP = {
    newCardPaid: true,
    dueClearPaid: false,
    pulls: 1,
    walletBefore: { availablePulls: 0, reservePulls: 0 },
    walletAfter: { availablePulls: 1, reservePulls: 0 },
    applied: { availablePulls: 1, reservePulls: 0, appliedToAvailable: 1, appliedToReserve: 0, dropped: 0 },
    newCardsLearnedToday: 1,
  };
  const ZERO_STEP = {
    newCardPaid: false,
    dueClearPaid: false,
    pulls: 0,
    walletBefore: null,
    walletAfter: null,
    applied: null,
    newCardsLearnedToday: 0,
  };
  return {
    settleRatingReward: vi.fn(async (input: any) => (input.rating === 'again' ? ZERO_STEP : PAID_STEP)),
  };
});

vi.mock('../../src/features/gacha/mistakes/mistakeBook', () => ({
  recordMistakeOutcome: vi.fn(async () => {}),
}));

// sessionReviewHelpers and focusSession stay real: the focus run must pick its cards itself, and
// the planner below is told that nothing is due (pickNextCard answers null) and that the deck has
// no route (EMPTY_ROUTE_LIMIT), which a normal run would stop on.

import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { loadDeckProgress, saveDeckProgress } from '../../src/review/storage';
import { recordReviewEvent } from '../../src/sync/progressSync';
import { countDueToday, pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';

const FIXED_NOW_MS = Date.UTC(2026, 8, 27, 9, 0, 0);
const DAY_MS = 86_400_000;

function flags() {
  return {
    mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false },
    paywall: { hidden: false },
    ceremony: { seamOfLight: true, forceFallback: false },
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

function findPressableByLabel(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

function hasText(tree: renderer.ReactTestRenderer, text: string): boolean {
  return tree.root.findAll((node) => (node.type as any) === 'Text' && node.props.children === text).length > 0;
}

const card = (uid: string, order: number) => ({
  StableUid: uid,
  OrderInDeck: order,
  Difficulty: 1,
  Question: `Question ${uid}`,
  Explanation: `Answer ${uid}`,
});

const CARDS = [card('c1', 1), card('c2', 2), card('c3', 3), card('c4', 4)];

// Learned, next review a week out: none of these is due today.
const LEARNED = (uid: string) => ({
  stableUid: uid,
  stage: 3,
  lastReviewedAt: FIXED_NOW_MS - DAY_MS,
  nextReviewAt: FIXED_NOW_MS + 7 * DAY_MS,
});

function emptyRoute() {
  return {
    slug: 'csharp',
    deckTitle: 'C# Interview',
    mode: 'mixed',
    limit: 0,
    minimumGoal: 0,
    dueCount: 0,
    newCount: 0,
    nodes: [],
    summary: 'C# Interview',
  };
}

describe('SessionCardScreen focus run', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    resetSessionStore();
    featureFlagsMock.mockReturnValue(flags());
    vi.mocked(planChallengeRoute).mockReturnValue(emptyRoute() as any);
    vi.mocked(countDueToday).mockReturnValue(0);
    vi.mocked(pickNextCard).mockReturnValue(null);
    vi.mocked(resolveDeckBySlug).mockResolvedValue({
      Slug: 'csharp',
      Title: 'C# Interview',
      Locale: 'en-US',
      Version: '1',
      DeckType: 1,
      TotalCards: CARDS.length,
      Cards: CARDS,
    } as any);
    vi.mocked(loadDeckProgress).mockResolvedValue(CARDS.map((c) => LEARNED(c.StableUid)) as any);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW_MS);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  async function mount(focusUids: unknown) {
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{ key: 'session-card', name: 'SessionCard', params: { slug: 'csharp', focusUids } } as any}
        />,
      );
    });
    await flush();
    await flush();
    return { tree, navigation };
  }

  async function rateGood(tree: renderer.ReactTestRenderer) {
    await act(async () => {
      findPressableByLabel(tree, 'Reveal answer').props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      findPressableByLabel(tree, 'Good').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
  }

  it('serves the focus cards in the given order even when none is due', async () => {
    const { tree, navigation } = await mount(['c3', 'c1', 'c4']);

    expect(hasText(tree, 'Question c3')).toBe(true);
    expect(navigation.replace).not.toHaveBeenCalled();

    await rateGood(tree);
    expect(hasText(tree, 'Question c1')).toBe(true);
    expect(hasText(tree, 'Question c3')).toBe(false);

    await rateGood(tree);
    expect(hasText(tree, 'Question c4')).toBe(true);

    const rated = vi.mocked(recordReviewEvent).mock.calls.map(([event]) => event.stableUid);
    expect(rated).toEqual(['c3', 'c1']);
    expect(saveDeckProgress).toHaveBeenCalledTimes(2);
  });

  it('ends the focus run on the summary after the last focus card', async () => {
    const { tree, navigation } = await mount(['c2', 'c4']);

    await rateGood(tree);
    expect(navigation.replace).not.toHaveBeenCalled();
    await rateGood(tree);

    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith(
      'SessionSummary',
      expect.objectContaining({ slug: 'csharp', sessionDone: 2, sessionLimit: 2 }),
    );
    const rated = vi.mocked(recordReviewEvent).mock.calls.map(([event]) => event.stableUid);
    expect(rated).toEqual(['c2', 'c4']);
  });

  it('ignores focus uids the deck does not contain', async () => {
    const { tree, navigation } = await mount(['missing-1', 'c2', 'missing-2', 42, '  ']);

    expect(hasText(tree, 'Question c2')).toBe(true);
    await rateGood(tree);

    expect(navigation.replace).toHaveBeenCalledWith(
      'SessionSummary',
      expect.objectContaining({ sessionDone: 1, sessionLimit: 1 }),
    );
    expect(vi.mocked(recordReviewEvent).mock.calls.map(([event]) => event.stableUid)).toEqual(['c2']);
  });

  it('runs a normal session when no focus uid is usable', async () => {
    vi.mocked(planChallengeRoute).mockReturnValue({ ...emptyRoute(), limit: 1, minimumGoal: 1, newCount: 1 } as any);
    const { tree } = await mount(['missing-1']);

    expect(pickNextCard).toHaveBeenCalledWith(expect.objectContaining({ mode: 'mixed' }));
    expect(hasText(tree, 'Question c1')).toBe(false);
    expect(recordReviewEvent).not.toHaveBeenCalled();
  });
});
