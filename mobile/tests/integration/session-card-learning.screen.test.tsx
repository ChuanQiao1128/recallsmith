import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// R22 contract §1.3, §6 — a Q/A card is taught before it is tested. 2026-10-14 learning flow: the
// study view shows the question first ("Show answer", then "Got it"), and Got it commits the card
// (hard, due tomorrow); there is no recall check later in the same session.

// deckCache memoizes deck reads at module scope; clear it between tests (G30).
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
  // Same reading as the real isFsrsEnabled: FSRS unless the flags turn it off explicitly.
  isFsrsEnabled: () => featureFlagsMock()?.fsrs?.enabled !== false,
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
  // The real Mistake Book and study prefs read through these.
  getUserScopedKey: vi.fn(async (key: string) => `test:${key}`),
  loadAllProgress: vi.fn(async () => ({})),
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


// The real planner picks (pickNextCard / countDueToday) and the real rating helper run, so the
// learning step is exercised against the code that deals cards; only the route length is fixed.
vi.mock('../../src/features/gacha/planner/sessionPlanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/gacha/planner/sessionPlanner')>();
  return { ...actual, pickNextCard: vi.fn(actual.pickNextCard), planChallengeRoute: vi.fn() };
});

vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({
  resolveEffectiveOwned: vi.fn(async () => null),
}));

vi.mock('../../src/features/gacha/rewards/sessionRewards', () => ({
  settleRatingReward: vi.fn(async () => ({
    newCardPaid: false,
    dueClearPaid: false,
    pulls: 0,
    walletBefore: null,
    walletAfter: null,
    applied: null,
    newCardsLearnedToday: 0,
  })),
}));

// The real book, observed: the call contract and what lands in storage are both checked.
vi.mock('../../src/features/gacha/mistakes/mistakeBook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/gacha/mistakes/mistakeBook')>();
  return { ...actual, recordMistakeOutcome: vi.fn(actual.recordMistakeOutcome) };
});

// Observed, not run: the screen's haptic calls are what the tests read.
vi.mock('../../src/features/gacha/session/studyHaptics', () => ({
  studyHaptic: vi.fn(),
}));

vi.mock('../../src/content/cardSource', () => ({
  getCardSource: vi.fn(async () => ({ url: 'https://docs.aws.amazon.com/sqs/', quote: 'Queues decouple producers.' })),
  sourceHostLabel: vi.fn(() => 'docs.aws.amazon.com'),
}));

import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { loadDeckProgress, saveDeckProgress } from '../../src/review/storage';
import { recordReviewEvent } from '../../src/sync/progressSync';
import { pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { settleRatingReward } from '../../src/features/gacha/rewards/sessionRewards';
import { resetSessionStore, useSessionStore } from '../../src/features/gacha/session/sessionStore';
import { studyHaptic } from '../../src/features/gacha/session/studyHaptics';
import { MISTAKE_BOOK_KEY, recordMistakeOutcome, withMistakeBookLock } from '../../src/features/gacha/mistakes/mistakeBook';
import { getCardSource } from '../../src/content/cardSource';
import { STUDY_PREFS_KEY } from '../../src/features/gacha/study/studyPrefs';

const FIXED_NOW_MS = Date.UTC(2026, 8, 27, 9, 0, 0);
const DAY_MS = 86_400_000;
const MISTAKES_STORAGE_KEY = `test:${MISTAKE_BOOK_KEY}`;

function flags(overrides: { mcq?: Record<string, unknown>; cardSource?: boolean; cardReport?: boolean } = {}) {
  return {
    mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false, ...(overrides.mcq ?? {}) },
    paywall: { hidden: false },
    ceremony: { seamOfLight: true, forceFallback: false },
    cardSource: { enabled: overrides.cardSource ?? true },
    cardReport: { enabled: overrides.cardReport ?? false },
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');

function pressables(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

function texts(tree: renderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => node.props.children)
    .flat()
    .filter((child: unknown): child is string => typeof child === 'string');
}

async function press(tree: renderer.ReactTestRenderer, label: string) {
  const [target] = pressables(tree, label);
  if (!target) throw new Error(`no pressable labelled ${label}; texts: ${texts(tree).join(' | ')}`);
  await act(async () => {
    target.props.onPress();
    await Promise.resolve();
  });
  await flush();
}

const NEW_A = { StableUid: 'new-a', OrderInDeck: 1, Difficulty: 1, Question: 'What is a queue?', Explanation: 'A buffer between producer and consumer.', Topic: 'sqs' };
const NEW_B = { StableUid: 'new-b', OrderInDeck: 2, Difficulty: 1, Question: 'What is a topic?', Explanation: 'A fan-out channel.', Topic: 'sns' };
const LEARNED = { StableUid: 'old-c', OrderInDeck: 3, Difficulty: 1, Question: 'What is a stream?', Explanation: 'An ordered log of records.', Topic: 'kinesis' };
const MCQ_CARD = {
  StableUid: 'mcq-d',
  Revision: 1,
  Question: 'Which service buffers orders with the LEAST operational overhead?',
  Explanation: 'SQS buffers a burst.',
  Difficulty: 2,
  OrderInDeck: 4,
  Mcq: {
    v: 1,
    options: [
      { key: 'a', why: 'No buffer.', text: 'A bigger instance.', correct: false },
      { key: 'b', why: null, text: 'An SQS standard queue.', correct: true },
      { key: 'c', why: 'Caps ingest.', text: 'A one-shard stream.', correct: false },
      { key: 'd', why: 'Polling is not a queue.', text: 'A table polled by workers.', correct: false },
    ],
    shuffle: true,
    qualifier: 'LEAST operational overhead',
  },
};

const fresh = (uid: string) => ({ stableUid: uid, stage: 0, nextReviewAt: 0 });
const learnedDue = (uid: string) => ({ stableUid: uid, stage: 2, lastReviewedAt: FIXED_NOW_MS - 3 * DAY_MS, nextReviewAt: FIXED_NOW_MS - DAY_MS });

const LEARNED_2 = { StableUid: 'old-e', OrderInDeck: 5, Difficulty: 1, Question: 'What is a shard?', Explanation: 'A slice of a stream.', Topic: 'kinesis' };
// The aws-saa-fundamentals answer shape (B3): 答：/因为：/考法：.
const KEY_LINE = '答：一整片连续的 IP 地址。';
const KEYED = {
  StableUid: 'awsf-cidr',
  OrderInDeck: 0,
  Difficulty: 1,
  Question: 'IP 段（CIDR）是什么？',
  Explanation: `${KEY_LINE}\n因为：10.0.0.0/16 约有 6.5 万个地址。\n考法：比较 /16 和 /24 → ✅ /24 范围更小`,
  Topic: 'vpc',
};

type RouteNode = { id: string; role: string; title: string; subtitle: string };

function serve(cards: any[], progress: any[], limit: number, nodes?: RouteNode[]) {
  vi.mocked(resolveDeckBySlug).mockResolvedValue({
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: cards.length,
    Cards: cards,
  } as any);
  vi.mocked(loadDeckProgress).mockResolvedValue(progress as any);
  vi.mocked(planChallengeRoute).mockReturnValue({
    slug: 'csharp',
    deckTitle: 'C# Interview',
    mode: 'mixed',
    limit,
    minimumGoal: 1,
    dueCount: 0,
    newCount: limit,
    nodes: nodes ?? Array.from({ length: limit }, (_, i) => ({ id: `n-${i}`, role: 'core', title: `Node ${i}`, subtitle: '' })),
    summary: 'C# Interview',
  } as any);
}

async function mount(mode = 'mixed') {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <SessionCardScreen navigation={navigation} route={{ key: 'session-card', name: 'SessionCard', params: { slug: 'csharp', mode } } as any} />,
    );
  });
  await flush();
  await flush();
  return { tree, navigation };
}

function questionShown(tree: renderer.ReactTestRenderer): string | null {
  const study = byTestID(tree, 'learning-study-question');
  if (study.length > 0) return study[0].props.children;
  const review = byTestID(tree, 'review-question');
  return review.length > 0 ? review[0].props.children : null;
}

function subtitle(tree: renderer.ReactTestRenderer): string | undefined {
  return texts(tree).find((t) => /^Card \d+ of \d+$/.test(t));
}

// The study view, one card: Show answer, then Got it.
async function study(tree: renderer.ReactTestRenderer) {
  await press(tree, 'Show answer');
  await press(tree, 'Got it');
}

function studyHint(tree: renderer.ReactTestRenderer): string | undefined {
  return byTestID(tree, 'learning-study-hint')[0]?.props.children;
}

async function storedMistakes(): Promise<Record<string, unknown>> {
  await withMistakeBookLock(async () => undefined);
  const raw = store.get(MISTAKES_STORAGE_KEY);
  return raw ? JSON.parse(raw).entries : {};
}

describe('SessionCardScreen learning step (R22 §6: teach before testing; 2026-10-14 learning flow)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    // A new learner on the two-button default, stored so the first read does not probe.
    store.set(STUDY_PREFS_KEY, JSON.stringify({ fourButtons: false }));
    resetSessionStore();
    featureFlagsMock.mockReturnValue(flags());
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

  it('opens a never-reviewed Q/A card on the study view with the question alone and Show answer', async () => {
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree } = await mount();

    expect(byTestID(tree, 'learning-study-view')).toHaveLength(1);
    expect(texts(tree)).toContain('NEW CARD');
    expect(questionShown(tree)).toBe('What is a queue?');
    // Question first: no answer, no source yet.
    expect(texts(tree)).not.toContain('A buffer between producer and consumer.');
    expect(byTestID(tree, 'learning-study-answer')).toHaveLength(0);
    expect(byTestID(tree, 'learning-study-source')).toHaveLength(0);
    expect(studyHint(tree)).toBe('Think of your answer, then show it.');
    // One action, Show answer; Got it is not offered before the answer is seen, and no rating buttons.
    const show = byTestID(tree, 'learning-study-show-answer');
    expect(show).toHaveLength(1);
    expect(show[0].props.accessibilityRole).toBe('button');
    expect(pressables(tree, 'Show answer')).toHaveLength(1);
    expect(pressables(tree, 'Got it')).toHaveLength(0);
    expect(byTestID(tree, 'learning-study-got-it')).toHaveLength(0);
    expect(pressables(tree, 'Reveal answer')).toHaveLength(0);
    expect(pressables(tree, 'Forgot')).toHaveLength(0);
    expect(pressables(tree, 'Remembered')).toHaveLength(0);
    // The source is read on mount, ready for the reveal.
    expect(getCardSource).toHaveBeenCalledWith('csharp', 'new-a');
  });

  it('Show answer opens the answer and the source, fires the reveal haptic, swaps in Got it and writes nothing', async () => {
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree, navigation } = await mount();

    await press(tree, 'Show answer');

    expect(studyHaptic).toHaveBeenCalledTimes(1);
    expect(studyHaptic).toHaveBeenCalledWith('reveal');
    expect(questionShown(tree)).toBe('What is a queue?');
    expect(texts(tree)).toContain('A buffer between producer and consumer.');
    expect(byTestID(tree, 'learning-study-source-host')[0].props.children).toBe('docs.aws.amazon.com');
    expect(byTestID(tree, 'learning-study-source-quote')[0].props.children).toBe('Queues decouple producers.');
    expect(studyHint(tree)).toBe('Read it once. It comes back tomorrow.');
    expect(pressables(tree, 'Show answer')).toHaveLength(0);
    const gotIt = byTestID(tree, 'learning-study-got-it');
    expect(gotIt).toHaveLength(1);
    expect(gotIt[0].props.accessibilityRole).toBe('button');
    // Revealing is not a rating.
    expect(recordReviewEvent).not.toHaveBeenCalled();
    expect(saveDeckProgress).not.toHaveBeenCalled();
    expect(settleRatingReward).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('shows no source with the cardSource flag off', async () => {
    featureFlagsMock.mockReturnValue(flags({ cardSource: false }));
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree } = await mount();
    await press(tree, 'Show answer');

    expect(byTestID(tree, 'learning-study-view')).toHaveLength(1);
    expect(texts(tree)).toContain('A buffer between producer and consumer.');
    expect(getCardSource).not.toHaveBeenCalled();
    expect(byTestID(tree, 'learning-study-source')).toHaveLength(0);
  });

  it('never shows the Report button on the study view, even after Show answer', async () => {
    featureFlagsMock.mockReturnValue(flags({ cardReport: true }));
    serve([NEW_A, LEARNED], [fresh('new-a'), learnedDue('old-c')], 2);
    const { tree } = await mount('mixed');
    // The learned card first: its review shows Report once revealed.
    await press(tree, 'Reveal answer');
    expect(byTestID(tree, 'session-card-report')).toHaveLength(1);
    await press(tree, 'Remembered');

    expect(byTestID(tree, 'learning-study-view')).toHaveLength(1);
    expect(byTestID(tree, 'session-card-report')).toHaveLength(0);
    await press(tree, 'Show answer');
    expect(texts(tree)).toContain('A buffer between producer and consumer.');
    expect(byTestID(tree, 'session-card-report')).toHaveLength(0);
  });

  it('Got it commits hard, due in one day, as learning_study: reward, streak, saved progress, no mistake', async () => {
    vi.mocked(settleRatingReward).mockResolvedValueOnce({
      newCardPaid: true,
      dueClearPaid: false,
      pulls: 1,
      walletBefore: { availablePulls: 0, reservePulls: 0 },
      walletAfter: { availablePulls: 1, reservePulls: 0 },
      applied: null,
      newCardsLearnedToday: 1,
    } as any);
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree, navigation } = await mount();
    expect(subtitle(tree)).toBe('Card 1 of 1');

    await study(tree);

    // The light rating haptic, after the reveal tick.
    expect(vi.mocked(studyHaptic).mock.calls.map((call) => call[0])).toEqual(['reveal', 'rate']);
    expect(recordReviewEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(recordReviewEvent).mock.calls[0][0] as any;
    expect(event).toEqual(
      expect.objectContaining({ deckSlug: 'csharp', stableUid: 'new-a', rating: 'hard', reviewStage: 'learning_study', reviewedAtMs: FIXED_NOW_MS }),
    );
    expect(event.sessionId).toEqual(expect.any(String));
    expect(event.progressAfter).toEqual(
      expect.objectContaining({ stage: 0, lastReviewedAt: FIXED_NOW_MS, nextReviewAt: FIXED_NOW_MS + DAY_MS }),
    );
    // FSRS initState(hard), the learning-check schedule.
    expect(event.progressAfter.fsrsStability).toBeCloseTo(1.1839, 4);
    const saved = vi.mocked(saveDeckProgress).mock.calls.at(-1)?.[1] as any[];
    expect(saved.find((p) => p.stableUid === 'new-a')).toEqual(
      expect.objectContaining({ stage: 0, lastReviewedAt: FIXED_NOW_MS, nextReviewAt: FIXED_NOW_MS + DAY_MS }),
    );
    // The new-card reward is settled at Got it, from the progress before it.
    expect(settleRatingReward).toHaveBeenCalledTimes(1);
    expect(settleRatingReward).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'csharp', stableUid: 'new-a', rating: 'hard', newCardEligible: true, progressBefore: [fresh('new-a')] }),
    );
    // The streak counts it.
    expect(useSessionStore.getState().sessionRatings).toEqual([{ stableUid: 'new-a', rating: 'hard' }]);
    expect(useSessionStore.getState().streakEarned).toBe(true);
    // Mistakes start once a card is learned: the book is told it is the study, and stays empty.
    expect(recordMistakeOutcome).toHaveBeenCalledTimes(1);
    expect(recordMistakeOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ stableUid: 'new-a', rating: 'hard', learningCheck: true }),
    );
    expect(await storedMistakes()).toEqual({});
    // The one-card run is over: straight to the summary, with the reward it paid.
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith(
      'SessionSummary',
      expect.objectContaining({
        sessionId: expect.any(String),
        sessionDone: 1,
        sessionLimit: 1,
        streakEarned: true,
        reward: expect.objectContaining({ newCardPulls: 1, newCardUids: ['new-a'] }),
      }),
    );
  });

  it('runs a two-card learn-new run as two studies and ends with no recall check', async () => {
    serve([NEW_A, NEW_B], [fresh('new-a'), fresh('new-b')], 2);
    const { tree, navigation } = await mount('learn-new');

    expect(questionShown(tree)).toBe('What is a queue?');
    expect(subtitle(tree)).toBe('Card 1 of 2');
    await study(tree);

    // The next new card, back on the question alone: the reveal does not carry over.
    expect(byTestID(tree, 'learning-study-view')).toHaveLength(1);
    expect(questionShown(tree)).toBe('What is a topic?');
    expect(subtitle(tree)).toBe('Card 2 of 2');
    expect(texts(tree)).not.toContain('A fan-out channel.');
    expect(pressables(tree, 'Show answer')).toHaveLength(1);
    expect(pressables(tree, 'Got it')).toHaveLength(0);
    expect(studyHint(tree)).toBe('Think of your answer, then show it.');
    expect(navigation.replace).not.toHaveBeenCalled();
    await study(tree);

    // No card comes back: the run ends on its planned slots.
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ sessionDone: 2, sessionLimit: 2 }));
    expect(vi.mocked(recordReviewEvent).mock.calls.map((call) => [(call[0] as any).stableUid, (call[0] as any).reviewStage, (call[0] as any).rating])).toEqual([
      ['new-a', 'learning_study', 'hard'],
      ['new-b', 'learning_study', 'hard'],
    ]);
    expect(vi.mocked(settleRatingReward).mock.calls.map((call) => [(call[0] as any).stableUid, (call[0] as any).rating])).toEqual([
      ['new-a', 'hard'],
      ['new-b', 'hard'],
    ]);
    // The planner deals without an exclusion list: a studied card is simply not due today.
    for (const call of vi.mocked(pickNextCard).mock.calls) expect(call[0]).not.toHaveProperty('excludeUids');
  });

  it('deals no recall check even when the planner has slots left over', async () => {
    // The route plans 3 slots but the deck has 2 new cards: once both are studied nothing is due,
    // so the run ends early instead of re-asking them.
    serve([NEW_A, NEW_B], [fresh('new-a'), fresh('new-b')], 3);
    const { tree, navigation } = await mount('learn-new');
    expect(subtitle(tree)).toBe('Card 1 of 3');
    await study(tree);
    await study(tree);

    expect(pressables(tree, 'Reveal answer')).toHaveLength(0);
    expect(recordReviewEvent).toHaveBeenCalledTimes(2);
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ sessionDone: 2, sessionLimit: 3 }));
  });

  it('keeps the study view on Show answer / Got it with four rating buttons on, and Got it still sends hard', async () => {
    store.set(STUDY_PREFS_KEY, JSON.stringify({ fourButtons: true }));
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree } = await mount();

    for (const title of ['Again', 'Hard', 'Good', 'Easy', 'Forgot', 'Remembered']) expect(pressables(tree, title)).toHaveLength(0);
    await press(tree, 'Show answer');
    for (const title of ['Again', 'Hard', 'Good', 'Easy', 'Forgot', 'Remembered']) expect(pressables(tree, title)).toHaveLength(0);
    await press(tree, 'Got it');
    expect(vi.mocked(recordReviewEvent).mock.calls[0][0]).toEqual(
      expect.objectContaining({ rating: 'hard', reviewStage: 'learning_study' }),
    );
  });

  it('leaves a learned Q/A card as it was: reveal, rate, repeat_review, and a Forgot is a mistake', async () => {
    serve([LEARNED], [learnedDue('old-c')], 1);
    const { tree, navigation } = await mount('review-due');

    expect(byTestID(tree, 'learning-study-view')).toHaveLength(0);
    expect(pressables(tree, 'Got it')).toHaveLength(0);
    expect(pressables(tree, 'Show answer')).toHaveLength(0);
    expect(pressables(tree, 'Reveal answer')).toHaveLength(1);
    await press(tree, 'Reveal answer');
    await press(tree, 'Forgot');

    expect(recordReviewEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordReviewEvent).mock.calls[0][0]).toEqual(
      expect.objectContaining({ stableUid: 'old-c', rating: 'again', reviewStage: 'repeat_review' }),
    );
    expect(recordMistakeOutcome).toHaveBeenCalledWith(expect.not.objectContaining({ learningCheck: true }));
    expect(Object.keys(await storedMistakes())).toEqual(['csharp::old-c']);
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ sessionDone: 1, sessionLimit: 1 }));
  });

  it('keeps Remembered as good on a learned card', async () => {
    serve([LEARNED], [learnedDue('old-c')], 1);
    const { tree } = await mount('review-due');
    await press(tree, 'Reveal answer');
    await press(tree, 'Remembered');

    expect(vi.mocked(recordReviewEvent).mock.calls[0][0]).toEqual(
      expect.objectContaining({ rating: 'good', reviewStage: 'repeat_review' }),
    );
  });

  it('leaves a new MCQ card as it was: no study view, the MCQ flow, first_review', async () => {
    serve([MCQ_CARD], [fresh('mcq-d')], 1);
    const { tree, navigation } = await mount();

    expect(byTestID(tree, 'learning-study-view')).toHaveLength(0);
    // (The one-time MCQ coach line has a "Got it" of its own; the study dock's is absent.)
    expect(byTestID(tree, 'learning-study-got-it')).toHaveLength(0);
    expect(byTestID(tree, 'learning-study-show-answer')).toHaveLength(0);
    expect(byTestID(tree, 'mcq-show-options')).toHaveLength(1);
    await act(async () => {
      byTestID(tree, 'mcq-show-options')[0].props.onPress();
    });
    await flush();
    await act(async () => {
      byTestID(tree, 'mcq-dont-know')[0].props.onPress();
    });
    await flush();
    await act(async () => {
      byTestID(tree, 'mcq-next')[0].props.onPress();
    });
    await flush();

    expect(recordReviewEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordReviewEvent).mock.calls[0][0]).toEqual(
      expect.objectContaining({ stableUid: 'mcq-d', rating: 'again', reviewStage: 'first_review' }),
    );
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ sessionDone: 1, sessionLimit: 1 }));
  });

  it('runs a mixed session: learned card rated directly, new card studied, and the run ends there', async () => {
    serve([NEW_A, LEARNED], [fresh('new-a'), learnedDue('old-c')], 2);
    const { tree, navigation } = await mount('mixed');
    const order: string[] = [];
    for (let step = 0; step < 2; step += 1) {
      const isStudy = byTestID(tree, 'learning-study-view').length > 0;
      order.push(`${isStudy ? 'study' : 'rate'}:${questionShown(tree)}:${subtitle(tree)}`);
      if (isStudy) {
        await study(tree);
      } else {
        await press(tree, 'Reveal answer');
        await press(tree, 'Remembered');
      }
    }

    expect(order).toEqual(['rate:What is a stream?:Card 1 of 2', 'study:What is a queue?:Card 2 of 2']);
    expect(vi.mocked(recordReviewEvent).mock.calls.map((call) => [(call[0] as any).stableUid, (call[0] as any).reviewStage])).toEqual([
      ['old-c', 'repeat_review'],
      ['new-a', 'learning_study'],
    ]);
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ sessionDone: 2, sessionLimit: 2 }));
  });

  // The route's role badge is a test's badge: the study view carries none, and a study uses one
  // planner slot like any card, so the badges stay on their planned cards.
  it('keeps the route role badges on their planned cards and none on the study view', async () => {
    serve(
      [NEW_A, LEARNED, LEARNED_2],
      [fresh('new-a'), learnedDue('old-c'), learnedDue('old-e')],
      3,
      [
        { id: 'warmup-0', role: 'warmup', title: '', subtitle: '' },
        { id: 'elite-1', role: 'elite', title: 'Harder recall', subtitle: '' },
        { id: 'boss-2', role: 'boss', title: 'Final check', subtitle: '' },
      ],
    );
    const { tree, navigation } = await mount('mixed');
    const steps: string[] = [];
    const badge = () => texts(tree).find((t) => t === 'Harder recall' || t === 'Final check') ?? '-';
    for (let step = 0; step < 3; step += 1) {
      const isStudy = byTestID(tree, 'learning-study-view').length > 0;
      steps.push(`${isStudy ? 'study' : 'rate'}:${questionShown(tree)}:${badge()}`);
      if (isStudy) {
        await press(tree, 'Show answer');
        // Still none once the answer is open.
        expect(badge()).toBe('-');
        await press(tree, 'Got it');
      } else {
        await press(tree, 'Reveal answer');
        await press(tree, 'Remembered');
      }
    }

    expect(steps).toEqual([
      'rate:What is a stream?:-',
      'rate:What is a shard?:Harder recall',
      'study:What is a queue?:-',
    ]);
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ sessionDone: 3, sessionLimit: 3 }));
  });

  // B3: the rating hint names the highlighted 答 line only when the card has one.
  it('points the rating hint at the highlighted 答 line on a key-line card, and only there', async () => {
    serve([KEYED, LEARNED], [learnedDue('awsf-cidr'), learnedDue('old-c')], 2);
    const { tree } = await mount('review-due');
    const hint = () => byTestID(tree, 'review-rating-hint')[0]?.props.children;

    expect(questionShown(tree)).toBe('IP 段（CIDR）是什么？');
    expect(hint()).toBe('Try to recall the answer, then reveal it.');
    await press(tree, 'Reveal answer');
    expect(byTestID(tree, 'answer-key-line')).toHaveLength(1);
    expect(hint()).toBe('Did you get the highlighted line?');
    await press(tree, 'Remembered');

    expect(questionShown(tree)).toBe('What is a stream?');
    await press(tree, 'Reveal answer');
    expect(byTestID(tree, 'answer-key-line')).toHaveLength(0);
    expect(hint()).toBe('Did you remember it?');
  });

  it('asks how well the highlighted line went with four rating buttons on', async () => {
    store.set(STUDY_PREFS_KEY, JSON.stringify({ fourButtons: true }));
    serve([KEYED], [learnedDue('awsf-cidr')], 1);
    const { tree } = await mount('review-due');
    await press(tree, 'Reveal answer');
    expect(byTestID(tree, 'review-rating-hint')[0].props.children).toBe('How well did you get the highlighted line?');
  });

  it('highlights the 答 line on the study view once the answer is open', async () => {
    serve([KEYED], [fresh('awsf-cidr')], 1);
    const { tree } = await mount();
    expect(byTestID(tree, 'answer-key-line')).toHaveLength(0);
    await press(tree, 'Show answer');
    expect(byTestID(tree, 'answer-key-line')).toHaveLength(1);
    expect(texts(tree)).toContain(KEY_LINE);
    // The study dock keeps its own hint: there is nothing to rate yet.
    expect(studyHint(tree)).toBe('Read it once. It comes back tomorrow.');
  });
});
