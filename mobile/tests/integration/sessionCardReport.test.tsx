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
    Modal: ({ children, ...props }: any) => React.createElement('Modal', props, children),
    TextInput: ({ children, ...props }: any) => React.createElement('TextInput', props, children),
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

// This screen reads/installs through deckCache. Mock it to delegate straight to
// the (mocked) deckRepository so the test keeps driving resolveDeckBySlug /
// installDeckFromUrl, without the real cache's dynamic scope import adding an
// async hop the tight act() cycles here would race.
vi.mock('../../src/content/deckCache', async () => {
  const repo = (await import('../../src/content/deckRepository')) as {
    resolveDeckBySlug: (slug: string) => Promise<unknown>;
    installDeckFromUrl: (
      slug: string,
      url: string,
      remoteVersion: string | null,
      remoteSha256: string | null,
    ) => Promise<boolean>;
  };
  return {
    getCachedDeck: (slug: string) => repo.resolveDeckBySlug(slug),
    installDeckAndInvalidate: (
      slug: string,
      url: string,
      remoteVersion: string | null,
      remoteSha256: string | null,
    ) => repo.installDeckFromUrl(slug, url, remoteVersion, remoteSha256),
    invalidateDeckCache: () => {},
  };
});

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
  buildSessionProgressVM: vi.fn(() => ({ title: 'Session progress', subtitle: 'Card 1 of 1', progressText: '0 / 1', hint: '0 due', percent: 0, currentRoleLabel: null })),
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
    progress: { stableUid: '1', stage: 0, nextReviewAt: 0, lastReviewedAt: LEARNED_AT },
  })),
  planChallengeRoute: vi.fn(() => ({
    slug: 'csharp',
    deckTitle: 'C# Interview',
    mode: 'mixed',
    limit: 1,
    minimumGoal: 1,
    dueCount: 0,
    newCount: 1,
    nodes: [{ id: 'warmup-0', role: 'warmup', title: '', subtitle: 'Start.' }],
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
vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));
vi.mock('../../src/auth/freshToken', () => ({ getFreshAccessToken: vi.fn(async () => 'tok-1') }));

import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';
import { CHROME_MAX_FONT_SCALE } from '../../src/theme/dynamicType';

// The dealt card has been reviewed before, so it is rated directly; a never-reviewed Q/A card
// opens on the R22 study view first (see the learning-step tests in session-card.screen.test).
const LEARNED_AT = 1_600_000_000_000;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

function findPressableByLabel(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

function byTestId(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID);
}

async function renderSession() {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn(), push: vi.fn() } as any;
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
  return { tree, navigation };
}

async function reveal(tree: renderer.ReactTestRenderer) {
  await act(async () => {
    findPressableByLabel(tree, 'Reveal answer').props.onPress();
    await Promise.resolve();
  });
  await flush();
}

describe('SessionCardScreen — report entry point', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(resolveDeckBySlug).mockResolvedValue({
      Slug: 'csharp',
      Title: 'C# Interview',
      Locale: 'en-US',
      Version: '1',
      DeckType: 1,
      TotalCards: 1,
      Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Answer: 'A1' }],
    } as any);
    vi.mocked(pickNextCard).mockReturnValue({
      card: { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' },
      progress: { stableUid: '1', stage: 0, nextReviewAt: 0, lastReviewedAt: LEARNED_AT },
    } as any);
    vi.mocked(planChallengeRoute).mockReturnValue({
      slug: 'csharp',
      deckTitle: 'C# Interview',
      mode: 'mixed',
      limit: 1,
      minimumGoal: 1,
      dueCount: 0,
      newCount: 1,
      nodes: [{ id: 'warmup-0', role: 'warmup', title: '', subtitle: 'Start.' }],
      summary: 'C# Interview',
    } as any);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    applyRemoteFeatures(null);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('shows a Report button only after the answer is revealed, with the flag on', async () => {
    applyRemoteFeatures({ features: { cardReport: { enabled: true } } } as unknown as RemoteConfig);
    const { tree } = await renderSession();
    expect(byTestId(tree, 'session-card-report')).toHaveLength(0);

    await reveal(tree);
    const button = byTestId(tree, 'session-card-report');
    expect(button).toHaveLength(1);
    expect(button[0].props.accessibilityRole).toBe('button');
    expect(button[0].props.accessibilityLabel).toBe('Report a problem with this card');
    expect(typeof button[0].props.accessibilityHint).toBe('string');
    const rawStyle = typeof button[0].props.style === 'function' ? button[0].props.style({ pressed: false }) : button[0].props.style;
    const style = Object.assign({}, ...[rawStyle].flat(Infinity).filter(Boolean));
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    const label = button[0].findAll((n) => (n.type as unknown) === 'Text')[0];
    expect(label.props.children).toBe('Report');
    expect(label.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);

    // Kept out of the rating dock.
    const dock = byTestId(tree, 'review-rating-dock')[0];
    expect(dock.findAll((n) => n.props?.testID === 'session-card-report')).toHaveLength(0);
  });

  it('opens the report Modal in place without navigating away', async () => {
    applyRemoteFeatures({ features: { cardReport: { enabled: true } } } as unknown as RemoteConfig);
    const { tree, navigation } = await renderSession();
    await reveal(tree);
    await act(async () => {
      byTestId(tree, 'session-card-report')[0].props.onPress();
    });
    await flush();
    expect(byTestId(tree, 'report-card-sheet')).toHaveLength(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => {
      byTestId(tree, 'report-card-cancel')[0].props.onPress();
    });
    expect(byTestId(tree, 'report-card-sheet')).toHaveLength(0);
  });

  it('never shows the Report button with the flag off (the default)', async () => {
    const { tree } = await renderSession();
    await reveal(tree);
    expect(byTestId(tree, 'session-card-report')).toHaveLength(0);
  });
});
