import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { loadDeckProgress } from '../../src/review/storage';
import { recordReviewEvent } from '../../src/sync/progressSync';
import { countDueToday, pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';
import { settleRatingReward } from '../../src/features/gacha/rewards/sessionRewards';
import { resetSessionStore, useSessionStore } from '../../src/features/gacha/session/sessionStore';
import { normalizeMcq } from '../../src/features/gacha/mcq/normalizeMcq';
import { mcqSeed, shownOrderFor } from '../../src/features/gacha/mcq/mcqShuffle';

const FIXED_NOW_MS = Date.UTC(2026, 8, 22, 9, 0, 0);

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

function buildChallengeRoute(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');

const byTestIDPrefix = (tree: renderer.ReactTestRenderer, prefix: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof node.props?.testID === 'string' &&
      node.props.testID.startsWith(prefix),
  );

const renderedOrder = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props?.testID === 'string' &&
        /^mcq-option-[a-f]$/.test(node.props.testID),
    )
    .map((node) => node.props.testID.slice('mcq-option-'.length));

function getTextContent(node: any): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (node?.props?.children) return getTextContent(node.props.children);
  return '';
}

const idText = (tree: renderer.ReactTestRenderer, id: string) => getTextContent(byTestID(tree, id)[0]);

const flatStyle = (style: any): Record<string, any> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

const scrollPaddingBottom = (tree: renderer.ReactTestRenderer) =>
  flatStyle(byTestID(tree, 'screen-session-card-primary-surface')[0].props.contentContainerStyle).paddingBottom;

// Plan §4.3 card 1 — original AWS-flavoured MCQ, PG key order { v, options[{ key, why, text, correct }], shuffle, qualifier }.
const CARD_1_OPT_B =
  'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.';
const CARD_1 = {
  StableUid: 'aws-sqs-order-buffer-mcq-01',
  Revision: 1,
  Question:
    'An order API runs on Amazon EC2 instances behind an Application Load Balancer. During flash sales the downstream fulfilment service is overwhelmed and orders are lost. The company wants the API to keep accepting orders while fulfilment catches up, with the LEAST operational overhead. Which solution meets these requirements?',
  Explanation:
    'Put an SQS standard queue between the API and fulfilment and scale the fulfilment fleet on queue depth. The queue stores the burst durably and the Auto Scaling group drains it with no manual work.',
  RealWorldUsage:
    'In my own checkout side project the checkout function drops a message on SQS and the email sender consumes it, so an email-provider outage never blocks a purchase.',
  Difficulty: 2,
  OrderInDeck: 155,
  Mcq: {
    v: 1,
    options: [
      {
        key: 'a',
        why: 'Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.',
        text: 'Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.',
        correct: false,
      },
      { key: 'b', why: null, text: CARD_1_OPT_B, correct: true },
      {
        key: 'c',
        why: 'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.',
        text: 'Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.',
        correct: false,
      },
      {
        key: 'd',
        why: 'Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.',
        text: 'Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.',
        correct: false,
      },
    ],
    shuffle: true,
    qualifier: 'LEAST operational overhead',
  },
};

// Plan §4.3 card 2 — choose-two, correct { a, c }, no qualifier.
const CARD_2 = {
  StableUid: 'aws-s3-compliance-copy-mcq-02',
  Revision: 1,
  Question:
    'A company must keep a copy of every object written to an S3 bucket in a second Region and must be able to prove that no copy can be deleted for seven years, even by an account administrator. Which combination of actions meets these requirements? (Choose two.)',
  Explanation:
    'Replicate with versioning enabled and lock the destination copies with Object Lock in compliance mode for seven years. Replication provides the second-Region copy; compliance mode is the only setting that no principal can shorten or remove.',
  RealWorldUsage: 'Compliance-mode Object Lock plus cross-Region replication is the standard shape for a durable, tamper-proof audit copy.',
  Difficulty: 3,
  OrderInDeck: 156,
  Mcq: {
    v: 1,
    options: [
      {
        key: 'a',
        why: null,
        text: 'Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.',
        correct: true,
      },
      {
        key: 'b',
        why: 'Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.',
        text: 'Enable S3 Transfer Acceleration on the source bucket.',
        correct: false,
      },
      {
        key: 'c',
        why: null,
        text: 'Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.',
        correct: true,
      },
      {
        key: 'd',
        why: 'A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.',
        text: 'Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.',
        correct: false,
      },
      {
        key: 'e',
        why: "MFA Delete protects the source bucket's versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.",
        text: 'Enable MFA Delete on the source bucket.',
        correct: false,
      },
    ],
    shuffle: true,
    qualifier: null,
  },
};

const LONG_OPTION_TEXT =
  'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on the visible message count. '
    .repeat(6)
    .slice(0, 481);
const CARD_LONG = {
  ...CARD_1,
  Mcq: {
    ...CARD_1.Mcq,
    options: CARD_1.Mcq.options.map((option) => (option.key === 'b' ? { ...option, text: LONG_OPTION_TEXT } : option)),
  },
};

const NEW_PROGRESS = (uid: string) => ({ stableUid: uid, stage: 0, nextReviewAt: 0 });
const DUE_PROGRESS = (uid: string) => ({
  stableUid: uid,
  stage: 1,
  lastReviewedAt: FIXED_NOW_MS - 86_400_000,
  nextReviewAt: FIXED_NOW_MS - 1,
  hardStreak: 0,
});
const REPEAT_PROGRESS = (uid: string) => ({ ...DUE_PROGRESS(uid), stage: 2 });

describe('SessionCardScreen MCQ branch', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
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
    vi.useRealTimers();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function serve(card: any, progress: any) {
    vi.mocked(resolveDeckBySlug).mockResolvedValue(buildDeck({ Cards: [card] }) as any);
    vi.mocked(pickNextCard).mockReturnValue({ card, progress } as any);
    vi.mocked(loadDeckProgress).mockResolvedValue([progress] as any);
  }

  async function mount(params: Record<string, unknown> = {}) {
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{ key: 'session-card', name: 'SessionCard', params: { slug: 'csharp', mode: 'mixed', limit: 1, ...params } } as any}
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

  it('renders the stem stage first with recall-first on', async () => {
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const { tree } = await mount();

    expect(idText(tree, 'mcq-kind-chip')).toBe('Multiple choice');
    expect(byTestID(tree, 'mcq-stem-hint')).toHaveLength(1);
    expect(byTestID(tree, 'mcq-show-options')).toHaveLength(1);
    expect(byTestIDPrefix(tree, 'mcq-option-')).toHaveLength(0);
    expect(byTestID(tree, 'review-rating-dock')).toHaveLength(1);
    expect(byTestID(tree, 'review-rating-bar')).toHaveLength(1);
    expect(byTestID(tree, 'screen-session-card-primary-surface')).toHaveLength(1);
    expect(byTestID(tree, 'screen-session-card-root')).toHaveLength(1);
    expect(tree.root.findAll((n) => (n.type as any) === 'Pressable' && n.findAll((c) => (c.type as any) === 'Text' && c.props.children === 'Reveal answer').length > 0)).toHaveLength(0);
  });

  it('answers a single-choice card correctly and rates it good on first review', async () => {
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const { tree, navigation } = await mount();

    await press(tree, 'mcq-show-options');
    await press(tree, 'mcq-option-b');
    await press(tree, 'mcq-submit-sure');

    expect(idText(tree, 'mcq-verdict-banner')).toBe('Correct');
    expect(byTestID(tree, 'mcq-schedule-line')).toHaveLength(1);
    expect(byTestID(tree, 'mcq-next')).toHaveLength(1);

    await press(tree, 'mcq-next');

    expect(recordReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({ rating: 'good', reviewStage: 'first_review' }),
    );
    expect(settleRatingReward).toHaveBeenCalledWith(expect.objectContaining({ rating: 'good' }));
    expect(navigation.replace).toHaveBeenCalledWith(
      'SessionSummary',
      expect.objectContaining({ picks: { landed: 1, answered: 1 }, streakEarned: true }),
    );
    expect(useSessionStore.getState().streakEarned).toBe(true);
  });

  it('rates a wrong pick again and reports zero landed picks', async () => {
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const { tree, navigation } = await mount();

    await press(tree, 'mcq-show-options');
    await press(tree, 'mcq-option-a');
    await press(tree, 'mcq-submit-unsure');

    expect(idText(tree, 'mcq-verdict-banner')).toBe('Not this time');
    expect(byTestID(tree, 'mcq-why-a')).toHaveLength(1);

    await press(tree, 'mcq-next');

    expect(recordReviewEvent).toHaveBeenCalledWith(expect.objectContaining({ rating: 'again' }));
    expect(navigation.replace).toHaveBeenCalledWith(
      'SessionSummary',
      expect.objectContaining({ picks: { landed: 0, answered: 1 } }),
    );
    expect(useSessionStore.getState().streakEarned).toBe(false);
  });

  it("rates I don't know as again without a pick", async () => {
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const { tree, navigation } = await mount();

    await press(tree, 'mcq-show-options');
    await press(tree, 'mcq-dont-know');

    expect(idText(tree, 'mcq-verdict-banner')).toBe('Not this time');
    expect(byTestID(tree, 'mcq-why-b')).toHaveLength(0);

    await press(tree, 'mcq-next');

    expect(recordReviewEvent).toHaveBeenCalledWith(expect.objectContaining({ rating: 'again' }));
    expect(navigation.replace).toHaveBeenCalledWith(
      'SessionSummary',
      expect.objectContaining({ picks: { landed: 0, answered: 1 } }),
    );
  });

  it('skips the stem stage when recallFirst is off', async () => {
    featureFlagsMock.mockReturnValue(flags({ recallFirst: false }));
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const { tree } = await mount();

    expect(byTestID(tree, 'mcq-option-b')).toHaveLength(1);
    expect(byTestID(tree, 'mcq-show-options')).toHaveLength(0);
    expect(byTestID(tree, 'mcq-submit-sure')).toHaveLength(1);
  });

  it('renders the card as Q/A under the kill switch', async () => {
    featureFlagsMock.mockReturnValue(flags({ enabled: false }));
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const { tree, navigation } = await mount();

    expect(findPressableByLabel(tree, 'Reveal answer')).toBeTruthy();
    expect(byTestIDPrefix(tree, 'mcq-')).toHaveLength(0);
    expect(pickNextCard).toHaveBeenCalledWith(expect.objectContaining({ kindHint: null }));

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

    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', {
      sessionId: expect.any(String),
      slug: 'csharp',
      deckTitle: 'C# Interview',
      sessionDone: 1,
      sessionLimit: 1,
      minimumGoal: 1,
      dueCount: 0,
      streakEarned: true,
      reward: expect.any(Object),
    });
  });

  it('walks a choose-two card: count, over-limit hint, partial verdict, hard', async () => {
    serve(CARD_2, NEW_PROGRESS(CARD_2.StableUid));
    const { tree, navigation } = await mount();

    expect(idText(tree, 'mcq-kind-chip')).toBe('Choose 2');

    await press(tree, 'mcq-show-options');
    for (const option of byTestIDPrefix(tree, 'mcq-option-').filter((n) => /^mcq-option-[a-e]$/.test(n.props.testID))) {
      expect(option.props.accessibilityRole).toBe('checkbox');
    }
    expect(byTestID(tree, 'mcq-submit-sure')[0].props.disabled).toBe(true);
    expect(byTestID(tree, 'mcq-submit-unsure')[0].props.disabled).toBe(true);

    await press(tree, 'mcq-option-a');
    expect(idText(tree, 'mcq-selected-count')).toBe('1 of 2 selected');

    await press(tree, 'mcq-option-b');
    expect(idText(tree, 'mcq-selected-count')).toBe('2 of 2 selected');
    expect(byTestID(tree, 'mcq-submit-sure')[0].props.disabled).toBe(false);
    expect(byTestID(tree, 'mcq-submit-unsure')[0].props.disabled).toBe(false);

    announceMock.mockClear();
    await press(tree, 'mcq-option-d');
    expect(idText(tree, 'mcq-selected-count')).toBe('2 of 2 selected');
    expect(idText(tree, 'mcq-over-limit-hint')).toBe('Deselect one first');
    // VoiceOver hears the rule with the count (review 2026-09-22 #5); the parent announces it.
    expect(announceMock).toHaveBeenCalledTimes(1);
    expect(announceMock).toHaveBeenCalledWith('Pick 2 answers — deselect one first');

    await press(tree, 'mcq-submit-sure');
    expect(idText(tree, 'mcq-verdict-banner')).toBe('You knew 1 of 2');

    await press(tree, 'mcq-next');

    expect(recordReviewEvent).toHaveBeenCalledWith(expect.objectContaining({ rating: 'hard' }));
    expect(navigation.replace).toHaveBeenCalledWith(
      'SessionSummary',
      expect.objectContaining({ picks: { landed: 1, answered: 1 } }),
    );
    expect(useSessionStore.getState().streakEarned).toBe(true);
  });

  it('never truncates the stem or an option under Dynamic Type', async () => {
    expect(LONG_OPTION_TEXT).toHaveLength(481);
    serve(CARD_LONG, NEW_PROGRESS(CARD_LONG.StableUid));
    const { tree } = await mount();

    expect(byTestID(tree, 'mcq-stem')[0].props.numberOfLines).toBeUndefined();

    await press(tree, 'mcq-show-options');
    expect(byTestID(tree, 'mcq-stem')[0].props.numberOfLines).toBe(3);
    await press(tree, 'mcq-show-full-stem');
    expect(byTestID(tree, 'mcq-stem')[0].props.numberOfLines).toBeUndefined();

    expect(getTextContent(byTestID(tree, 'mcq-option-text-b')[0])).toBe(LONG_OPTION_TEXT);
    const optionTexts = tree.root.findAll(
      (n) =>
        typeof n.type === 'string' &&
        (n.type as any) === 'Text' &&
        typeof n.props?.testID === 'string' &&
        n.props.testID.startsWith('mcq-option-') &&
        !n.props.testID.startsWith('mcq-option-letter-'),
    );
    for (const node of optionTexts) expect(node.props.numberOfLines).toBeUndefined();

    await press(tree, 'mcq-option-b');
    await press(tree, 'mcq-submit-sure');
    expect(byTestID(tree, 'mcq-stem')[0].props.numberOfLines).toBeUndefined();

    const clamped = tree.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.allowFontScaling === false,
    );
    expect(clamped).toHaveLength(0);
  });

  it('gives good, not easy, to a changed pick on repeat review and easy to a fast unchanged one', async () => {
    serve(CARD_1, REPEAT_PROGRESS(CARD_1.StableUid));
    const first = await mount();

    await press(first.tree, 'mcq-show-options');
    await press(first.tree, 'mcq-option-a');
    await press(first.tree, 'mcq-option-b');
    vi.setSystemTime(FIXED_NOW_MS + 3_000);
    await press(first.tree, 'mcq-submit-sure');
    await press(first.tree, 'mcq-next');

    expect(recordReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({ rating: 'good', reviewStage: 'repeat_review' }),
    );

    await act(async () => {
      first.tree.unmount();
    });
    vi.clearAllMocks();
    featureFlagsMock.mockReturnValue(flags());
    vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute() as any);
    vi.setSystemTime(FIXED_NOW_MS);
    serve(CARD_1, REPEAT_PROGRESS(CARD_1.StableUid));
    const second = await mount();

    await press(second.tree, 'mcq-show-options');
    await press(second.tree, 'mcq-option-b');
    vi.setSystemTime(FIXED_NOW_MS + 3_000);
    await press(second.tree, 'mcq-submit-sure');
    await press(second.tree, 'mcq-next');

    expect(recordReviewEvent).toHaveBeenCalledWith(expect.objectContaining({ rating: 'easy' }));
  });

  it('re-deals an again card with a new order and the redeal banner', async () => {
    vi.mocked(planChallengeRoute).mockReturnValue(
      buildChallengeRoute({
        limit: 2,
        nodes: [
          { id: 'warmup-0', role: 'warmup', title: 'Warm-up node', subtitle: 'Start.' },
          { id: 'warmup-1', role: 'warmup', title: 'Warm-up node', subtitle: 'Again.' },
        ],
      }) as any,
    );
    // A stage-3 card (repeat review) lapses to stage 1 on `again` and comes straight back.
    serve(CARD_1, { ...REPEAT_PROGRESS(CARD_1.StableUid), stage: 3 });
    const lapsed = { ...NEW_PROGRESS(CARD_1.StableUid), stage: 1, lastReviewedAt: FIXED_NOW_MS, nextReviewAt: FIXED_NOW_MS + 600_000, hardStreak: 0, lapses: 1 };
    vi.mocked(buildRatedSessionState).mockReturnValueOnce({
      updatedProgress: [lapsed],
      updatedOne: { ...lapsed, lastSeenRevision: 1 },
      nextDone: 1,
      nextCurrent: { card: CARD_1, progress: lapsed },
      prevLearnedCount: 0,
      remainingDueCount: 0,
    } as any);

    const { tree } = await mount({ limit: 2 });
    const sessionId = useSessionStore.getState().sessionId!;

    expect(byTestID(tree, 'mcq-redeal-banner')).toHaveLength(0);
    await press(tree, 'mcq-show-options');
    const order0 = renderedOrder(tree);
    const expected0 = shownOrderFor(normalizeMcq(CARD_1.Mcq)!, mcqSeed(sessionId, CARD_1.StableUid, 0)).map((o) => o.key);
    expect(order0).toEqual(expected0);

    await press(tree, 'mcq-option-a');
    await press(tree, 'mcq-submit-unsure');
    await press(tree, 'mcq-next');

    expect(byTestID(tree, 'mcq-redeal-banner')).toHaveLength(1);
    await press(tree, 'mcq-show-options');
    const order1 = renderedOrder(tree);
    const expected1 = shownOrderFor(normalizeMcq(CARD_1.Mcq)!, mcqSeed(sessionId, CARD_1.StableUid, 1)).map((o) => o.key);
    expect(order1).toEqual(expected1);
    expect(order1.join('')).not.toBe(order0.join(''));

    // The redeal is stage 1, repeat_review, unchanged and fast — row 6 territory — yet it rates
    // good, not easy: a lapse ten minutes ago is never undone by one quick re-answer (plan §5.4).
    await press(tree, 'mcq-option-b');
    vi.setSystemTime(FIXED_NOW_MS + 3_000);
    await press(tree, 'mcq-submit-sure');
    expect(idText(tree, 'mcq-verdict-banner')).toBe('Correct');
    expect(idText(tree, 'mcq-schedule-line').startsWith('Scheduled as Good')).toBe(true);
    await press(tree, 'mcq-next');
    expect(recordReviewEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ rating: 'good', reviewStage: 'repeat_review' }),
    );
    expect(recordReviewEvent).not.toHaveBeenCalledWith(expect.objectContaining({ rating: 'easy' }));
  });

  it('reserves scroll padding for the measured dock height', async () => {
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const { tree } = await mount();

    // Until the dock has laid out: the stage default (MCQ_DOCK_HEIGHT 216 + max(insets.bottom, 8)).
    expect(scrollPaddingBottom(tree)).toBe(216 + 8);

    const dock = byTestID(tree, 'review-rating-dock')[0];
    expect(typeof dock.props.onLayout).toBe('function');
    await act(async () => {
      dock.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 354, height: 301 } } });
    });
    expect(scrollPaddingBottom(tree)).toBe(301);

    // The coach line is dismissed, the dock shrinks, the padding follows.
    await press(tree, 'mcq-coach-dismiss');
    await act(async () => {
      byTestID(tree, 'review-rating-dock')[0].props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 354, height: 120 } } });
    });
    expect(scrollPaddingBottom(tree)).toBe(120);
  });

  it('passes a kind hint to the planner on both call sites', async () => {
    serve(CARD_1, DUE_PROGRESS(CARD_1.StableUid));
    const dueRun = await mount();

    await press(dueRun.tree, 'mcq-show-options');
    await press(dueRun.tree, 'mcq-option-b');
    await press(dueRun.tree, 'mcq-submit-sure');
    await press(dueRun.tree, 'mcq-next');

    expect(pickNextCard).toHaveBeenCalledWith(
      expect.objectContaining({ kindHint: { mcqAllowed: true, preferMcq: true } }),
    );
    expect(buildRatedSessionState).toHaveBeenCalledWith(
      expect.objectContaining({ kindHint: { mcqAllowed: true, preferMcq: true } }),
    );

    await act(async () => {
      dueRun.tree.unmount();
    });
    vi.clearAllMocks();
    featureFlagsMock.mockReturnValue(flags());
    vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute() as any);
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const newRun = await mount();

    await press(newRun.tree, 'mcq-show-options');
    await press(newRun.tree, 'mcq-option-b');
    await press(newRun.tree, 'mcq-submit-sure');
    await press(newRun.tree, 'mcq-next');

    expect(buildRatedSessionState).toHaveBeenCalledWith(
      expect.objectContaining({ kindHint: { mcqAllowed: true, preferMcq: false } }),
    );
  });

  it('shows the coach line once and marks it seen on Next', async () => {
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const first = await mount();

    expect(byTestID(first.tree, 'mcq-coach-line')).toHaveLength(1);
    // Mounted INSIDE the opaque, absolutely positioned dock (review 2026-09-22 #1): an in-flow sibling
    // before the dock would be painted over and "Got it" could never be tapped.
    const dock = byTestID(first.tree, 'review-rating-dock')[0];
    expect(dock.findAll((n) => typeof n.type === 'string' && n.props?.testID === 'mcq-coach-line')).toHaveLength(1);
    expect(dock.findAll((n) => typeof n.type === 'string' && n.props?.testID === 'mcq-coach-dismiss')).toHaveLength(1);
    expect(
      byTestID(first.tree, 'screen-session-card-primary-surface')[0].findAll(
        (n) => typeof n.type === 'string' && n.props?.testID === 'mcq-coach-line',
      ),
    ).toHaveLength(0);
    // The coach band sits above the action rows.
    const dockKids = dock.findAll(
      (n) => typeof n.type === 'string' && (n.props?.testID === 'mcq-coach-line' || n.props?.testID === 'review-rating-bar'),
    );
    expect(dockKids.map((n) => n.props.testID)).toEqual(['mcq-coach-line', 'review-rating-bar']);

    await press(first.tree, 'mcq-show-options');
    expect(dock.findAll((n) => typeof n.type === 'string' && n.props?.testID === 'mcq-coach-line')).toHaveLength(1);
    await press(first.tree, 'mcq-option-b');
    await press(first.tree, 'mcq-submit-sure');
    await press(first.tree, 'mcq-next');

    expect(store.get('recallsmith:mcq:coach-seen:v1')).toBe('1');

    resetSessionStore();
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const second = await mount();
    expect(byTestID(second.tree, 'mcq-coach-line')).toHaveLength(0);

    store.clear();
    resetSessionStore();
    serve(CARD_1, NEW_PROGRESS(CARD_1.StableUid));
    const third = await mount();
    expect(byTestID(third.tree, 'mcq-coach-line')).toHaveLength(1);
    await press(third.tree, 'mcq-coach-dismiss');
    expect(store.get('recallsmith:mcq:coach-seen:v1')).toBe('1');
    expect(byTestID(third.tree, 'mcq-coach-line')).toHaveLength(0);
  });
});
