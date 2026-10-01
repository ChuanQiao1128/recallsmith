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

vi.mock('../../src/features/gacha/session/sessionReviewHelpers', () => ({
  buildRatedSessionState: vi.fn(() => ({
    updatedProgress: [{ stableUid: 'x', stage: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 60000 }],
    updatedOne: { stableUid: 'x', stage: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 60000, lastSeenRevision: 1 },
    nextDone: 1,
    nextCurrent: null,
    prevLearnedCount: 0,
    remainingDueCount: 0,
  })),
  buildSessionProgressVM: vi.fn(() => ({ title: 'Session progress', subtitle: 'Run 0/1 · Mixed', progressText: '0 / 1', hint: '0 due', percent: 0, currentRoleLabel: 'Warm-up node' })),
  modeLabel: vi.fn(() => 'Mixed'),
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

// The Mistake Book itself is covered by tests/unit/mistakeBook.test.ts; here only the hook's call
// contract on the rating path is under test.
vi.mock('../../src/features/gacha/mistakes/mistakeBook', () => ({
  recordMistakeOutcome: vi.fn(async () => {}),
}));

import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { loadDeckProgress, saveDeckProgress } from '../../src/review/storage';
import { recordReviewEvent } from '../../src/sync/progressSync';
import { countDueToday, pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { settleRatingReward } from '../../src/features/gacha/rewards/sessionRewards';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { recordMistakeOutcome } from '../../src/features/gacha/mistakes/mistakeBook';

const FIXED_NOW_MS = Date.UTC(2026, 8, 27, 9, 0, 0);

function flags(overrides: Record<string, unknown> = {}) {
  return {
    mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false, ...overrides },
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

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');

function buildDeck(overrides: Record<string, unknown> = {}) {
  return {
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: 1,
    Cards: [],
    ...overrides,
  };
}

function buildChallengeRoute() {
  return {
    slug: 'csharp',
    deckTitle: 'C# Interview',
    mode: 'mixed',
    limit: 1,
    minimumGoal: 1,
    dueCount: 0,
    newCount: 1,
    nodes: [{ id: 'warmup-0', role: 'warmup', title: 'Warm-up node', subtitle: 'Start.' }],
    summary: 'C# Interview',
  };
}

const QA_CARD = { StableUid: 'qa-1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Answer: 'A1', Topic: 'linq' };

const MCQ_CARD = {
  StableUid: 'aws-sqs-order-buffer-mcq-01',
  Revision: 1,
  Question: 'An order API is overwhelmed during flash sales. Which solution keeps accepting orders with the LEAST operational overhead?',
  Explanation: 'Put an SQS standard queue between the API and fulfilment and scale on queue depth.',
  Difficulty: 2,
  OrderInDeck: 155,
  Mcq: {
    v: 1,
    options: [
      { key: 'a', why: 'Vertical scaling does not buffer a burst.', text: 'Increase the instance size of the fulfilment service.', correct: false },
      { key: 'b', why: null, text: 'Publish each order to an SQS standard queue and scale fulfilment on queue depth.', correct: true },
      { key: 'c', why: 'A single shard caps ingest.', text: 'Write each order to a one-shard Kinesis stream.', correct: false },
      { key: 'd', why: 'Polling turns the database into a queue.', text: 'Insert each order into an RDS table and poll it.', correct: false },
    ],
    shuffle: true,
    qualifier: 'LEAST operational overhead',
  },
};

const NEW_PROGRESS = (uid: string) => ({ stableUid: uid, stage: 0, nextReviewAt: 0 });
// A Q/A card the learner has reviewed before: rated directly. A never-reviewed Q/A card opens on
// the study view (R22 §6), and its recall check never writes the book (session-card.screen.test).
const LEARNED_PROGRESS = (uid: string) => ({ stableUid: uid, stage: 1, nextReviewAt: 0, lastReviewedAt: FIXED_NOW_MS - 86_400_000 });

const SUMMARY = expect.objectContaining({ slug: 'csharp', sessionDone: 1 });

describe('SessionCardScreen Mistake Book hook', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
    resetSessionStore();
    featureFlagsMock.mockReturnValue(flags());
    vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute() as any);
    vi.mocked(countDueToday).mockReturnValue(0);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW_MS);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.useRealTimers();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function serve(card: any) {
    const progress = card.Mcq ? NEW_PROGRESS(card.StableUid) : LEARNED_PROGRESS(card.StableUid);
    vi.mocked(resolveDeckBySlug).mockResolvedValue(buildDeck({ Cards: [card] }) as any);
    vi.mocked(pickNextCard).mockReturnValue({ card, progress } as any);
    vi.mocked(loadDeckProgress).mockResolvedValue([progress] as any);
  }

  async function mount() {
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{ key: 'session-card', name: 'SessionCard', params: { slug: 'csharp', mode: 'mixed', limit: 1 } } as any}
        />,
      );
    });
    await flush();
    await flush();
    return { tree, navigation };
  }

  async function press(tree: renderer.ReactTestRenderer, id: string) {
    await act(async () => {
      byTestID(tree, id)[0].props.onPress();
      await Promise.resolve();
    });
    await flush();
  }

  async function rateQaAgain() {
    serve(QA_CARD);
    const { tree, navigation } = await mount();
    await act(async () => {
      findPressableByLabel(tree, 'Reveal answer').props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      findPressableByLabel(tree, 'Forgot').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    return { tree, navigation };
  }

  it('records the outcome after rating a card Again', async () => {
    // A recording that never settles: the rating must not wait for it.
    vi.mocked(recordMistakeOutcome).mockImplementationOnce(() => new Promise<void>(() => {}));
    const { navigation } = await rateQaAgain();

    expect(recordMistakeOutcome).toHaveBeenCalledTimes(1);
    expect(recordMistakeOutcome).toHaveBeenCalledWith({
      deckSlug: 'csharp',
      stableUid: 'qa-1',
      topic: 'linq',
      rating: 'again',
      mcqVerdict: null,
      at: FIXED_NOW_MS,
    });
    expect(vi.mocked(recordMistakeOutcome).mock.calls[0][0].at).toEqual(expect.any(Number));
    expect(recordReviewEvent).toHaveBeenCalledTimes(1);
    const eventOrder = vi.mocked(recordReviewEvent).mock.invocationCallOrder[0];
    const mistakeOrder = vi.mocked(recordMistakeOutcome).mock.invocationCallOrder[0];
    const saveOrder = vi.mocked(saveDeckProgress).mock.invocationCallOrder[0];
    expect(mistakeOrder).toBeGreaterThan(eventOrder);
    expect(saveOrder).toBeGreaterThan(mistakeOrder);
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', SUMMARY);
  });

  it('keeps the rating path working when recording the outcome fails', async () => {
    vi.mocked(recordMistakeOutcome).mockImplementationOnce(() => {
      throw new Error('mistake book exploded synchronously');
    });
    const sync = await rateQaAgain();
    expect(recordMistakeOutcome).toHaveBeenCalledTimes(1);
    expect(saveDeckProgress).toHaveBeenCalledTimes(1);
    expect(settleRatingReward).toHaveBeenCalledTimes(1);
    expect(sync.navigation.replace).toHaveBeenCalledWith('SessionSummary', SUMMARY);
    await act(async () => {
      sync.tree.unmount();
    });

    vi.clearAllMocks();
    resetSessionStore();
    featureFlagsMock.mockReturnValue(flags());
    vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute() as any);
    // The spy itself subscribes to every promise it returns (settledResults), so a plain rejected
    // promise would never surface as unhandled here. Hand back a thenable that records whether the
    // screen attached its own rejection handler.
    let rejectionHandled = false;
    vi.mocked(recordMistakeOutcome).mockImplementationOnce(() => {
      const rejection = Promise.reject(new Error('mistake book rejected'));
      const trackedRejection = {
        then: rejection.then.bind(rejection),
        catch: (onRejected: (reason: unknown) => unknown) => {
          rejectionHandled = true;
          return rejection.catch(onRejected);
        },
      };
      return trackedRejection as unknown as Promise<void>;
    });
    const rejected = await rateQaAgain();
    expect(recordMistakeOutcome).toHaveBeenCalledTimes(1);
    expect(saveDeckProgress).toHaveBeenCalledTimes(1);
    expect(settleRatingReward).toHaveBeenCalledTimes(1);
    expect(rejected.navigation.replace).toHaveBeenCalledWith('SessionSummary', SUMMARY);

    // Give Node a macrotask turn to report any unhandled rejection.
    await new Promise((resolve) => setImmediate(resolve));
    expect(rejectionHandled).toBe(true);
    expect(unhandled).toEqual([]);
  });

  it('passes the settled MCQ verdict for a multiple-choice card', async () => {
    serve(MCQ_CARD);
    const { tree, navigation } = await mount();

    await press(tree, 'mcq-show-options');
    await press(tree, 'mcq-option-a');
    await press(tree, 'mcq-submit-unsure');
    expect(recordMistakeOutcome).not.toHaveBeenCalled();
    await press(tree, 'mcq-next');

    expect(recordReviewEvent).toHaveBeenCalledWith(expect.objectContaining({ rating: 'again' }));
    expect(recordMistakeOutcome).toHaveBeenCalledTimes(1);
    expect(recordMistakeOutcome).toHaveBeenCalledWith({
      deckSlug: 'csharp',
      stableUid: MCQ_CARD.StableUid,
      topic: null,
      rating: 'again',
      mcqVerdict: 'wrong',
      at: FIXED_NOW_MS,
    });
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ picks: { landed: 0, answered: 1 } }));
  });
});
