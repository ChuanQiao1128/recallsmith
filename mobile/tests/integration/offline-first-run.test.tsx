// R24-00 §2.2 end to end: a fresh install with no network finishes onboarding, the starter lesson
// (5 cards) and the first pack from the bundled starter pack, then the full deck replaces it when
// the manifest becomes reachable, keeping progress, the owned set and the lesson record.
//
// The deck repository, the deck cache, the starter module, the wallet, the draw commit and the
// owned gate are all real. Only the network (fetch), the file system (in memory), auth and a few
// leaf side effects are stand-ins. The starter pack is the real bundled JSON.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.test';
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
  const animation = () => ({ start: (cb?: any) => cb?.({ finished: true }), stop: () => {} });
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    FlatList: ({ data = [], renderItem, ListHeaderComponent, ListEmptyComponent, ...props }: any) =>
      React.createElement(
        'FlatList',
        props,
        typeof ListHeaderComponent === 'function' ? React.createElement(ListHeaderComponent) : ListHeaderComponent,
        (data as any[]).length === 0
          ? typeof ListEmptyComponent === 'function'
            ? ListEmptyComponent()
            : ListEmptyComponent
          : null,
        ...(data as any[]).map((item, index) => renderItem({ item, index })),
      ),
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
      spring: animation,
      timing: animation,
      sequence: animation,
      parallel: animation,
      loop: animation,
      delay: animation,
    },
    Easing: { out: (f: any) => f, in: (f: any) => f, inOut: (f: any) => f, cubic: (t: number) => t, quad: (t: number) => t, linear: (t: number) => t },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    Alert: { alert: vi.fn() },
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
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

vi.mock('../../src/config/featureFlags', () => {
  const flags = {
    mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false },
    paywall: { hidden: false },
    ceremony: { seamOfLight: true, forceFallback: false },
    mistakeBook: { enabled: true, relatedCount: 3 },
    cardSource: { enabled: true },
  };
  // R24 F03: the scheduler and the progress push read isFsrsEnabled (FSRS unless the flags turn it off).
  return { useFeatureFlags: () => flags, getFeatureFlags: () => flags, isFsrsEnabled: () => true };
});

// In-memory AsyncStorage.
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
    multiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, store.get(key) ?? null])),
    multiSet: vi.fn(async (pairs: Array<[string, string]>) => {
      for (const [key, value] of pairs) store.set(key, value);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => store.delete(key));
    }),
  },
}));

// In-memory file system. downloadAsync copies a file:// source (what iOS does) and fetches the rest.
const files = new Map<string, string>();
const dirs = new Set<string>();
const asDirUri = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async (uri: string) => {
    if (!files.has(uri)) throw new Error(`ENOENT: ${uri}`);
    return files.get(uri)!;
  }),
  writeAsStringAsync: vi.fn(async (uri: string, content: string) => {
    files.set(uri, content);
  }),
  deleteAsync: vi.fn(async (uri: string) => {
    files.delete(uri);
    const dirUri = asDirUri(uri);
    dirs.delete(dirUri);
    for (const k of [...files.keys()]) if (k.startsWith(dirUri)) files.delete(k);
  }),
  moveAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
    files.set(to, files.get(from)!);
    files.delete(from);
  }),
  getInfoAsync: vi.fn(async (uri: string) => {
    if (files.has(uri)) return { exists: true, isDirectory: false, uri };
    const dirUri = asDirUri(uri);
    const isDir = dirs.has(dirUri) || [...files.keys()].some((k) => k.startsWith(dirUri));
    return { exists: isDir, isDirectory: isDir, uri };
  }),
  makeDirectoryAsync: vi.fn(async (uri: string) => {
    dirs.add(asDirUri(uri));
  }),
  readDirectoryAsync: vi.fn(async () => []),
  downloadAsync: vi.fn(async (url: string, fileUri: string) => {
    if (url.startsWith('file://')) {
      if (!files.has(url)) throw new Error(`ENOENT: ${url}`);
      files.set(fileUri, files.get(url)!);
      return { status: 200, uri: fileUri };
    }
    const resp = await fetch(url, { method: 'GET' });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`download_failed_http_${resp.status}`);
    files.set(fileUri, text);
    return { status: resp.status, uri: fileUri };
  }),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async () => ''),
}));

// Signed out on a fresh install: the deck user key is 'anon'.
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => ({})),
}));

vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/premium/premiumStore', () => ({
  getIsPremiumUser: vi.fn(async () => false),
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(async () => {}),
}));

vi.mock('../../src/premium/revenuecat', () => ({
  rcGetCustomerInfoSafe: vi.fn(async () => null),
  isPremiumActive: vi.fn(() => false),
}));

vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: vi.fn(async () => {}),
}));

// No token on a fresh install: the real module queues and skips; the stand-in records the calls.
vi.mock('../../src/sync/progressSync', () => ({
  recordReviewEvent: vi.fn(async () => 'evt-1'),
  scheduleProgressSync: vi.fn(async () => {}),
  applyCachedRemoteProgress: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/mistakes/mistakeBook', () => ({
  recordMistakeOutcome: vi.fn(async () => {}),
}));

import { AudienceSurveyScreen } from '../../src/screens/AudienceSurveyScreen';
import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { DrawScreen } from '../../src/screens/DrawScreen';
import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { setActiveDeckSlug } from '../../src/content/activeDeck';
import { invalidateDeckCache, getCachedDeck } from '../../src/content/deckCache';
import { STARTER_BUILD, STARTER_PACKS } from '../../src/content/starter';
import {
  STARTER_UPGRADE_BACKOFF_MS,
  ensureStarterDeckInstalled,
  resetStarterUpgradeBackoff,
  upgradeStarterDecks,
} from '../../src/content/starterOffline';
import { pickStarterUids, STARTER_LESSON_KEY } from '../../src/features/gacha/starter/starterGate';
import { STARTER_COPY } from '../../src/features/gacha/starter/starterCopy';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { loadDeckWallet } from '../../src/features/gacha/rewards/deckWallet';
import { loadDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { loadDeckProgress } from '../../src/review/storage';
import {
  loadHomeDeckSummaries,
  resetAutoUpdateAttemptsForTests,
  resetLastKnownDeckUpdatesForTests,
} from '../../src/features/gacha/home/deckActionResolver';

const SLUG = 'aws-saa-c03' as const;
const PACK = STARTER_PACKS[SLUG];
const FULL_BUILD = STARTER_BUILD[SLUG];
const BASE = 'https://cdn.test';
const MANIFEST_URL = `${BASE}/content/manifest.json`;
const DECK_PATH = `decks/${SLUG}/builds/${FULL_BUILD}/deck.json`;
const DECK_URL = `${BASE}/content/${DECK_PATH}`;
const META_KEY = `devcards:content:deckmeta:v2:anon:${SLUG}`;
const STAGE_KEY = 'recallsmith:onboarding:stage:v1';

// The live build the pack was cut from: the same cards (uids, revisions) plus the rest of the deck.
const EXTRA_CARDS = Array.from({ length: 12 }, (_, i) => ({
  stableUid: `full-only-${i + 1}`,
  orderInDeck: PACK.cards[PACK.cards.length - 1].orderInDeck + i + 1,
  difficulty: 2,
  question: `Full deck question ${i + 1}`,
  explanation: `Full deck answer ${i + 1}`,
  codeLanguage: '',
  codeSnippet: '',
  realWorldUsage: '',
  revision: 1,
}));
const FULL_DECK = { ...PACK, version: FULL_BUILD, cards: [...PACK.cards, ...EXTRA_CARDS], totalCards: PACK.cards.length + EXTRA_CARDS.length };
const MANIFEST = {
  schemaVersion: 2,
  generatedAtMs: 1,
  prefix: 'content',
  decks: [
    {
      slug: SLUG,
      title: PACK.title,
      locale: PACK.locale,
      deckType: 1,
      tier: 'free',
      availability: 'live',
      downloadMode: 'public',
      version: FULL_BUILD,
      buildId: FULL_BUILD,
      totalCards: FULL_DECK.totalCards,
      path: DECK_PATH,
      sha256: null,
    },
  ],
};

let online = false;
const fetchCalls: string[] = [];
const fetchMock = vi.fn(async (input: any) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? input);
  fetchCalls.push(url);
  if (!online) throw new TypeError('Network request failed');
  const body = url === MANIFEST_URL ? MANIFEST : url === DECK_URL ? FULL_DECK : null;
  if (!body) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
});

const FIXED_NOW_MS = new Date(2026, 9, 2, 9, 0, 0).getTime();
const LESSON_UIDS = pickStarterUids(PACK.cards.map((c) => ({ StableUid: c.stableUid, OrderInDeck: c.orderInDeck, Mcq: c.mcq })));
const questionOf = (uid: string) => PACK.cards.find((c) => c.stableUid === uid)!.question;

async function flush(rounds = 3) {
  for (let r = 0; r < rounds; r += 1) {
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
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

async function pressLabel(tree: renderer.ReactTestRenderer, label: string) {
  await act(async () => {
    findPressableByLabel(tree, label).props.onPress();
    await Promise.resolve();
  });
  await flush(1);
}

function shownStudyQuestion(tree: renderer.ReactTestRenderer): string {
  const shown = tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props?.testID === 'learning-study-question',
  );
  expect(shown).toHaveLength(1);
  return String(shown[0].props.children);
}

async function finishOnboarding() {
  const replace = vi.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<AudienceSurveyScreen navigation={{ replace } as any} route={{ key: 'audience', name: 'AudienceSurvey' } as any} />);
  });
  await pressLabel(tree, 'Continue');
  await pressLabel(tree, 'Finish setup');
  expect(replace).toHaveBeenCalledWith('Home');
  expect(store.get(STAGE_KEY)).toBe('starter');
  act(() => tree.unmount());
}

async function runStarterLesson() {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <SessionCardScreen
        navigation={navigation}
        route={{ key: 'session-card', name: 'SessionCard', params: { slug: SLUG, mode: 'learn-new' } } as any}
      />,
    );
  });
  await flush();

  // The deck was missing and the network is down: the bundled pack is installed and announced.
  expect(hasText(tree, STARTER_COPY.offlineTitle)).toBe(false);
  expect(hasText(tree, STARTER_COPY.offlineStarterNotice)).toBe(true);

  const studied: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    studied.push(shownStudyQuestion(tree));
    await act(async () => {
      tree.root.find((node) => node.props?.testID === 'learning-study-got-it' && (node.type as any) === 'Pressable').props.onPress();
      await Promise.resolve();
    });
    await flush(1);
  }
  expect(studied).toEqual(LESSON_UIDS.map(questionOf));

  for (let i = 0; i < 5; i += 1) {
    await pressLabel(tree, 'Reveal answer');
    await pressLabel(tree, 'Remembered');
  }
  expect(navigation.replace).toHaveBeenCalledWith('Draw', { slug: SLUG, rewardPending: true });
  act(() => tree.unmount());
}

async function openFirstPack() {
  const navigate = vi.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <DrawScreen
        navigation={{ goBack: vi.fn(), navigate, replace: vi.fn() } as any}
        route={{ key: 'draw', name: 'Draw', params: { slug: SLUG, rewardPending: true } } as any}
      />,
    );
  });
  await flush();
  const swipeZone = tree.root.findByProps({ testID: 'draw-card-stack-stage' });
  act(() => {
    swipeZone.props.onResponderGrant({ nativeEvent: { pageX: 10 } });
    swipeZone.props.onResponderRelease({ nativeEvent: { pageX: 120 } });
  });
  // The first pack is three single draws; Open 1 is the secondary action.
  await act(async () => {
    tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
    await Promise.resolve();
  });
  await flush();
  act(() => tree.unmount());
  return navigate;
}

describe('offline first run with the bundled starter pack (R24 §2.2)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store.clear();
    await setActiveDeckSlug(null);
    files.clear();
    dirs.clear();
    fetchCalls.length = 0;
    online = false;
    vi.stubGlobal('fetch', fetchMock);
    invalidateDeckCache();
    invalidateDrawStateCache();
    resetSessionStore();
    resetStarterUpgradeBackoff();
    resetAutoUpdateAttemptsForTests();
    resetLastKnownDeckUpdatesForTests();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW_MS);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('goes onboarding -> starter lesson (5 cards) -> Draw -> result with no network, and Home shows the deck', async () => {
    await finishOnboarding();
    await runStarterLesson();

    // The bundled pack is installed through the normal repository install, under its own version.
    expect(JSON.parse(store.get(META_KEY)!)).toMatchObject({ buildId: PACK.version, cardCount: PACK.cards.length });
    expect(store.get(STAGE_KEY)).toBe('done');
    expect(await loadDeckWallet(SLUG)).toEqual({ availablePulls: 3, reservePulls: 0 });

    const navigate = await openFirstPack();
    expect(navigate).toHaveBeenCalledWith('DrawCeremony', expect.objectContaining({ slug: SLUG }));
    const ceremony = navigate.mock.calls.find((call) => call[0] === 'DrawCeremony')![1];
    const drawn: string[] = ceremony.drawResult.cards.map((c: any) => c.stableUid);
    expect(drawn.length).toBeGreaterThan(0);
    const packUids = new Set(PACK.cards.map((c) => c.stableUid));
    for (const uid of drawn) {
      expect(packUids.has(uid)).toBe(true);
      expect(LESSON_UIDS).not.toContain(uid);
    }
    expect(drawn).toHaveLength(1);
    expect((await loadDrawState(SLUG)).owned.sort()).toEqual([...drawn].sort());
    expect(await loadDeckWallet(SLUG)).toEqual({ availablePulls: 2, reservePulls: 0 });

    // Every network attempt failed; nothing reached the deck download.
    expect(fetchCalls.every((url) => url === MANIFEST_URL)).toBe(true);

    // Home with no manifest: the installed deck is on the shelf, studiable.
    const summary = await loadHomeDeckSummaries({ premium: false, remote: true });
    expect(summary.deckSummaries.map((d) => [d.slug, d.canStudy])).toEqual([[SLUG, true]]);
  });

  it('replaces the starter deck with the full deck once the manifest is reachable, keeping progress, owned cards and the lesson', async () => {
    await finishOnboarding();
    await runStarterLesson();
    await openFirstPack();

    const lessonBefore = store.get(STARTER_LESSON_KEY);
    const ownedBefore = [...(await loadDrawState(SLUG)).owned].sort();
    const starterDeck = (await getCachedDeck(SLUG))!;
    expect(starterDeck.Version).toBe(PACK.version);
    const progressBefore = (await loadDeckProgress(starterDeck)).filter((p) => (p.lastReviewedAt ?? 0) > 0);
    expect(progressBefore.map((p) => p.stableUid).sort()).toEqual([...LESSON_UIDS].sort());

    // Still offline: one attempt, then the backoff holds the next call off the network.
    expect(await upgradeStarterDecks()).toEqual([]);
    const offlineAttempts = fetchCalls.length;
    expect(offlineAttempts).toBeGreaterThan(0);
    online = true;
    expect(await upgradeStarterDecks()).toEqual([]);
    expect(fetchCalls.length).toBe(offlineAttempts);
    expect((await getCachedDeck(SLUG))!.Version).toBe(PACK.version);

    // Five minutes later the manifest answers and the full deck goes in through the normal path.
    vi.setSystemTime(FIXED_NOW_MS + STARTER_UPGRADE_BACKOFF_MS + 1);
    expect(await upgradeStarterDecks()).toEqual([SLUG]);
    expect(fetchCalls).toContain(DECK_URL);

    const fullDeck = (await getCachedDeck(SLUG))!;
    expect(fullDeck.Version).toBe(FULL_BUILD);
    expect(fullDeck.Cards).toHaveLength(FULL_DECK.cards.length);
    expect(JSON.parse(store.get(META_KEY)!).buildId).toBe(FULL_BUILD);

    // Same uids and revisions: the learner's record carries over untouched.
    expect(store.get(STARTER_LESSON_KEY)).toBe(lessonBefore);
    expect([...(await loadDrawState(SLUG)).owned].sort()).toEqual(ownedBefore);
    const progressAfter = (await loadDeckProgress(fullDeck)).filter((p) => (p.lastReviewedAt ?? 0) > 0);
    expect(progressAfter).toEqual(progressBefore);

    // Nothing left to upgrade.
    vi.setSystemTime(FIXED_NOW_MS + 2 * STARTER_UPGRADE_BACKOFF_MS + 2);
    const callsAfter = fetchCalls.length;
    expect(await upgradeStarterDecks()).toEqual([]);
    expect(fetchCalls.length).toBe(callsAfter);
  });

  it('online, the normal install wins: the full deck installs and no starter notice shows', async () => {
    online = true;
    await finishOnboarding();
    const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={navigation}
          route={{ key: 'session-card', name: 'SessionCard', params: { slug: SLUG, mode: 'learn-new' } } as any}
        />,
      );
    });
    await flush();
    expect(hasText(tree, STARTER_COPY.offlineStarterNotice)).toBe(false);
    expect(shownStudyQuestion(tree)).toBe(questionOf(LESSON_UIDS[0]));
    expect(JSON.parse(store.get(META_KEY)!).buildId).toBe(FULL_BUILD);
    act(() => tree.unmount());
  });

  it('ensureStarterDeckInstalled: installs once, then reports the installed deck; unknown slugs have no pack', async () => {
    expect(await ensureStarterDeckInstalled('csharp-basics')).toBe('installed-starter');
    expect(await ensureStarterDeckInstalled('csharp-basics')).toBe('already-installed');
    expect((await getCachedDeck('csharp-basics'))!.Cards).toHaveLength(STARTER_PACKS['csharp-basics'].cards.length);
    expect(await ensureStarterDeckInstalled('not-a-bundled-deck')).toBe('unavailable');
    // The temporary copy in the cache directory is cleaned up.
    expect([...files.keys()].filter((k) => k.startsWith('file:///cache/'))).toEqual([]);
  });

  it('Draw opens the bundled pack when the deck is missing and the network is down', async () => {
    store.set(STAGE_KEY, 'done');
    await setActiveDeckSlug(SLUG);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen
          navigation={{ goBack: vi.fn(), navigate: vi.fn(), replace: vi.fn() } as any}
          route={{ key: 'draw', name: 'Draw', params: { slug: SLUG } } as any}
        />,
      );
    });
    await flush();
    expect(hasText(tree, 'No active pack yet')).toBe(false);
    expect(tree.root.findAllByProps({ testID: 'draw-card-stack-stage' }).length).toBeGreaterThan(0);
    expect(JSON.parse(store.get(META_KEY)!).buildId).toBe(PACK.version);
    act(() => tree.unmount());
  });

  it('Library shows the bundled pack when the deck is missing and the network is down', async () => {
    store.set(STAGE_KEY, 'done');
    await setActiveDeckSlug(SLUG);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <LibraryScreen
          navigation={{ goBack: vi.fn(), navigate: vi.fn(), replace: vi.fn(), setParams: vi.fn() } as any}
          route={{ key: 'library', name: 'Library', params: {} } as any}
        />,
      );
    });
    await flush();
    expect(tree.root.findAllByProps({ testID: 'library-unavailable-state' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'library-card-grid' }).length).toBeGreaterThan(0);
    expect(JSON.parse(store.get(META_KEY)!).buildId).toBe(PACK.version);
    act(() => tree.unmount());
  });

  it('a deck with no bundled pack keeps its offline error in Draw and Library', async () => {
    store.set(STAGE_KEY, 'done');
    await setActiveDeckSlug('not-a-bundled-deck');
    let library!: renderer.ReactTestRenderer;
    await act(async () => {
      library = renderer.create(
        <LibraryScreen
          navigation={{ goBack: vi.fn(), navigate: vi.fn(), replace: vi.fn(), setParams: vi.fn() } as any}
          route={{ key: 'library', name: 'Library', params: {} } as any}
        />,
      );
    });
    await flush();
    expect(library.root.findAllByProps({ testID: 'library-unavailable-state' }).length).toBeGreaterThan(0);
    expect(hasText(library, 'This deck is not available on this device yet.')).toBe(true);
    act(() => library.unmount());

    let draw!: renderer.ReactTestRenderer;
    await act(async () => {
      draw = renderer.create(
        <DrawScreen
          navigation={{ goBack: vi.fn(), navigate: vi.fn(), replace: vi.fn() } as any}
          route={{ key: 'draw', name: 'Draw', params: { slug: 'not-a-bundled-deck' } } as any}
        />,
      );
    });
    await flush();
    expect(hasText(draw, 'No active pack yet')).toBe(true);
    expect(store.has(META_KEY)).toBe(false);
    act(() => draw.unmount());
  });
});
