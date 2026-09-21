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
import { countDueToday, pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';
import { settleRatingReward } from '../../src/features/gacha/rewards/sessionRewards';
import type { RatingRewardStep } from '../../src/features/gacha/rewards/sessionRewards';
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

  it('shows the short deck title in the header and hands the full title to the summary', async () => {
    vi.mocked(resolveDeckBySlug).mockResolvedValue(
      buildDeck({ Slug: 'claude-ccdv-f', Title: 'Claude Developer Foundations (CCDV-F)' }) as any,
    );
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{
            key: 'session-card',
            name: 'SessionCard',
            params: { slug: 'claude-ccdv-f', mode: 'mixed', limit: 1 },
          } as any}
        />,
      );
    });
    await flush();

    const header = tree.root.findAll(
      (node) => (node.type as any) === 'Text' && node.props.children === 'Claude CCDV-F',
    );
    expect(header).toHaveLength(1);
    expect(
      tree.root.findAll(
        (node) => (node.type as any) === 'Text' && node.props.children === 'Claude Developer Foundations (CCDV-F)',
      ),
    ).toHaveLength(0);

    await act(async () => {
      findPressableByLabel(tree, 'Reveal answer').props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      findPressableByLabel(tree, 'Good').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigation.replace).toHaveBeenCalledWith(
      'SessionSummary',
      expect.objectContaining({ slug: 'claude-ccdv-f', deckTitle: 'Claude Developer Foundations (CCDV-F)' }),
    );
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

  it('renders a long scenario stem in full inside the scroll surface, before and after reveal', async () => {
    // ~420 chars: an SAA-C03-shaped stem. The pre-v4 ReviewBody clamped this to
    // 4 lines on the front and 2 on the back, which is what the owner's device
    // screenshots showed. The dock stays pinned outside the scroll either way.
    const longQuestion =
      'A company runs a three-tier web application on EC2 behind an Application Load Balancer, with ' +
      'an RDS for PostgreSQL Multi-AZ database. Traffic is steady on weekdays but doubles for four ' +
      'hours every Saturday. The operations team must keep p99 latency under 200 ms during the spike ' +
      'without paying for the extra capacity all week, and must not change the application code or ' +
      'the database engine. Which combination of changes meets these requirements MOST cost-effectively?';
    vi.mocked(pickNextCard).mockReturnValue({
      card: {
        StableUid: '1',
        OrderInDeck: 3220,
        Difficulty: 2,
        Question: longQuestion,
        Explanation: 'Use a scheduled scaling action on the Auto Scaling group for the Saturday window.',
      },
      progress: { stableUid: '1', stage: 0, nextReviewAt: 0 },
    } as any);
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

    const primarySurface = tree.root.find(
      (node) =>
        (node.type as any) === 'ScrollView' && node.props?.testID === 'screen-session-card-primary-surface',
    );
    const questionNodes = () =>
      primarySurface.findAll((node) => (node.type as any) === 'Text' && node.props?.testID === 'review-question');

    // Front face: the full stem, no clamp, inside the scroll surface.
    expect(questionNodes()).toHaveLength(1);
    expect(questionNodes()[0].props.children).toBe(longQuestion);
    expect(questionNodes()[0].props.numberOfLines).toBeUndefined();

    await act(async () => {
      findPressableByLabel(tree, 'Reveal answer').props.onPress();
      await Promise.resolve();
    });

    // Back face: still the full stem, still no clamp, and the answer follows it.
    expect(questionNodes()).toHaveLength(1);
    expect(questionNodes()[0].props.children).toBe(longQuestion);
    expect(questionNodes()[0].props.numberOfLines).toBeUndefined();
    expect(findTextByLabel(tree, 'QUESTION')).toHaveLength(1);
    expect(
      findTextByLabel(tree, 'Use a scheduled scaling action on the Auto Scaling group for the Saturday window.'),
    ).toHaveLength(1);
    // The dock is a sibling of the scroll surface, not inside it.
    expect(
      primarySurface.findAll((node) => (node.type as any) === 'View' && node.props?.testID === 'review-rating-dock'),
    ).toHaveLength(0);
    expect(
      tree.root.findAll((node) => (node.type as any) === 'View' && node.props?.testID === 'review-rating-dock'),
    ).toHaveLength(1);
  });

  it('shows the tomorrow-load forecast line on the 20th new card and not on the 19th', async () => {
    const stepWith = (newCardsLearnedToday: number): RatingRewardStep => ({
      newCardPaid: false,
      dueClearPaid: false,
      pulls: 0,
      walletBefore: null,
      walletAfter: null,
      applied: null,
      newCardsLearnedToday,
    });

    const findForecast = (tree: renderer.ReactTestRenderer) =>
      tree.root.findAll(
        (node) => (node.type as any) === 'Text' && node.props?.testID === 'session-card-load-forecast',
      );

    async function rateOnce(count: number) {
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

      expect(findForecast(tree)).toHaveLength(0);

      vi.mocked(settleRatingReward).mockResolvedValueOnce(stepWith(count));

      await act(async () => {
        findPressableByLabel(tree, 'Reveal answer').props.onPress();
        await Promise.resolve();
      });

      await act(async () => {
        findPressableByLabel(tree, 'Good').props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });

      return tree;
    }

    const before = await rateOnce(19);
    expect(findForecast(before)).toHaveLength(0);
    await act(async () => {
      before.unmount();
    });

    const after = await rateOnce(20);
    const line = findForecast(after);
    expect(line).toHaveLength(1);
    expect(String(line[0].props.children)).toMatch(/^At this pace, about \d+ cards? comes? due tomorrow\.$/);
  });

  describe('settleRatingReward call contract (review finding E)', () => {
    const PRE_RATING_PROGRESS = [{ stableUid: '1', stage: 0, nextReviewAt: 0 }];

    afterEach(() => {
      // mockReturnValue outlives vi.clearAllMocks(); put the planner mock back the way the file declares it.
      vi.mocked(countDueToday).mockReturnValue(0);
    });

    async function rateOnceIn(mode: 'mixed' | 'sweep' | 'learn-new') {
      const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(
          <SessionCardScreen
            navigation={navigation}
            route={{ key: 'session-card', name: 'SessionCard', params: { slug: 'csharp', mode, limit: 1 } } as any}
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
      return { tree, navigation };
    }

    it('passes newCardEligible=false in sweep mode and true otherwise', async () => {
      await rateOnceIn('sweep');
      expect(settleRatingReward).toHaveBeenCalledTimes(1);
      expect(vi.mocked(settleRatingReward).mock.calls[0][0]).toMatchObject({ slug: 'csharp', stableUid: '1', rating: 'good', newCardEligible: false });

      vi.mocked(settleRatingReward).mockClear();
      resetSessionStore();
      await rateOnceIn('mixed');
      expect(vi.mocked(settleRatingReward).mock.calls[0][0]).toMatchObject({ newCardEligible: true });

      vi.mocked(settleRatingReward).mockClear();
      resetSessionStore();
      await rateOnceIn('learn-new');
      expect(vi.mocked(settleRatingReward).mock.calls[0][0]).toMatchObject({ newCardEligible: true });
    });

    it('passes the pre-rating progress and the pre/post due counts, never the updated ones', async () => {
      const updatedProgress = [{ stableUid: '1', stage: 1, lastReviewedAt: 1_700_000_000_000, nextReviewAt: 1_700_000_060_000 }];
      vi.mocked(countDueToday).mockReturnValue(3);
      vi.mocked(buildRatedSessionState).mockReturnValueOnce({
        updatedProgress,
        updatedOne: { ...updatedProgress[0], lastSeenRevision: 1 },
        nextDone: 1,
        nextCurrent: null,
        prevLearnedCount: 0,
        remainingDueCount: 2,
      } as any);

      await rateOnceIn('mixed');

      const input = vi.mocked(settleRatingReward).mock.calls[0][0];
      expect(input.progressBefore).toEqual(PRE_RATING_PROGRESS);
      expect(input.progressBefore).not.toEqual(updatedProgress);
      expect(input.dueBefore).toBe(3);
      expect(input.remainingDueCount).toBe(2);
      expect(input.now).toBeInstanceOf(Date);
    });
  });

  describe('forecast line when the milestone rating ends the run (review finding C)', () => {
    const milestoneStep = (): RatingRewardStep => ({
      newCardPaid: true,
      dueClearPaid: false,
      pulls: 1,
      walletBefore: { availablePulls: 0, reservePulls: 0 },
      walletAfter: { availablePulls: 1, reservePulls: 0 },
      applied: { availablePulls: 1, reservePulls: 0, appliedToAvailable: 1, appliedToReserve: 0, dropped: 0 },
      newCardsLearnedToday: 20,
    });
    const findForecast = (tree: renderer.ReactTestRenderer) =>
      tree.root.findAll((node) => (node.type as any) === 'Text' && node.props?.testID === 'session-card-load-forecast');

    async function mountAndRate(params: Record<string, unknown>) {
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
      await act(async () => {
        findPressableByLabel(tree, 'Reveal answer').props.onPress();
        await Promise.resolve();
      });
      await act(async () => {
        findPressableByLabel(tree, 'Good').props.onPress();
        await Promise.resolve();
        await Promise.resolve();
      });
      return { tree, navigation };
    }

    it('hands the line to SessionSummary as loadForecast when the run ends on the milestone', async () => {
      vi.mocked(settleRatingReward).mockResolvedValueOnce(milestoneStep());
      const { navigation } = await mountAndRate({});

      expect(navigation.replace).toHaveBeenCalledTimes(1);
      const [screen, params] = navigation.replace.mock.calls[0];
      expect(screen).toBe('SessionSummary');
      expect(params.loadForecast).toMatch(/^At this pace, about \d+ cards? comes? due tomorrow\.$/);
      expect(params.reward).toEqual(expect.any(Object));
    });

    it('omits loadForecast from the SessionSummary params when the run ends off-milestone', async () => {
      const { navigation } = await mountAndRate({});
      const [, params] = navigation.replace.mock.calls[0];
      expect('loadForecast' in params).toBe(false);
    });

    it('never forecasts in sweep mode, even on the milestone count', async () => {
      vi.mocked(settleRatingReward).mockResolvedValueOnce(milestoneStep());
      const { tree, navigation } = await mountAndRate({ mode: 'sweep' });
      expect(findForecast(tree)).toHaveLength(0);
      const [, params] = navigation.replace.mock.calls[0];
      expect('loadForecast' in params).toBe(false);
    });

    it('keeps the in-session line and does not navigate when the run continues past the milestone', async () => {
      vi.mocked(settleRatingReward).mockResolvedValueOnce(milestoneStep());
      vi.mocked(buildRatedSessionState).mockReturnValueOnce({
        updatedProgress: [{ stableUid: '1', stage: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 60000 }],
        updatedOne: { stableUid: '1', stage: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 60000, lastSeenRevision: 1 },
        nextDone: 1,
        nextCurrent: {
          card: { StableUid: '2', OrderInDeck: 2, Difficulty: 1, Question: 'Q2', Answer: 'A2' },
          progress: { stableUid: '2', stage: 0, nextReviewAt: 0 },
        },
        prevLearnedCount: 0,
        remainingDueCount: 0,
      } as any);
      vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute({ limit: 3, minimumGoal: 2 }) as any);

      const { tree, navigation } = await mountAndRate({ limit: 3 });

      expect(navigation.replace).not.toHaveBeenCalled();
      const line = findForecast(tree);
      expect(line).toHaveLength(1);
      expect(String(line[0].props.children)).toMatch(/^At this pace, about \d+ cards? comes? due tomorrow\.$/);
    });
  });

  // Owner's device, 2026-09-21 (screenshots 06/07/15): a freshly installed
  // deck opened as "Warm-up node 0/1" over nothing, the dock kept the
  // pre-reveal hint after reveal, and the code sample bled through the
  // 95 %-alpha dock.
  describe('empty deck, hint copy, rank badge and dock surface (polish 2)', () => {
    function mount(params: Record<string, unknown> = {}) {
      const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
      let tree!: renderer.ReactTestRenderer;
      return (async () => {
        await act(async () => {
          tree = renderer.create(
            <SessionCardScreen
              navigation={navigation}
              route={{ key: 'session-card', name: 'SessionCard', params: { slug: 'csharp', mode: 'mixed', ...params } } as any}
            />,
          );
        });
        await flush();
        return { tree, navigation };
      })();
    }

    const byTestID = (tree: renderer.ReactTestRenderer, testID: string) =>
      tree.root.findAll((node) => node.props?.testID === testID && typeof node.type === 'string');

    it('shows the draw empty state and never starts a session when the planner answers limit 0', async () => {
      vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute({ limit: 0, nodes: [], dueCount: 0, newCount: 0 }) as any);
      vi.mocked(pickNextCard).mockReturnValue(null);
      const { tree, navigation } = await mount();

      expect(byTestID(tree, 'session-card-empty-deck')).toHaveLength(1);
      expect(findTextByLabel(tree, 'Open a pack to get your first cards')).toHaveLength(1);
      // No route, no run header, no rating dock, no route-complete card.
      expect(useSessionStore.getState().sessionId).toBeNull();
      expect(useSessionStore.getState().route).toEqual([]);
      expect(findTextByLabel(tree, 'Route complete')).toHaveLength(0);
      expect(findTextByLabel(tree, 'Continue')).toHaveLength(0);
      expect(byTestID(tree, 'review-rating-dock')).toHaveLength(0);
      expect(JSON.stringify(tree.toJSON())).not.toContain('0/1');
      expect(pickNextCard).not.toHaveBeenCalled();

      act(() => {
        findPressableByLabel(tree, 'Open a pack to get your first cards').props.onPress();
      });
      expect(navigation.navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('still starts a one-node maintenance run for limit 1 with no card to pick (route-complete path is untouched)', async () => {
      vi.mocked(planChallengeRoute).mockReturnValue(buildChallengeRoute({ limit: 1, dueCount: 0, newCount: 0 }) as any);
      vi.mocked(pickNextCard).mockReturnValue(null);
      const { tree } = await mount();
      expect(byTestID(tree, 'session-card-empty-deck')).toHaveLength(0);
      expect(findTextByLabel(tree, 'Route complete')).toHaveLength(1);
      expect(useSessionStore.getState().sessionId).toBeTruthy();
    });

    it('switches the dock hint from the recall prompt to the rating question on reveal', async () => {
      const { tree } = await mount({ limit: 1 });
      const hint = () => byTestID(tree, 'review-rating-hint')[0].props.children;

      expect(hint()).toBe('Think about how well you recalled this before seeing the answer.');
      await act(async () => {
        findPressableByLabel(tree, 'Reveal answer').props.onPress();
        await Promise.resolve();
      });
      expect(hint()).toBe('How well did you recall it?');
      await act(async () => {
        findPressableByLabel(tree, 'Hide').props.onPress();
        await Promise.resolve();
      });
      expect(hint()).toBe('Think about how well you recalled this before seeing the answer.');
    });

    it('prints the deck rank in the header badge, not the raw OrderInDeck', async () => {
      // Sparse authoring keys, shuffled: the 780 card is 2nd of 3 in deck order.
      vi.mocked(resolveDeckBySlug).mockResolvedValue(buildDeck({
        TotalCards: 3,
        Cards: [
          { StableUid: 'c', OrderInDeck: 3700, Difficulty: 1, Question: 'Q3' },
          { StableUid: 'a', OrderInDeck: 5, Difficulty: 1, Question: 'Q1' },
          { StableUid: 'b', OrderInDeck: 780, Difficulty: 1, Question: 'Q2' },
        ],
      }) as any);
      vi.mocked(pickNextCard).mockReturnValue({
        card: { StableUid: 'b', OrderInDeck: 780, Difficulty: 1, Question: 'Q2' },
        progress: { stableUid: 'b', stage: 0, nextReviewAt: 0 },
      } as any);
      const { tree } = await mount({ limit: 1 });
      const badge = byTestID(tree, 'review-order-badge');
      expect(badge).toHaveLength(1);
      expect(badge[0].props.children).toBe('#002');
      expect(JSON.stringify(tree.toJSON())).not.toContain('#780');
    });

    it('gives the rating dock an opaque surface with a top hairline and an upward shadow', async () => {
      const { tree } = await mount({ limit: 1 });
      const dock = byTestID(tree, 'review-rating-dock')[0];
      const style = Object.assign({}, ...[dock.props.style].flat(Infinity).filter(Boolean));
      expect(style.backgroundColor).toBe('#FAF3E0');
      expect(String(style.backgroundColor)).not.toMatch(/rgba/);
      expect(style.borderTopWidth).toBe(1);
      expect(style.borderTopColor).toBeTruthy();
      expect(style.shadowOffset).toEqual({ width: 0, height: -4 });
      expect(style.shadowOpacity).toBeGreaterThan(0);
    });
  });
});
