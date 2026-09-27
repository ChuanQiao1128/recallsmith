import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// X07 mobile-11: the Mistake Book loop across its seams, with the real mistakeBook module on an
// in-memory AsyncStorage. A rating on SessionCard lands in the stored book, the Mistake Book lists
// it and starts a focus run, and the focus runs resolve it: not on a same-day repeat, only once
// the second correct answer comes on another day.

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
  getUserScopedKey: vi.fn(async (key: string) => `devcards:u:test:${key}`),
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

// mistakeBook, sessionReviewHelpers, focusSession, relatedReview and the deck cache stay real.

import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { MistakeBookScreen } from '../../src/screens/MistakeBookScreen';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { loadDeckProgress, saveDeckProgress } from '../../src/review/storage';
import { recordReviewEvent } from '../../src/sync/progressSync';
import { countDueToday, pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { loadMistakeBook } from '../../src/features/gacha/mistakes/mistakeBook';

const DAY0_MS = Date.UTC(2026, 8, 27, 9, 0, 0);
const DAY_MS = 86_400_000;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');

function findPressableByLabel(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

const card = (uid: string, order: number) => ({
  StableUid: uid,
  OrderInDeck: order,
  Difficulty: 1,
  Question: `Question ${uid}`,
  Explanation: `Answer ${uid}`,
  Topic: 'linq',
});

const CARDS = [card('c1', 1), card('c2', 2), card('c3', 3)];
const DECK = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: CARDS.length,
  Cards: CARDS,
};

// Learned and not due, so a focus run is the only way these cards come up.
const LEARNED = (uid: string) => ({
  stableUid: uid,
  stage: 3,
  lastReviewedAt: DAY0_MS - DAY_MS,
  nextReviewAt: DAY0_MS + 7 * DAY_MS,
});

function flags() {
  return {
    mcq: { enabled: false, recallFirst: true, maxPerRun: 0, answerTelemetry: false },
    paywall: { hidden: false },
    ceremony: { seamOfLight: true, forceFallback: false },
    mistakeBook: { enabled: true, relatedCount: 0 },
  };
}

async function rate(tree: renderer.ReactTestRenderer, label: 'Again' | 'Good') {
  await act(async () => {
    findPressableByLabel(tree, 'Reveal answer').props.onPress();
    await Promise.resolve();
  });
  await act(async () => {
    findPressableByLabel(tree, label).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
  // The book is recorded fire-and-forget; let its serialised read-modify-write settle.
  await flush();
  await flush();
}

async function mountSession(params: Record<string, unknown>) {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <SessionCardScreen navigation={navigation} route={{ key: 'session-card', name: 'SessionCard', params } as any} />,
    );
  });
  await flush();
  await flush();
  return { tree, navigation };
}

async function openMistakeBookAndTapReview(): Promise<{ focusUids: string[] | null; doneToday: boolean }> {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), addListener: vi.fn(() => () => {}) } as any;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <MistakeBookScreen navigation={navigation} route={{ key: 'mb', name: 'MistakeBook', params: { slug: 'csharp' } } as any} />,
    );
  });
  await flush();
  expect(byTestID(tree, 'mistake-row-c1')).toHaveLength(1);
  await act(async () => {
    byTestID(tree, 'mistake-review-csharp')[0].props.onPress();
  });
  await flush();
  const call = navigation.navigate.mock.calls.find((c: any[]) => c[0] === 'SessionCard');
  const doneToday = byTestID(tree, 'mistake-done-today-csharp').length === 1;
  await act(async () => {
    tree.unmount();
  });
  return { focusUids: call ? (call[1].focusUids as string[]) : null, doneToday };
}

async function openMistakeBookAndStartFocus(): Promise<string[]> {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), addListener: vi.fn(() => () => {}) } as any;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <MistakeBookScreen navigation={navigation} route={{ key: 'mb', name: 'MistakeBook', params: { slug: 'csharp' } } as any} />,
    );
  });
  await flush();
  expect(byTestID(tree, 'mistake-row-c1')).toHaveLength(1);
  await act(async () => {
    byTestID(tree, 'mistake-review-csharp')[0].props.onPress();
  });
  await flush();
  expect(navigation.navigate).toHaveBeenCalledWith('SessionCard', expect.objectContaining({ slug: 'csharp' }));
  const focusUids = navigation.navigate.mock.calls[0][1].focusUids as string[];
  await act(async () => {
    tree.unmount();
  });
  return focusUids;
}

async function focusRunAllGood(focusUids: string[]) {
  resetSessionStore();
  const { tree, navigation } = await mountSession({ slug: 'csharp', focusUids });
  for (let i = 0; i < focusUids.length; i += 1) await rate(tree, 'Good');
  expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ slug: 'csharp' }));
  await act(async () => {
    tree.unmount();
  });
}

async function storedC1() {
  return (await loadMistakeBook()).entries['csharp::c1'];
}

describe('Mistake Book loop across SessionCard and the real store', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    resetSessionStore();
    featureFlagsMock.mockReturnValue(flags());
    vi.mocked(countDueToday).mockReturnValue(0);
    vi.mocked(resolveDeckBySlug).mockResolvedValue(DECK as any);
    vi.mocked(loadDeckProgress).mockResolvedValue(CARDS.map((c) => LEARNED(c.StableUid)) as any);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DAY0_MS);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('records Again, lists it, and resolves it only after correct focus runs on two days', async () => {
    // A normal one-card run deals c1 and the user rates it Again.
    vi.mocked(planChallengeRoute).mockReturnValue({
      slug: 'csharp',
      deckTitle: 'C# Interview',
      mode: 'mixed',
      limit: 1,
      minimumGoal: 1,
      dueCount: 1,
      newCount: 0,
      nodes: [{ id: 'warmup-0', role: 'warmup', title: 'Warm-up node', subtitle: 'Start.' }],
      summary: 'C# Interview',
    } as any);
    vi.mocked(pickNextCard).mockReturnValue({ card: CARDS[0], progress: LEARNED('c1') } as any);
    const normal = await mountSession({ slug: 'csharp', mode: 'mixed' });
    await rate(normal.tree, 'Again');
    await act(async () => {
      normal.tree.unmount();
    });
    expect(await storedC1()).toMatchObject({ wrongCount: 1, correctStreak: 0, resolvedAt: null, topic: 'linq' });

    // Focus runs from here on: the planner has nothing due.
    vi.mocked(pickNextCard).mockReturnValue(null);

    // Day 0: the Mistake Book lists c1 and starts a focus run; a Good counts once.
    const focusUids = await openMistakeBookAndStartFocus();
    expect(focusUids).toEqual(['c1']);
    await focusRunAllGood(focusUids);
    expect(await storedC1()).toMatchObject({ correctStreak: 1, resolvedAt: null, lastCorrectAt: DAY0_MS });

    // Day 0 again, a minute later: a back-to-back run does not clear the card. Y08 mobile-12: the
    // card already got today's correct answer, so the tap no longer starts a run at all.
    vi.setSystemTime(DAY0_MS + 60_000);
    expect(await openMistakeBookAndTapReview()).toEqual({ focusUids: null, doneToday: true });
    expect(await storedC1()).toMatchObject({ correctStreak: 1, resolvedAt: null, lastCorrectAt: DAY0_MS });

    // Day 1: the second correct answer on another day resolves it, and the book empties.
    const day1 = DAY0_MS + DAY_MS;
    vi.setSystemTime(day1);
    await focusRunAllGood(await openMistakeBookAndStartFocus());
    expect(await storedC1()).toMatchObject({ correctStreak: 2, resolvedAt: day1 });

    const navigation = { navigate: vi.fn(), goBack: vi.fn(), addListener: vi.fn(() => () => {}) } as any;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <MistakeBookScreen navigation={navigation} route={{ key: 'mb', name: 'MistakeBook', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();
    expect(byTestID(tree, 'mistake-book-empty')).toHaveLength(1);
    expect(byTestID(tree, 'mistake-row-c1')).toHaveLength(0);
  });

  it('gives no scheduler credit to cards that are not due and deals nothing twice on the same day', async () => {
    // Y08 mobile-12. Progress is stateful here: what a run saves is what the next run loads.
    featureFlagsMock.mockReturnValue({ ...flags(), mistakeBook: { enabled: true, relatedCount: 2 } });
    const saved = new Map<string, any>();
    vi.mocked(loadDeckProgress).mockImplementation(async () => CARDS.map((c) => saved.get(c.StableUid)) as any);
    vi.mocked(saveDeckProgress).mockImplementation(async (_deck: any, rows: any[]) => {
      for (const row of rows) saved.set(row.stableUid, { ...row });
    });
    // c1 was missed an hour ago (Again: stage dropped, due again after 10 minutes). c2 and c3 are
    // learned at stage 1 and not due until tomorrow.
    saved.set('c1', { stableUid: 'c1', stage: 1, lastReviewedAt: DAY0_MS - 3_600_000, nextReviewAt: DAY0_MS - 3_000_000 });
    for (const uid of ['c2', 'c3']) {
      saved.set(uid, { stableUid: uid, stage: 1, lastReviewedAt: DAY0_MS - DAY_MS, nextReviewAt: DAY0_MS + DAY_MS });
    }
    store.set(
      'devcards:u:test:devcards:mistakes:v1',
      JSON.stringify({
        v: 1,
        entries: {
          'csharp::c1': {
            deckSlug: 'csharp',
            stableUid: 'c1',
            topic: 'linq',
            wrongCount: 1,
            firstWrongAt: DAY0_MS - 3_600_000,
            lastWrongAt: DAY0_MS - 3_600_000,
            lastOutcome: 'again',
            correctStreak: 0,
            resolvedAt: null,
          },
        },
      }),
    );
    vi.mocked(pickNextCard).mockReturnValue(null);
    const scheduleOf = (uid: string) => ({ stage: saved.get(uid).stage, nextReviewAt: saved.get(uid).nextReviewAt });

    // First run: the due mistake earns its credit; the two related cards, not due, earn none.
    const first = await openMistakeBookAndTapReview();
    expect(first).toEqual({ focusUids: ['c1', 'c2', 'c3'], doneToday: false });
    await focusRunAllGood(first.focusUids!);
    expect(scheduleOf('c1')).toEqual({ stage: 2, nextReviewAt: DAY0_MS + 4 * DAY_MS });
    expect(scheduleOf('c2')).toEqual({ stage: 1, nextReviewAt: DAY0_MS + DAY_MS });
    expect(scheduleOf('c3')).toEqual({ stage: 1, nextReviewAt: DAY0_MS + DAY_MS });
    expect(saved.get('c2').lastReviewedAt).toBe(DAY0_MS);
    expect(await storedC1()).toMatchObject({ correctStreak: 1, lastCorrectAt: DAY0_MS });
    // Z07 mobile-18: the review events tell the practice ratings from the real review, and carry
    // the unchanged schedule the practice ratings saved.
    const firstEvents = vi.mocked(recordReviewEvent).mock.calls.map(([event]) => event);
    expect(firstEvents.map((event) => [event.stableUid, event.reviewStage])).toEqual([
      ['c1', 'repeat_review'],
      ['c2', 'focus_practice'],
      ['c3', 'focus_practice'],
    ]);
    for (const event of firstEvents.slice(1)) {
      expect(event.progressAfter).toMatchObject({ stage: 1, nextReviewAt: DAY0_MS + DAY_MS, lastReviewedAt: DAY0_MS });
    }
    const afterFirst = { c1: scheduleOf('c1'), c2: scheduleOf('c2'), c3: scheduleOf('c3') };

    // Second tap a minute later: nothing is dealt again, and no schedule moves.
    vi.setSystemTime(DAY0_MS + 60_000);
    expect(await openMistakeBookAndTapReview()).toEqual({ focusUids: null, doneToday: true });
    expect({ c1: scheduleOf('c1'), c2: scheduleOf('c2'), c3: scheduleOf('c3') }).toEqual(afterFirst);

    // Next day the mistake is back for its second correct answer (not due yet: no credit), and the
    // related cards are eligible again.
    const day1 = DAY0_MS + DAY_MS + 60_000;
    vi.setSystemTime(day1);
    const next = await openMistakeBookAndTapReview();
    expect(next.focusUids?.[0]).toBe('c1');
    await focusRunAllGood(next.focusUids!);
    expect(await storedC1()).toMatchObject({ correctStreak: 2, resolvedAt: day1 });
    expect(scheduleOf('c1')).toEqual(afterFirst.c1);
  });
});
