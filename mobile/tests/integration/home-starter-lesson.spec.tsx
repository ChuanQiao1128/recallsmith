// R22 §4: Home sends a learner in the 'starter' onboarding stage into the 5-card starter lesson;
// existing users (stage 'done') see Home exactly as before.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let walletFixture = { availablePulls: 0, reservePulls: 0 };
let activeSlugFixture: string | null = 'csharp';
let deckSummariesFixture: any[] = [];
let updatesFixture: Record<string, any> = {};

const navigateMock = vi.fn();
const store = new Map<string, string>();

// Real onboarding stage / study goal / starter-lesson reads over an in-memory AsyncStorage.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));
const setActiveDeckSlugMock = vi.fn(async (_slug: string) => {});

vi.mock('react-native', () => {
  const React = require('react');
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
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    Alert: { alert: vi.fn() },
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

// Every mounted focus callback is kept so a test can focus Home a second time (back from a paused
// lesson) without remounting it: refocus() runs each one again, as navigation does on return.
const focusCallbacks = vi.hoisted(() => new Set<() => unknown>());
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: any) => {
    React.useEffect(() => {
      focusCallbacks.add(callback);
      const cleanup = callback();
      return () => {
        focusCallbacks.delete(callback);
        if (typeof cleanup === 'function') cleanup();
      };
    }, [callback]);
  },
}));

async function refocus() {
  await act(async () => {
    for (const callback of [...focusCallbacks]) callback();
  });
  await flush();
  await flush();
}

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => activeSlugFixture),
  setActiveDeckSlug: vi.fn(async (slug: string) => setActiveDeckSlugMock(slug)),
}));

// R24 §2.2: Home asks the starter module (lazily imported) to upgrade an installed starter pack and
// listens for upgrades. Like the real module, a run that upgraded something tells every listener.
const upgradeStarterDecksMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []));
const starterUpgradeListeners = vi.hoisted(() => new Set<(slugs: string[]) => void>());
vi.mock('../../src/content/starterOffline', () => ({
  upgradeStarterDecks: async () => {
    const upgraded = await upgradeStarterDecksMock();
    if (upgraded.length > 0) for (const listener of [...starterUpgradeListeners]) listener(upgraded);
    return upgraded;
  },
  subscribeStarterUpgrades: (listener: (slugs: string[]) => void) => {
    starterUpgradeListeners.add(listener);
    return () => {
      starterUpgradeListeners.delete(listener);
    };
  },
}));

vi.mock('../../src/features/gacha/home/deckActionResolver', () => ({
  loadHomeDeckSummaries: vi.fn(async () => {
    const now = Date.now();
    const totalDue = deckSummariesFixture.reduce((sum, deck) => sum + Number(deck.dueToday ?? 0), 0);
    return {
      deckSummaries: deckSummariesFixture,
      updates: updatesFixture,
      allUpcoming30: Array.from({ length: 30 }, (_, i) => ({
        dateKey: new Date(now + i * 86_400_000).toISOString(),
        count: i === 0 ? totalDue : 0,
      })),
      asOfISO: new Date(now).toISOString(),
    };
  }),
  autoApplyFreeDeckUpdates: vi.fn(() => []),
  resolveDeckAction: vi.fn(async () => ({ kind: 'open', slug: 'csharp' })),
  executeDeckAction: vi.fn(async () => ({ activeSlug: 'csharp' })),
}));

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      status: 'signed_out',
      accessToken: '',
      init: vi.fn(async () => {}),
      userSub: null,
    }),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/home/homeRemote', () => ({
  fetchServerPremium: vi.fn(async () => false),
}));

// 1.7: Home builds per-pack wallets; each studiable pack gets the fixture.
vi.mock('../../src/features/gacha/rewards/economyFloor', () => ({
  prepareHomeDeckWallets: vi.fn(async ({ deckSummaries }: { deckSummaries: Array<{ slug: string }> }) => {
    const out: Record<string, typeof walletFixture> = {};
    for (const s of deckSummaries) out[s.slug] = walletFixture;
    return out;
  }),
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => ({
    currentDailyStreak: 2,
    longestDailyStreak: 2,
    weekCompletedDays: 2,
    totalQualifiedSessions: 3,
    lastQualifiedDateKey: '2026-01-01',
    currentWeekKey: '2026-W01',
  })),
}));

vi.mock('../../src/sync/progressSync', () => ({
  forceProgressSync: vi.fn(async () => {}),
}));

import { HomeScreen } from '../../src/screens/HomeScreen';
import { loadHomeDeckSummaries } from '../../src/features/gacha/home/deckActionResolver';
import { prepareHomeDeckWallets } from '../../src/features/gacha/rewards/economyFloor';

// Mirrors the mocked module's default snapshot so per-test overrides of
// loadHomeDeckSummaries can be restored to the shared behaviour in beforeEach.
function makeHomeSummary() {
  const now = Date.now();
  const totalDue = deckSummariesFixture.reduce((sum, deck) => sum + Number(deck.dueToday ?? 0), 0);
  return {
    deckSummaries: deckSummariesFixture,
    updates: updatesFixture,
    allUpcoming30: Array.from({ length: 30 }, (_, i) => ({
      dateKey: new Date(now + i * 86_400_000).toISOString(),
      count: i === 0 ? totalDue : 0,
    })),
    asOfISO: new Date(now).toISOString(),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// The title of the featured hero pack (rendered as fallback text when the RN
// facade has no Image), which follows the selected deck.
function featuredTitle(tree: renderer.ReactTestRenderer): string {
  const pack = tree.root.findByProps({ testID: 'home-featured-pack' });
  return pack
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => String(node.props.children ?? ''))
    .join('');
}

const textBlob = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children ?? ''),
    )
    .join('\n');

const STAGE_KEY = 'recallsmith:onboarding:stage:v1';
const GOAL_KEY = 'recallsmith:study-goal:v1';

function deck(slug: string, over: Record<string, unknown> = {}) {
  return {
    slug,
    title: slug,
    locale: 'en-US',
    version: '1',
    deckType: 1,
    totalCards: 10,
    localCards: 10,
    studyCards: 10,
    canStudy: true,
    dueToday: 0,
    plannedToday: 0,
    newToday: 0,
    masteredApprox: 0,
    percent: 0,
    ...over,
  };
}

async function renderHome(params?: Record<string, unknown>) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home', params } as any} />,
    );
  });
  await flush();
  await flush();
  return tree;
}

const sessionCalls = () => navigateMock.mock.calls.filter((call) => call[0] === 'SessionCard');

describe('HomeScreen starter lesson', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    store.clear();
    walletFixture = { availablePulls: 0, reservePulls: 0 };
    activeSlugFixture = 'aws-saa-c03';
    deckSummariesFixture = [deck('aws-saa-c03', { newToday: 5 }), deck('csharp-basics')];
    updatesFixture = {};
    navigateMock.mockReset();
    upgradeStarterDecksMock.mockReset();
    upgradeStarterDecksMock.mockResolvedValue([]);
    // Earlier tests leave their Home mounted; refocus() and the listeners reach this test's Home only.
    focusCallbacks.clear();
    starterUpgradeListeners.clear();
    vi.mocked(loadHomeDeckSummaries).mockReset();
    vi.mocked(loadHomeDeckSummaries).mockImplementation(async () => makeHomeSummary() as any);
  });

  it('sends a learner in the starter stage into the lesson on the goal deck, once per visit', async () => {
    store.set(STAGE_KEY, 'starter');
    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'aws-saa-c03', examDate: null }));

    const tree = await renderHome();

    expect(sessionCalls()).toEqual([['SessionCard', { slug: 'aws-saa-c03', mode: 'learn-new' }]]);
    expect(navigateMock).not.toHaveBeenCalledWith('Draw', expect.anything());

    // Back on Home after a pause (a second focus of the same Home): no second automatic trip into
    // the lesson, so the learner can stay here.
    await refocus();
    expect(sessionCalls()).toHaveLength(1);

    // One primary action resumes the lesson.
    const cta = tree.root.findByProps({ testID: 'home-starter-cta' });
    expect(textBlob(tree)).toContain('Continue your first lesson');
    expect(textBlob(tree)).toContain('Learn 5 cards, then open your first pack');
    expect(tree.root.findAll((node) => node.props?.testID === 'home-primary-cta')).toHaveLength(0);
    await act(async () => {
      cta.props.onPress();
    });
    expect(sessionCalls()).toHaveLength(2);
    expect(sessionCalls()[1]).toEqual(['SessionCard', { slug: 'aws-saa-c03', mode: 'learn-new' }]);

    // The hero pack does not open Draw during the lesson either.
    await act(async () => {
      tree.root.findByProps({ testID: 'home-featured-pack' }).props.onPress();
    });
    expect(sessionCalls()).toHaveLength(3);
    expect(navigateMock).not.toHaveBeenCalledWith('Draw', expect.anything());
  });

  it('falls back to the active deck when no study goal is stored', async () => {
    store.set(STAGE_KEY, 'starter');
    activeSlugFixture = 'csharp-basics';
    await renderHome();
    expect(sessionCalls()).toEqual([['SessionCard', { slug: 'csharp-basics', mode: 'learn-new' }]]);
  });

  it('ends a lesson that has no deck to teach (no study goal, no active deck) instead of locking every pack', async () => {
    store.set(STAGE_KEY, 'starter');
    activeSlugFixture = null;
    // Record the stage each wallet preparation sees (same wallets as the module mock).
    const stagesSeen: Array<string | undefined> = [];
    vi.mocked(prepareHomeDeckWallets).mockImplementation(async ({ deckSummaries }) => {
      stagesSeen.push(store.get(STAGE_KEY));
      const out: Record<string, typeof walletFixture> = {};
      for (const s of deckSummaries) out[s.slug] = walletFixture;
      return out;
    });

    const tree = await renderHome();

    expect(sessionCalls()).toHaveLength(0);
    expect(store.get(STAGE_KEY)).toBe('done');
    // The economy runs again: Home re-prepares the pack wallets once the stage has closed, so the
    // bootstrap and the floor are no longer skipped.
    expect(stagesSeen).toContain('done');
    expect(tree.root.findAll((node) => node.props?.testID === 'home-starter-cta')).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props?.testID === 'home-primary-cta' && (node.type as any) === 'Pressable')).toHaveLength(1);
    expect(textBlob(tree)).not.toContain('first lesson');
  });

  it('leaves existing users (stage done) on Home with the usual primary action', async () => {
    store.set(STAGE_KEY, 'done');
    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'aws-saa-c03', examDate: null }));
    store.set('recallsmith:starter-lesson:v1', JSON.stringify({ slug: 'aws-saa-c03', uids: ['a1'] }));

    const tree = await renderHome();

    expect(sessionCalls()).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props?.testID === 'home-starter-cta')).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props?.testID === 'home-primary-cta' && (node.type as any) === 'Pressable')).toHaveLength(1);
    expect(textBlob(tree)).not.toContain('first lesson');
  });

  it('upgrades an installed starter pack on every Home focus and refreshes Home when the full deck went in', async () => {
    store.set(STAGE_KEY, 'done');
    await renderHome();
    expect(upgradeStarterDecksMock).toHaveBeenCalledTimes(1);
    const loadsBefore = vi.mocked(loadHomeDeckSummaries).mock.calls.length;

    // Nothing upgraded: the focus refresh is the only reload.
    await refocus();
    expect(upgradeStarterDecksMock).toHaveBeenCalledTimes(2);
    const loadsAfterQuietFocus = vi.mocked(loadHomeDeckSummaries).mock.calls.length;

    // The full deck replaced the starter pack: Home reloads its shelf once more.
    upgradeStarterDecksMock.mockResolvedValue(['aws-saa-c03']);
    await refocus();
    expect(upgradeStarterDecksMock).toHaveBeenCalledTimes(3);
    const quietFocusLoads = loadsAfterQuietFocus - loadsBefore;
    expect(vi.mocked(loadHomeDeckSummaries).mock.calls.length - loadsAfterQuietFocus).toBeGreaterThan(quietFocusLoads);
  });

  it('refreshes a Home that is already showing when an upgrade started elsewhere (App on foreground) went in', async () => {
    store.set(STAGE_KEY, 'done');
    const tree = await renderHome();
    expect(starterUpgradeListeners.size).toBe(1);
    const loadsBefore = vi.mocked(loadHomeDeckSummaries).mock.calls.length;

    // No focus: the App-level foreground run replaced the starter pack.
    await act(async () => {
      for (const listener of [...starterUpgradeListeners]) listener(['aws-saa-c03']);
    });
    await flush();
    await flush();
    expect(vi.mocked(loadHomeDeckSummaries).mock.calls.length).toBeGreaterThan(loadsBefore);

    act(() => tree.unmount());
    expect(starterUpgradeListeners.size).toBe(0);
  });
});
