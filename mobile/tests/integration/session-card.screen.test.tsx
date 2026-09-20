import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: 1,
    Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Answer: 'A1' }],
  })),
  listManifestDecks: vi.fn(async () => []),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => true),
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => [{ stableUid: '1', stage: 0, nextReviewAt: 0 }]),
  saveDeckProgress: vi.fn(async () => {}),
  loadOrInitDailyStats: vi.fn(async () => ({ dateKey: '2026-04-23', plannedCount: 0, doneCount: 0 })),
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
    updatedProgress: [{ stableUid: '1', stage: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 60000 }],
    updatedOne: { stableUid: '1', stage: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 60000, lastSeenRevision: 1 },
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
  pickNextCard: vi.fn(() => ({
    card: { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Answer: 'A1' },
    progress: { stableUid: '1', stage: 0, nextReviewAt: 0 },
  })),
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
import { pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { resetSessionStore, useSessionStore } from '../../src/features/gacha/session/sessionStore';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findPressableByLabel(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

function findTextByLabel(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.findAll((node) => (node.type as any) === 'Text' && node.props.children === label);
}

function buildDeck(overrides: Record<string, unknown> = {}) {
  return {
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    TotalCards: 1,
    Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Answer: 'A1' }],
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

describe('SessionCardScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(resolveDeckBySlug).mockResolvedValue(buildDeck() as any);
    vi.mocked(pickNextCard).mockReturnValue({
      card: { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' },
      progress: { stableUid: '1', stage: 0, nextReviewAt: 0 },
    });
    vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute() as any);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('starts a session and routes to SessionSummary after the last rating', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{
            key: 'session-card',
            name: 'SessionCard',
            params: { slug: 'csharp', mode: 'mixed', limit: 1 },
          } as any}
        />,
      );
    });
    await flush();

    expect(useSessionStore.getState().sessionId).toBeTruthy();
    expect(useSessionStore.getState().slug).toBe('csharp');

    await act(async () => {
      findPressableByLabel(tree, 'Reveal answer').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findPressableByLabel(tree, 'Good').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useSessionStore.getState().completedCount).toBe(1);
    expect(useSessionStore.getState().streakEarned).toBe(true);
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

  it('passes the planner minimum goal to SessionSummary', async () => {
    vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute({ minimumGoal: 2 }) as any);
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{
            key: 'session-card',
            name: 'SessionCard',
            params: { slug: 'csharp', mode: 'mixed', limit: 1 },
          } as any}
        />,
      );
    });
    await flush();

    await act(async () => {
      findPressableByLabel(tree, 'Reveal answer').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findPressableByLabel(tree, 'Good').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({
      minimumGoal: 2,
    }));
  });

  it('settles the rating reward and hands the outcome to Settlement', async () => {
    vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute({ limit: 3, minimumGoal: 2 }) as any);
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{
            key: 'session-card',
            name: 'SessionCard',
            params: { slug: 'csharp', mode: 'mixed', limit: 3, completionRoute: 'settlement' },
          } as any}
        />,
      );
    });
    await flush();

    await act(async () => {
      findPressableByLabel(tree, 'Reveal answer').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findPressableByLabel(tree, 'Good').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigation.replace).toHaveBeenCalledWith('Settlement', expect.objectContaining({
      rewardPulls: 1,
      sessionDone: 1,
    }));
  });

  it('uses Continue in the route-complete state', async () => {
    vi.mocked(pickNextCard).mockReturnValue(null);
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{
            key: 'session-card',
            name: 'SessionCard',
            params: { slug: 'csharp', mode: 'mixed', limit: 1 },
          } as any}
        />,
      );
    });
    await flush();

    expect(findTextByLabel(tree, 'Continue')).toHaveLength(1);
    expect(findTextByLabel(tree, 'View summary')).toHaveLength(0);
  });

  // Ported from tests/integration/review-summary.flow.test.tsx, deleted with
  // ReviewScreen (issue #11). That file pressed the dead screen's done-state
  // button and pinned the SessionSummary payload; the live screen only had a
  // test that the button *renders*, so pressing it was genuinely unpinned.
  it('routes to SessionSummary when Continue is pressed in the route-complete state', async () => {
    vi.mocked(pickNextCard).mockReturnValue(null);
    // minimumGoal 2, not the default 1. The deleted ReviewScreen hard-coded
    // `minimumGoal: 1` here, and with a fixture of 1 this assertion cannot
    // tell the planner's answer from that hard-code -- mutation-checked:
    // swapping doneMinimumGoal for a literal 1 left the 1-fixture version of
    // this test green. The sibling test above only covers the post-rating
    // branch, so the done-state branch was genuinely unpinned.
    vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute({ minimumGoal: 2 }) as any);
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{
            key: 'session-card',
            name: 'SessionCard',
            params: { slug: 'csharp', mode: 'mixed', limit: 1 },
          } as any}
        />,
      );
    });
    await flush();

    act(() => {
      findPressableByLabel(tree, 'Continue').props.onPress();
    });

    // Exact object, not objectContaining: this branch deliberately differs
    // from the post-rating one above -- it carries no sessionId, because a
    // run that ended with nothing to review never started a rating. Pinning
    // the whole shape is what makes a future change to either branch show up
    // as a decision rather than as drift.
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', {
      slug: 'csharp',
      deckTitle: 'C# Interview',
      sessionDone: 0,
      sessionLimit: 1,
      minimumGoal: 2,
      dueCount: 0,
      streakEarned: false,
    });
  });

  it('shows passive trial preview progress without adding another action', async () => {
    vi.mocked(resolveDeckBySlug).mockResolvedValue(buildDeck({
      DeckType: 2,
      TotalCards: 3,
      Cards: [
        { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Answer: 'A1' },
        { StableUid: '2', OrderInDeck: 2, Difficulty: 1, Question: 'Q2', Answer: 'A2' },
        { StableUid: '3', OrderInDeck: 3, Difficulty: 1, Question: 'Q3', Answer: 'A3' },
      ],
    }) as any);
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{
            key: 'session-card',
            name: 'SessionCard',
            params: { slug: 'csharp', mode: 'mixed', limit: 1, previewLimit: 2 },
          } as any}
        />,
      );
    });
    await flush();

    const preview = tree.root.findAll(
      (node) => (node.type as any) === 'View' && node.props?.testID === 'session-card-trial-preview',
    );
    expect(preview).toHaveLength(1);
    expect(findTextByLabel(tree, 'Preview run')).toHaveLength(1);
    expect(findTextByLabel(tree, 'Unlock Premium')).toHaveLength(0);
  });

  it('keeps rating dock mounted while content scrolls', async () => {
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{
            key: 'session-card',
            name: 'SessionCard',
            params: { slug: 'csharp', mode: 'mixed', limit: 1 },
          } as any}
        />,
      );
    });
    await flush();

    const dock = tree.root.findAll(
      (node) => (node.type as any) === 'View' && node.props?.testID === 'review-rating-dock',
    );
    const bar = tree.root.findAll(
      (node) => (node.type as any) === 'View' && node.props?.testID === 'review-rating-bar',
    );
    const root = tree.root.findAll(
      (node) => (node.type as any) === 'SafeAreaView' && node.props?.testID === 'screen-session-card-root',
    );
    const primarySurface = tree.root.findAll(
      (node) =>
        (node.type as any) === 'ScrollView' &&
        node.props?.testID === 'screen-session-card-primary-surface',
    );

    expect(dock).toHaveLength(1);
    expect(bar).toHaveLength(1);
    expect(root).toHaveLength(1);
    expect(primarySurface).toHaveLength(1);
  });
});
