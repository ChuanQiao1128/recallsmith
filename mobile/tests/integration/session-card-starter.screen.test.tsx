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


const deckRepo = vi.hoisted(() => ({
  resolveDeckBySlug: vi.fn(async (_slug: string): Promise<any> => null),
  listManifestDecks: vi.fn(async () => [] as any[]),
  checkManifestForUpdates: vi.fn(async (): Promise<any> => ({})),
  installDeckFromUrl: vi.fn(async (..._args: any[]): Promise<boolean> => true),
}));
vi.mock('../../src/content/deckRepository', () => deckRepo);

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

// Progress lives in memory; the scope helpers, wallet and ledger keys stay real (review/storage).
let progressState: any[] = [];
vi.mock('../../src/review/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/review/storage')>();
  return {
    ...actual,
    loadDeckProgress: vi.fn(async () => progressState.map((entry) => ({ ...entry }))),
    saveDeckProgress: vi.fn(async (_deck: any, next: any[]) => {
      progressState = next.map((entry) => ({ ...entry }));
    }),
    loadOrInitDailyStats: vi.fn(async () => ({ dateKey: '2026-10-02', plannedCount: 0, doneCount: 0 })),
  };
});

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

vi.mock('../../src/features/gacha/mistakes/mistakeBook', () => ({
  recordMistakeOutcome: vi.fn(async () => {}),
}));

// R22 §4 end to end: the planner, the owned gate, the starter module, the R1 settle and the pack
// wallet are all real here. Only storage, sync and the deck source are stand-ins.

import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { ensureDeckBootstrap, loadDeckWallet } from '../../src/features/gacha/rewards/deckWallet';
import { loadDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { recordReviewEvent } from '../../src/sync/progressSync';

const FIXED_NOW_MS = new Date(2026, 9, 2, 9, 0, 0).getTime();
const STAGE_KEY = 'recallsmith:onboarding:stage:v1';
const PROMPT_KEY = 'notifications:permission-prompt:pending:v1';
const GOAL_KEY = 'recallsmith:study-goal:v1';
const LESSON_KEY = 'recallsmith:starter-lesson:v1';

function flags() {
  return {
    mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false },
    paywall: { hidden: false },
    ceremony: { seamOfLight: true, forceFallback: false },
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

function findPressableByLabel(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

function hasText(tree: renderer.ReactTestRenderer, text: string): boolean {
  return tree.root.findAll((node) => (node.type as any) === 'Text' && node.props.children === text).length > 0;
}

const card = (uid: string, order: number) => ({
  StableUid: uid,
  OrderInDeck: order,
  Difficulty: 1,
  Question: `Question ${uid}`,
  Explanation: `Answer ${uid}`,
});

// The deck opens with an MCQ card: the lesson skips it and teaches c1..c5.
const MCQ_CARD = {
  ...card('m0', 0),
  Mcq: {
    v: 1,
    options: [
      { key: 'a', why: 'Not this one.', text: 'Option a', correct: false },
      { key: 'b', why: null, text: 'Option b', correct: true },
      { key: 'c', why: 'Not this one.', text: 'Option c', correct: false },
    ],
    shuffle: true,
    qualifier: null,
  },
};
const CARDS = [MCQ_CARD, card('c1', 1), card('c2', 2), card('c3', 3), card('c4', 4), card('c5', 5), card('c6', 6)];
const DECK = { Slug: 'csharp', Title: 'C# Interview', Locale: 'en-US', Version: '1', DeckType: 1, TotalCards: CARDS.length, Cards: CARDS };
const untouched = (uid: string) => ({ stableUid: uid, stage: 0, nextReviewAt: 0 });
const learned = (uid: string) => ({ stableUid: uid, stage: 1, lastReviewedAt: FIXED_NOW_MS - 1_000, nextReviewAt: FIXED_NOW_MS + 86_400_000 });

describe('SessionCardScreen starter lesson', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    invalidateDrawStateCache();
    resetSessionStore();
    featureFlagsMock.mockReturnValue(flags());
    deckRepo.resolveDeckBySlug.mockResolvedValue(DECK);
    deckRepo.checkManifestForUpdates.mockResolvedValue({});
    deckRepo.installDeckFromUrl.mockResolvedValue(true);
    deckRepo.listManifestDecks.mockResolvedValue([]);
    progressState = CARDS.map((c) => untouched(c.StableUid));
    store.set(STAGE_KEY, 'starter');
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

  async function mount(slug = 'csharp') {
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{ key: 'session-card', name: 'SessionCard', params: { slug, mode: 'learn-new' } } as any}
        />,
      );
    });
    await flush();
    await flush();
    return { tree, navigation };
  }

  async function pressLabel(tree: renderer.ReactTestRenderer, label: string) {
    await act(async () => {
      findPressableByLabel(tree, label).props.onPress();
      await Promise.resolve();
    });
    await flush();
  }

  // R22 §6 (S01/S02): a never-reviewed Q/A card opens on the study view with one Got it; it comes
  // back at the end of the run as a recall check, asked with Forgot / Remembered.
  async function studyGotIt(tree: renderer.ReactTestRenderer) {
    await act(async () => {
      tree.root.find((node) => node.props?.testID === 'learning-study-got-it' && (node.type as any) === 'Pressable').props.onPress();
      await Promise.resolve();
    });
    await flush();
  }

  async function checkRemembered(tree: renderer.ReactTestRenderer) {
    await pressLabel(tree, 'Reveal answer');
    await pressLabel(tree, 'Remembered');
  }

  it('teaches the first 5 non-MCQ cards with nothing drawn, then opens Draw with the 3-pull bootstrap', async () => {
    const { tree, navigation } = await mount();

    // Study: c1..c5 on the study view (the MCQ is skipped). Got it records nothing.
    const studied: string[] = [];
    for (const uid of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      expect(hasText(tree, `Question ${uid}`)).toBe(true);
      expect(tree.root.findAll((node) => node.props?.testID === 'learning-study-view').length).toBeGreaterThan(0);
      // F01 y-tests-4: record the card the screen actually presents, not the loop variable.
      const shown = tree.root.findAll(
        (node) => typeof node.type === 'string' && node.props?.testID === 'learning-study-question',
      );
      expect(shown).toHaveLength(1);
      studied.push(String(shown[0].props.children).replace(/^Question /, ''));
      await studyGotIt(tree);
      expect(recordReviewEvent).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    }
    expect(studied).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);

    // Checks, in study order. The lesson completes only on the 5th; no R1 pull for any of them.
    const checked: string[] = [];
    for (const uid of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      expect(hasText(tree, `Question ${uid}`)).toBe(true);
      expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 0, reservePulls: 0 });
      expect(navigation.replace).not.toHaveBeenCalled();
      checked.push(uid);
      await checkRemembered(tree);
    }
    expect(checked).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);

    // One card_reviewed per check: reviewStage learning_check, Remembered → hard.
    expect(vi.mocked(recordReviewEvent).mock.calls.map((call) => {
      const event = call[0] as any;
      return [event.stableUid, event.reviewStage, event.rating];
    })).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'].map((uid) => [uid, 'learning_check', 'hard']));

    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
    expect(navigation.replace).not.toHaveBeenCalledWith('SessionSummary', expect.anything());
    expect(store.get(STAGE_KEY)).toBe('done');
    // Net 3 pulls: the bootstrap, and nothing for the five lesson cards.
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 3, reservePulls: 0 });
    // The reminder prompt is armed at completion; DrawResult's first Done shows it.
    expect(store.get(PROMPT_KEY)).toBe('1');
    // The lesson cards keep their progress and were never written into the draw state.
    expect((await loadDrawState('csharp')).owned).toEqual([]);
    expect(progressState.filter((p) => (p.lastReviewedAt ?? 0) > 0).map((p) => p.stableUid)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('finishes straight away when every lesson card is already studied (closed before the reward)', async () => {
    progressState = CARDS.map((c) => (['c1', 'c2', 'c3', 'c4', 'c5'].includes(c.StableUid) ? learned(c.StableUid) : untouched(c.StableUid)));
    const { navigation } = await mount();
    expect(navigation.replace).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
    expect(store.get(STAGE_KEY)).toBe('done');
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 3, reservePulls: 0 });
  });

  it('downloads the deck first when it is not installed, showing the installing state', async () => {
    let finishInstall!: (ok: boolean) => void;
    deckRepo.resolveDeckBySlug.mockResolvedValue(null);
    deckRepo.checkManifestForUpdates.mockResolvedValue({
      csharp: { remoteUrl: 'https://example.invalid/csharp.json', remoteVersion: '1', remoteSha256: null },
    });
    deckRepo.installDeckFromUrl.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishInstall = resolve;
        }),
    );

    const { tree } = await mount();
    expect(hasText(tree, 'Downloading pack…')).toBe(true);

    deckRepo.resolveDeckBySlug.mockResolvedValue(DECK);
    await act(async () => {
      finishInstall(true);
    });
    await flush();
    await flush();

    expect(hasText(tree, 'Downloading pack…')).toBe(false);
    expect(hasText(tree, 'Question c1')).toBe(true);
  });

  it('explains an offline first run and recovers on Retry', async () => {
    deckRepo.resolveDeckBySlug.mockResolvedValue(null);
    deckRepo.checkManifestForUpdates.mockRejectedValue(new TypeError('Network request failed'));

    const { tree } = await mount();
    expect(hasText(tree, "Can't download your first lesson")).toBe(true);
    expect(hasText(tree, 'Your first lesson needs a connection to download. Connect to the internet, then tap Retry.')).toBe(true);

    deckRepo.resolveDeckBySlug.mockResolvedValue(DECK);
    await act(async () => {
      tree.root.findByProps({ testID: 'session-card-error-retry' }).props.onPress();
    });
    await flush();
    await flush();
    expect(hasText(tree, 'Question c1')).toBe(true);
  });

  // ─── The way out when the lesson's deck cannot run (F01: h-correctness-1, h-security-1, h-correctness-2) ───
  const errorTitle = (tree: renderer.ReactTestRenderer) =>
    String(tree.root.find((node) => node.props?.testID === 'session-card-error-title' && (node.type as any) === 'Text').props.children);
  const errorBody = (tree: renderer.ReactTestRenderer) =>
    String(tree.root.find((node) => node.props?.testID === 'session-card-error-body' && (node.type as any) === 'Text').props.children);

  async function expectEconomyUnlocked() {
    expect(store.get(STAGE_KEY)).toBe('done');
    expect(store.has(LESSON_KEY)).toBe(false);
    expect(store.get(PROMPT_KEY)).toBe('1');
    // Any never-drawn pack now gets the ordinary first-visit bootstrap.
    expect((await ensureDeckBootstrap('aws-saa-c03')).granted).toBe(3);
  }

  it('a premium goal deck ends the lesson before the paywall, so the other packs are not locked', async () => {
    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'csharp', examDate: null }));
    deckRepo.resolveDeckBySlug.mockResolvedValue({ ...DECK, DeckType: 2 });

    const { navigation } = await mount();

    expect(navigation.replace).toHaveBeenCalledWith('Paywall', { reason: 'Premium required for this deck.' });
    await expectEconomyUnlocked();
  });

  it('a goal deck that is not published yet shows the plain error (not the offline copy) and ends the lesson', async () => {
    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'csharp', examDate: null }));
    deckRepo.listManifestDecks.mockResolvedValue([{ slug: 'csharp', availability: 'coming', eta: null }]);

    const { tree } = await mount();

    expect(errorTitle(tree)).toBe('Deck not available');
    expect(errorBody(tree)).not.toContain('connection');
    expect(hasText(tree, "Can't download your first lesson")).toBe(false);
    await expectEconomyUnlocked();
  });

  it('a goal deck missing from a manifest that did load shows the plain error and ends the lesson', async () => {
    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'csharp', examDate: null }));
    deckRepo.resolveDeckBySlug.mockResolvedValue(null);
    deckRepo.listManifestDecks.mockResolvedValue([{ slug: 'aws-saa-c03', availability: 'available' }]);
    deckRepo.checkManifestForUpdates.mockResolvedValue({
      'aws-saa-c03': { slug: 'aws-saa-c03', remoteUrl: 'https://example.invalid/aws.json', remoteVersion: '1', remoteSha256: null },
    });

    const { tree } = await mount();

    expect(errorTitle(tree)).toBe('Deck not available');
    expect(errorBody(tree)).not.toContain('connection');
    expect(hasText(tree, "Can't download your first lesson")).toBe(false);
    expect(deckRepo.installDeckFromUrl).not.toHaveBeenCalled();
    await expectEconomyUnlocked();
  });

  it('keeps the lesson open and the offline copy when the goal deck download itself fails', async () => {
    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'csharp', examDate: null }));
    deckRepo.resolveDeckBySlug.mockResolvedValue(null);
    deckRepo.checkManifestForUpdates.mockResolvedValue({
      csharp: { slug: 'csharp', remoteUrl: 'https://example.invalid/csharp.json', remoteVersion: '1', remoteSha256: null },
    });
    deckRepo.installDeckFromUrl.mockResolvedValue(false);

    const { tree } = await mount();

    expect(errorTitle(tree)).toBe("Can't download your first lesson");
    expect(store.get(STAGE_KEY)).toBe('starter');
  });

  it('another deck that fails during the lesson keeps its own error, not the first-lesson copy', async () => {
    store.set(GOAL_KEY, JSON.stringify({ deckSlug: 'csharp', examDate: null }));
    deckRepo.resolveDeckBySlug.mockResolvedValue(null);
    deckRepo.checkManifestForUpdates.mockRejectedValue(new TypeError('Network request failed'));

    const { tree } = await mount('aws-saa-c03');

    expect(errorTitle(tree)).toBe('Deck not available');
    expect(hasText(tree, "Can't download your first lesson")).toBe(false);
    // Not the lesson's deck: the lesson stays open for the goal deck.
    expect(store.get(STAGE_KEY)).toBe('starter');
  });

  it('existing users (stage done) get no lesson: nothing owned means nothing to study', async () => {
    store.set(STAGE_KEY, 'done');
    const { tree, navigation } = await mount();
    expect(tree.root.findAll((node) => node.props?.testID === 'session-card-empty-deck').length).toBeGreaterThan(0);
    expect(hasText(tree, 'Question c1')).toBe(false);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(store.get('recallsmith:starter-lesson:v1')).toBeUndefined();
  });
});
