import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// R22 contract §1.3, §6 — a Q/A card is taught before it is tested.

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
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { MISTAKE_BOOK_KEY, recordMistakeOutcome, withMistakeBookLock } from '../../src/features/gacha/mistakes/mistakeBook';
import { getCardSource } from '../../src/content/cardSource';
import { STUDY_PREFS_KEY } from '../../src/features/gacha/study/studyPrefs';

const FIXED_NOW_MS = Date.UTC(2026, 8, 27, 9, 0, 0);
const DAY_MS = 86_400_000;
const MISTAKES_STORAGE_KEY = `test:${MISTAKE_BOOK_KEY}`;

function flags(overrides: { mcq?: Record<string, unknown>; cardSource?: boolean } = {}) {
  return {
    mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false, ...(overrides.mcq ?? {}) },
    paywall: { hidden: false },
    ceremony: { seamOfLight: true, forceFallback: false },
    cardSource: { enabled: overrides.cardSource ?? true },
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

function serve(cards: any[], progress: any[], limit: number) {
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
    nodes: Array.from({ length: limit }, (_, i) => ({ id: `n-${i}`, role: 'core', title: `Node ${i}`, subtitle: '' })),
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

async function storedMistakes(): Promise<Record<string, unknown>> {
  await withMistakeBookLock(async () => undefined);
  const raw = store.get(MISTAKES_STORAGE_KEY);
  return raw ? JSON.parse(raw).entries : {};
}

describe('SessionCardScreen learning step (R22 §6: teach before testing)', () => {
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

  it('opens a never-reviewed Q/A card on the study view: question, answer, source, one Got it', async () => {
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree } = await mount();

    expect(byTestID(tree, 'learning-study-view')).toHaveLength(1);
    expect(questionShown(tree)).toBe('What is a queue?');
    // The answer is shown up front, no reveal step.
    expect(texts(tree)).toContain('A buffer between producer and consumer.');
    expect(pressables(tree, 'Reveal answer')).toHaveLength(0);
    // One action and no rating buttons.
    expect(pressables(tree, 'Got it')).toHaveLength(1);
    expect(pressables(tree, 'Forgot')).toHaveLength(0);
    expect(pressables(tree, 'Remembered')).toHaveLength(0);
    // The card's source, with the cardSource flag on.
    expect(getCardSource).toHaveBeenCalledWith('csharp', 'new-a');
    expect(byTestID(tree, 'learning-study-source-host')[0].props.children).toBe('docs.aws.amazon.com');
    expect(byTestID(tree, 'learning-study-source-quote')[0].props.children).toBe('Queues decouple producers.');
  });

  it('shows no source with the cardSource flag off', async () => {
    featureFlagsMock.mockReturnValue(flags({ cardSource: false }));
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree } = await mount();

    expect(byTestID(tree, 'learning-study-view')).toHaveLength(1);
    expect(getCardSource).not.toHaveBeenCalled();
    expect(byTestID(tree, 'learning-study-source')).toHaveLength(0);
  });

  it('Got it sends no rating, no event, no mistake and no reward, and re-queues the card as a check', async () => {
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree, navigation } = await mount();
    expect(subtitle(tree)).toBe('Card 1 of 1');

    await press(tree, 'Got it');

    expect(recordReviewEvent).not.toHaveBeenCalled();
    expect(recordMistakeOutcome).not.toHaveBeenCalled();
    expect(saveDeckProgress).not.toHaveBeenCalled();
    expect(settleRatingReward).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    // The recall check: the same card, question first, with its own slot in the count.
    expect(byTestID(tree, 'learning-study-view')).toHaveLength(0);
    expect(questionShown(tree)).toBe('What is a queue?');
    expect(pressables(tree, 'Reveal answer')).toHaveLength(1);
    expect(subtitle(tree)).toBe('Card 2 of 2');
  });

  it('deals the checks at the end of the run, in study order, and counts them in the run', async () => {
    serve([NEW_A, NEW_B], [fresh('new-a'), fresh('new-b')], 2);
    const { tree, navigation } = await mount('learn-new');
    const seen: string[] = [];

    expect(questionShown(tree)).toBe('What is a queue?');
    expect(subtitle(tree)).toBe('Card 1 of 2');
    await press(tree, 'Got it');
    // The planner deals the next new card, never the one just studied.
    expect(byTestID(tree, 'learning-study-view')).toHaveLength(1);
    expect(questionShown(tree)).toBe('What is a topic?');
    expect(pickNextCard).toHaveBeenLastCalledWith(
      expect.objectContaining({ excludeUids: new Set(['new-a']) }),
    );
    expect(subtitle(tree)).toBe('Card 2 of 3');
    await press(tree, 'Got it');
    expect(subtitle(tree)).toBe('Card 3 of 4');

    for (const answer of ['Remembered', 'Forgot']) {
      seen.push(questionShown(tree) ?? '');
      expect(byTestID(tree, 'learning-study-view')).toHaveLength(0);
      await press(tree, 'Reveal answer');
      await press(tree, answer);
    }

    expect(seen).toEqual(['What is a queue?', 'What is a topic?']);
    expect(navigation.replace).toHaveBeenCalledWith(
      'SessionSummary',
      expect.objectContaining({ sessionDone: 4, sessionLimit: 4 }),
    );
  });

  it('sends one card_reviewed per check with reviewStage learning_check: Remembered → hard (1 day), Forgot → again (10 min)', async () => {
    serve([NEW_A, NEW_B], [fresh('new-a'), fresh('new-b')], 2);
    const { tree } = await mount('learn-new');
    await press(tree, 'Got it');
    await press(tree, 'Got it');
    await press(tree, 'Reveal answer');
    await press(tree, 'Remembered');
    await press(tree, 'Reveal answer');
    await press(tree, 'Forgot');

    expect(recordReviewEvent).toHaveBeenCalledTimes(2);
    const [passed, failed] = vi.mocked(recordReviewEvent).mock.calls.map((call) => call[0] as any);
    expect(passed).toEqual(
      expect.objectContaining({ stableUid: 'new-a', rating: 'hard', reviewStage: 'learning_check' }),
    );
    expect(passed.progressAfter).toEqual(
      expect.objectContaining({ stage: 0, lastReviewedAt: FIXED_NOW_MS, nextReviewAt: FIXED_NOW_MS + DAY_MS }),
    );
    expect(failed).toEqual(
      expect.objectContaining({ stableUid: 'new-b', rating: 'again', reviewStage: 'learning_check' }),
    );
    expect(failed.progressAfter).toEqual(
      expect.objectContaining({ stage: 0, lastReviewedAt: FIXED_NOW_MS, nextReviewAt: FIXED_NOW_MS + 10 * 60 * 1000 }),
    );
    // The rating reward and the saved progress follow the mapped rating.
    expect(vi.mocked(settleRatingReward).mock.calls.map((call) => (call[0] as any).rating)).toEqual(['hard', 'again']);
    const saved = vi.mocked(saveDeckProgress).mock.calls.at(-1)?.[1] as any[];
    expect(saved.find((p) => p.stableUid === 'new-a')).toEqual(expect.objectContaining({ stage: 0, nextReviewAt: FIXED_NOW_MS + DAY_MS }));
  });

  it('records no Mistake Book entry when the recall check fails', async () => {
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree, navigation } = await mount();
    await press(tree, 'Got it');
    await press(tree, 'Reveal answer');
    await press(tree, 'Forgot');

    expect(recordMistakeOutcome).toHaveBeenCalledTimes(1);
    expect(recordMistakeOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ stableUid: 'new-a', rating: 'again', learningCheck: true }),
    );
    expect(await storedMistakes()).toEqual({});
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ sessionDone: 2, sessionLimit: 2 }));
  });

  it('asks the check with Forgot / Remembered even when four rating buttons are on', async () => {
    store.set(STUDY_PREFS_KEY, JSON.stringify({ fourButtons: true }));
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree } = await mount();
    await press(tree, 'Got it');
    await press(tree, 'Reveal answer');

    expect(pressables(tree, 'Forgot')).toHaveLength(1);
    expect(pressables(tree, 'Remembered')).toHaveLength(1);
    expect(pressables(tree, 'Hard')).toHaveLength(0);
    await press(tree, 'Remembered');
    expect(vi.mocked(recordReviewEvent).mock.calls[0][0]).toEqual(
      expect.objectContaining({ rating: 'hard', reviewStage: 'learning_check' }),
    );
  });

  it('leaves a learned Q/A card as it was: reveal, rate, repeat_review, and a Forgot is a mistake', async () => {
    serve([LEARNED], [learnedDue('old-c')], 1);
    const { tree, navigation } = await mount('review-due');

    expect(byTestID(tree, 'learning-study-view')).toHaveLength(0);
    expect(pressables(tree, 'Got it')).toHaveLength(0);
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
    // No check slot: the run ends after the one card.
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ sessionDone: 1, sessionLimit: 1 }));
  });

  it('runs a mixed session: learned card rated directly, new card studied, its check last', async () => {
    serve([NEW_A, LEARNED], [fresh('new-a'), learnedDue('old-c')], 2);
    const { tree, navigation } = await mount('mixed');
    const order: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      const study = byTestID(tree, 'learning-study-view').length > 0;
      order.push(`${study ? 'study' : 'rate'}:${questionShown(tree)}`);
      if (study) {
        await press(tree, 'Got it');
      } else {
        await press(tree, 'Reveal answer');
        await press(tree, 'Remembered');
      }
    }

    expect(order).toEqual(['rate:What is a stream?', 'study:What is a queue?', 'rate:What is a queue?']);
    expect(vi.mocked(recordReviewEvent).mock.calls.map((call) => [(call[0] as any).stableUid, (call[0] as any).reviewStage])).toEqual([
      ['old-c', 'repeat_review'],
      ['new-a', 'learning_check'],
    ]);
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ sessionDone: 3, sessionLimit: 3 }));
  });
});
