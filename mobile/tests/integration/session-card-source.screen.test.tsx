import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// U3 (user-perspective review 2026-10-04): the card's source on the review screens — the MCQ
// verdict, right or wrong, and the Q/A answer after reveal — read from the installed deck (offline),
// opened through Linking with http/https only. Harness copied from session-card-learning.

// deckCache memoizes deck reads at module scope; clear it between tests (G30).
beforeEach(() => {
  invalidateDeckCache();
});

const announceMock = vi.hoisted(() => vi.fn());
const openURLMock = vi.hoisted(() => vi.fn(async (_url: string) => undefined));

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
    Linking: { openURL: (url: string) => openURLMock(url) },
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


vi.mock('../../src/content/cardSource', () => ({
  getCardSource: vi.fn(async () => ({ url: 'https://docs.aws.amazon.com/sqs/', quote: 'Queues decouple producers.' })),
  sourceHostLabel: vi.fn(() => 'docs.aws.amazon.com'),
}));

import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { loadDeckProgress } from '../../src/review/storage';
import { planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { getCardSource } from '../../src/content/cardSource';
import { STUDY_PREFS_KEY } from '../../src/features/gacha/study/studyPrefs';

const FIXED_NOW_MS = Date.UTC(2026, 9, 4, 9, 0, 0);
const DAY_MS = 86_400_000;

function flags(overrides: { cardSource?: boolean } = {}) {
  return {
    mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false },
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

async function pressTestID(tree: renderer.ReactTestRenderer, id: string) {
  const [target] = byTestID(tree, id);
  if (!target) throw new Error(`no node ${id}`);
  await act(async () => {
    target.props.onPress();
    await Promise.resolve();
  });
  await flush();
}

async function pressLabel(tree: renderer.ReactTestRenderer, label: string) {
  const [target] = tree.root.findAll(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
  if (!target) throw new Error(`no pressable labelled ${label}`);
  await act(async () => {
    target.props.onPress();
    await Promise.resolve();
  });
  await flush();
}

const sourceText = (tree: renderer.ReactTestRenderer) =>
  byTestID(tree, 'session-card-source-text').map((node) => node.props.children);

const NEW_A = { StableUid: 'new-a', OrderInDeck: 1, Difficulty: 1, Question: 'What is a queue?', Explanation: 'A buffer between producer and consumer.', Topic: 'sqs' };
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
    Slug: 'aws-saa-c03',
    Title: 'AWS Associate Architect',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: cards.length,
    Cards: cards,
  } as any);
  vi.mocked(loadDeckProgress).mockResolvedValue(progress as any);
  vi.mocked(planChallengeRoute).mockReturnValue({
    slug: 'aws-saa-c03',
    deckTitle: 'AWS Associate Architect',
    mode: 'mixed',
    limit,
    minimumGoal: 1,
    dueCount: 0,
    newCount: limit,
    nodes: Array.from({ length: limit }, (_, i) => ({ id: `n-${i}`, role: 'core', title: `Node ${i}`, subtitle: '' })),
    summary: 'AWS',
  } as any);
}

async function mount(mode = 'mixed') {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <SessionCardScreen navigation={navigation} route={{ key: 'session-card', name: 'SessionCard', params: { slug: 'aws-saa-c03', mode } } as any} />,
    );
  });
  await flush();
  await flush();
  return { tree, navigation };
}

// The MCQ option rows are dealt in a shuffled order; pick by key.
async function answerMcq(tree: renderer.ReactTestRenderer, key: string) {
  await pressTestID(tree, 'mcq-show-options');
  await pressTestID(tree, `mcq-option-${key}`);
  await pressTestID(tree, 'mcq-submit-sure');
}

describe('SessionCardScreen source line (U3)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    store.set(STUDY_PREFS_KEY, JSON.stringify({ fourButtons: false }));
    resetSessionStore();
    featureFlagsMock.mockReturnValue(flags());
    vi.mocked(getCardSource).mockResolvedValue({ url: 'https://docs.aws.amazon.com/sqs/', quote: 'Queues decouple producers.' });
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

  it('shows the source under a wrong MCQ verdict, and not before the verdict', async () => {
    serve([MCQ_CARD], [learnedDue('mcq-d')], 1);
    const { tree } = await mount('review-due');

    expect(byTestID(tree, 'mcq-show-options')).toHaveLength(1);
    expect(byTestID(tree, 'session-card-source')).toHaveLength(0);
    await pressTestID(tree, 'mcq-show-options');
    expect(byTestID(tree, 'session-card-source')).toHaveLength(0);
    await pressTestID(tree, 'mcq-option-a');
    await pressTestID(tree, 'mcq-submit-sure');

    expect(byTestID(tree, 'mcq-verdict-banner')).toHaveLength(1);
    expect(byTestID(tree, 'mcq-row-glyph-a')[0]?.props.children).toBe('✗');
    expect(getCardSource).toHaveBeenCalledWith('aws-saa-c03', 'mcq-d');
    expect(sourceText(tree)).toEqual(['Source: docs.aws.amazon.com']);
    const [line] = byTestID(tree, 'session-card-source');
    expect(line.props.accessibilityRole).toBe('link');
    expect(line.props.accessibilityLabel).toBe('Source: docs.aws.amazon.com');
  });

  it('shows the same line under a correct MCQ verdict', async () => {
    serve([MCQ_CARD], [learnedDue('mcq-d')], 1);
    const { tree } = await mount('review-due');
    await answerMcq(tree, 'b');
    expect(byTestID(tree, 'mcq-row-glyph-b')[0]?.props.children).toBe('✔');
    expect(sourceText(tree)).toEqual(['Source: docs.aws.amazon.com']);
  });

  it('shows the source on a Q/A card after reveal only, and hides it again with Hide', async () => {
    serve([LEARNED], [learnedDue('old-c')], 1);
    const { tree } = await mount('review-due');

    expect(byTestID(tree, 'session-card-source')).toHaveLength(0);
    await pressLabel(tree, 'Reveal answer');
    expect(getCardSource).toHaveBeenCalledWith('aws-saa-c03', 'old-c');
    expect(sourceText(tree)).toEqual(['Source: docs.aws.amazon.com']);
    await pressLabel(tree, 'Hide');
    expect(byTestID(tree, 'session-card-source')).toHaveLength(0);
  });

  it('opens the source URL with Linking on tap', async () => {
    serve([LEARNED], [learnedDue('old-c')], 1);
    const { tree } = await mount('review-due');
    await pressLabel(tree, 'Reveal answer');
    await pressTestID(tree, 'session-card-source');
    expect(openURLMock).toHaveBeenCalledWith('https://docs.aws.amazon.com/sqs/');
  });

  it('renders nothing when the card has no source, the read fails, or the cardSource flag is off', async () => {
    vi.mocked(getCardSource).mockResolvedValue(null);
    serve([LEARNED], [learnedDue('old-c')], 1);
    let { tree } = await mount('review-due');
    await pressLabel(tree, 'Reveal answer');
    expect(byTestID(tree, 'session-card-source')).toHaveLength(0);
    act(() => tree.unmount());

    vi.mocked(getCardSource).mockRejectedValue(new Error('no file'));
    ({ tree } = await mount('review-due'));
    await pressLabel(tree, 'Reveal answer');
    expect(byTestID(tree, 'session-card-source')).toHaveLength(0);
    act(() => tree.unmount());

    vi.mocked(getCardSource).mockClear();
    featureFlagsMock.mockReturnValue(flags({ cardSource: false }));
    ({ tree } = await mount('review-due'));
    await pressLabel(tree, 'Reveal answer');
    expect(getCardSource).not.toHaveBeenCalled();
    expect(byTestID(tree, 'session-card-source')).toHaveLength(0);
  });

  it('adds no second source to the study view, which shows its own SOURCE block', async () => {
    serve([NEW_A], [fresh('new-a')], 1);
    const { tree } = await mount();
    expect(byTestID(tree, 'learning-study-view')).toHaveLength(1);
    expect(byTestID(tree, 'learning-study-source')).toHaveLength(1);
    expect(byTestID(tree, 'session-card-source')).toHaveLength(0);
  });
});
