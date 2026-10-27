// R24-00 §2.2 end to end: a fresh install with no network finishes onboarding, the starter lesson
// (5 cards) and the first pack from the bundled starter pack, then the full deck replaces it when
// the manifest becomes reachable, keeping progress, the owned set and the lesson record.
//
// The deck repository, the deck cache, the starter module, the wallet, the draw commit and the
// owned gate are all real. Only the network (fetch), the file system (in memory), auth and a few
// leaf side effects are stand-ins. The starter pack is the real bundled JSON.
import React from 'react';
import { createHash } from 'node:crypto';
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
    TextInput: (props: any) => React.createElement('TextInput', props),
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
let onRead: ((key: string) => void | Promise<void>) | null = null;
let onWrite: ((key: string, value: string) => void | Promise<void>) | null = null;
let authUserSub: string | null = null;
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      const raw = store.get(key) ?? null;
      await onRead?.(key);
      return raw;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      await onWrite?.(key, value);
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
  copyAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
    files.set(to, files.get(from)!);
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
  randomUUID: () => 'offline-review-intent',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_algorithm: string, text: string) => createHash('sha256').update(text).digest('hex')),
}));

// Signed out on a fresh install: the deck user key is 'anon'.
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => authUserSub ? { userSub: authUserSub } : {}),
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
import { invalidateDeckCache, getCachedDeck, installDeckAndInvalidate } from '../../src/content/deckCache';
import { STARTER_BUILD, STARTER_PACKS } from '../../src/content/starter';
import {
  STARTER_UPGRADE_BACKOFF_MS,
  ensureStarterDeckInstalled,
  listInstalledDeckEntries,
  resetStarterUpgradeBackoff,
  subscribeStarterUpgrades,
  upgradeStarterDecks,
} from '../../src/content/starterOffline';
import { STUDY_GOAL_KEY } from '../../src/features/goal/studyGoal';
import { pickStarterUids, STARTER_LESSON_KEY } from '../../src/features/gacha/starter/starterGate';
import { STARTER_COPY } from '../../src/features/gacha/starter/starterCopy';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { DECK_BOOTSTRAP_GRANT, loadDeckWallet, saveDeckWallet } from '../../src/features/gacha/rewards/deckWallet';
import { loadDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { loadDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import { acquireDraw } from '../../src/features/gacha/draw/acquireDraw';
import { flushDrawHistory } from '../../src/features/gacha/draw/drawCommit';
import { readDeckEligibilityUnderLock, MANIFEST_CACHE_KEY, BUNDLED_STARTER_RECEIPT_PREFIX } from '../../src/content/deckEligibility';
import { listManifestDecks, adoptAnonymousPublicDecks } from '../../src/content/deckRepository';
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
const RECEIPT_KEY = `${BUNDLED_STARTER_RECEIPT_PREFIX}anon:${SLUG}`;
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
      await new Promise<void>(resolve => setImmediate(resolve));
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
  // 2026-10-14 three decks: the default goal is AWS fundamentals, which ships no starter pack; this
  // run picks SAA-C03, a bundled pack.
  await act(async () => {
    tree.root.find((node) => (node.type as any) === 'Pressable' && node.props.testID === `goal-choice-${SLUG}`).props.onPress();
    await Promise.resolve();
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

  // Five studies (2026-10-14 learning flow): Show answer, then Got it; the 5th opens Draw.
  const studied: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    studied.push(shownStudyQuestion(tree));
    expect(navigation.replace).not.toHaveBeenCalled();
    await pressLabel(tree, 'Show answer');
    await act(async () => {
      tree.root.find((node) => node.props?.testID === 'learning-study-got-it' && (node.type as any) === 'Pressable').props.onPress();
      await Promise.resolve();
    });
    await flush(1);
  }
  expect(studied).toEqual(LESSON_UIDS.map(questionOf));
  expect(navigation.replace).toHaveBeenCalledTimes(1);
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
  // 2026-10-17 batch open: the first pack is five draws, opened as one five-card batch (the
  // primary action); Open 1 sits beside it.
  const primary = tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
  expect(primary.findAll((node) => (node.type as any) === 'Text' && node.props.children === `Open ${DECK_BOOTSTRAP_GRANT}`)).toHaveLength(1);
  await act(async () => {
    primary.props.onPress();
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
    await flushDrawHistory();
    onRead = null;
    onWrite = null;
    authUserSub = null;
    setActiveUserSubForStorage(null);
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
    expect(DECK_BOOTSTRAP_GRANT).toBe(5);
    expect(await loadDeckWallet(SLUG)).toEqual({ availablePulls: DECK_BOOTSTRAP_GRANT, reservePulls: 0 });

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
    // One ceremony, five distinct cards, all five draws spent on them.
    expect(drawn).toHaveLength(DECK_BOOTSTRAP_GRANT);
    expect(new Set(drawn).size).toBe(DECK_BOOTSTRAP_GRANT);
    expect(navigate.mock.calls.filter((call) => call[0] === 'DrawCeremony')).toHaveLength(1);
    expect((await loadDrawState(SLUG)).owned.sort()).toEqual([...drawn].sort());
    expect(await loadDeckWallet(SLUG)).toEqual({ availablePulls: 0, reservePulls: 0 });

    // The manifest was tried (and failed) before the bundled pack; nothing reached the deck download.
    expect(fetchCalls).toContain(MANIFEST_URL);
    expect(fetchCalls.every((url) => url === MANIFEST_URL)).toBe(true);

    // Home with no manifest: the installed deck is on the shelf, studiable, at the full deck's size.
    const summary = await loadHomeDeckSummaries({ premium: false, remote: true });
    expect(summary.deckSummaries.map((d) => [d.slug, d.canStudy])).toEqual([[SLUG, true]]);
    expect(summary.deckSummaries[0]).toMatchObject({ totalCards: PACK.totalCards, localCards: PACK.cards.length });
    expect(PACK.totalCards).toBeGreaterThan(PACK.cards.length);
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
    // Subscribers (Home) hear about it, whoever started the upgrade (App on foreground, or Home).
    const heard: string[][] = [];
    const unsubscribe = subscribeStarterUpgrades((slugs) => heard.push(slugs));
    vi.setSystemTime(FIXED_NOW_MS + STARTER_UPGRADE_BACKOFF_MS + 1);
    expect(await upgradeStarterDecks()).toEqual([SLUG]);
    expect(heard).toEqual([[SLUG]]);
    unsubscribe();
    expect(fetchCalls).toContain(DECK_URL);

    const fullDeck = (await getCachedDeck(SLUG))!;
    expect(fullDeck.Version).toBe(FULL_BUILD);
    expect(fullDeck.Cards).toHaveLength(FULL_DECK.cards.length);
    expect(JSON.parse(store.get(META_KEY)!).buildId).toBe(FULL_BUILD);
    expect(JSON.parse(store.get(META_KEY)!).bundledStarter).toBeUndefined();

    // Same uids and revisions: the learner's record carries over untouched.
    expect(store.get(STARTER_LESSON_KEY)).toBe(lessonBefore);
    expect([...(await loadDrawState(SLUG)).owned].sort()).toEqual(ownedBefore);
    const progressAfter = (await loadDeckProgress(fullDeck)).filter((p) => (p.lastReviewedAt ?? 0) > 0);
    expect(progressAfter).toEqual(progressBefore);

    // Nothing left to upgrade, and nobody is told about an empty run.
    const heardLater: string[][] = [];
    const unsubscribeLater = subscribeStarterUpgrades((slugs) => heardLater.push(slugs));
    vi.setSystemTime(FIXED_NOW_MS + 2 * STARTER_UPGRADE_BACKOFF_MS + 2);
    const callsAfter = fetchCalls.length;
    expect(await upgradeStarterDecks()).toEqual([]);
    expect(fetchCalls.length).toBe(callsAfter);
    expect(heardLater).toEqual([]);
    expect(heard).toEqual([[SLUG]]);
    unsubscribeLater();
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

  async function installedStarterForDraw() {
    store.set(STAGE_KEY, 'done');
    expect(await ensureStarterDeckInstalled(SLUG)).toBe('installed-starter');
    await saveDeckWallet(SLUG, { availablePulls: 5, reservePulls: 0 });
    return (await getCachedDeck(SLUG))!;
  }

  it('persists exact bundled provenance across a cold read, while sync still sees an unknown manifest', async () => {
    const deck = await installedStarterForDraw();
    const meta = JSON.parse(store.get(META_KEY)!);
    expect(JSON.parse(store.get(RECEIPT_KEY)!)).toEqual({ userSub: 'anon', buildId: PACK.version, fileUri: meta.fileUri, installId: meta.installId });
    expect(store.has(MANIFEST_CACHE_KEY)).toBe(false);
    expect(await readDeckEligibilityUnderLock(SLUG)).toBe('unknown');
    invalidateDeckCache();
    invalidateDrawStateCache();
    const acquired = await acquireDraw(SLUG, 1, { deck: await getCachedDeck(SLUG) });
    expect(acquired.spent).toBe(1);
    expect(acquired.result?.cards).toHaveLength(1);
    expect(PACK.cards.map(c => c.stableUid)).toContain(acquired.result?.cards[0].stableUid);
    expect((await loadDeckWallet(SLUG)).availablePulls).toBe(4);
    expect(deck.Version).toBe(PACK.version);
  });

  it.each(['corrupt-manifest', 'manifest-io', 'missing-entry', 'coming', 'unknown-status', 'retired',
    'missing-meta', 'corrupt-meta', 'meta-io', 'missing-provenance', 'wrong-account', 'wrong-build', 'wrong-file', 'stale-file-marker', 'foreign-file-marker', 'account-switch', 'receipt-io', 'corrupt-receipt', 'wrong-install-id'])(
    'bundled provenance fails closed for %s without ownership or wallet writes', async mode => {
      const deck = await installedStarterForDraw();
      const meta = JSON.parse(store.get(META_KEY)!);
      const receipt = JSON.parse(store.get(RECEIPT_KEY)!);
      if (mode === 'corrupt-manifest') store.set(MANIFEST_CACHE_KEY, '{');
      if (mode === 'missing-entry') store.set(MANIFEST_CACHE_KEY, '{"decks":[]}');
      if (['coming', 'unknown-status', 'retired'].includes(mode)) {
        store.set(MANIFEST_CACHE_KEY, JSON.stringify({ decks: [{ slug: SLUG, availability: mode }] }));
      }
      if (mode === 'missing-meta') store.delete(META_KEY);
      if (mode === 'corrupt-meta') store.set(META_KEY, '{');
      if (mode === 'missing-provenance') store.delete(RECEIPT_KEY);
      if (mode === 'corrupt-receipt') store.set(RECEIPT_KEY, '{');
      if (mode === 'wrong-install-id') { receipt.installId = 'stale-install'; store.set(RECEIPT_KEY, JSON.stringify(receipt)); }
      if (mode === 'wrong-account') receipt.userSub = 'someone-else';
      if (mode === 'wrong-build') meta.buildId = FULL_BUILD;
      if (mode === 'wrong-file') meta.fileUri = 'file:///docs/other.json';
      if (mode === 'stale-file-marker') receipt.fileUri = 'file:///docs/other.json';
      if (mode === 'foreign-file-marker') meta.fileUri = receipt.fileUri = 'file:///docs/other.json';
      if (mode === 'account-switch') onRead = key => { if (key === META_KEY) setActiveUserSubForStorage('user-b'); };
      if (['missing-provenance', 'wrong-account', 'wrong-build', 'wrong-file', 'stale-file-marker', 'foreign-file-marker'].includes(mode)) {
        store.set(META_KEY, JSON.stringify(meta));
        if (mode !== 'missing-provenance') store.set(RECEIPT_KEY, JSON.stringify(receipt));
      }
      if (mode.endsWith('-io')) onRead = key => {
        if (key === (mode === 'manifest-io' ? MANIFEST_CACHE_KEY : mode === 'receipt-io' ? RECEIPT_KEY : META_KEY)) throw Error('IO');
      };
      const wallet = store.get('devcards:u:anon:recallsmith:deck-wallets:v1');
      const state = store.get(`devcards:u:anon:devcards:draw-state:${SLUG}`);
      const write = vi.fn(); onWrite = write;
      await expect(acquireDraw(SLUG, 1, { deck })).rejects.toThrow();
      expect(store.get('devcards:u:anon:recallsmith:deck-wallets:v1')).toBe(wallet);
      expect(store.get(`devcards:u:anon:devcards:draw-state:${SLUG}`)).toBe(state);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it('actual retirement removes bundled provenance and cannot be revived by removing the manifest', async () => {
    const deck = await installedStarterForDraw();
    store.set(MANIFEST_CACHE_KEY, JSON.stringify({ ...MANIFEST, decks: [{ ...MANIFEST.decks[0], availability: 'retired', retiredAtMs: FIXED_NOW_MS }] }));
    await listManifestDecks({ preferRemote: false });
    expect(store.has(META_KEY)).toBe(false);
    expect(store.has(RECEIPT_KEY)).toBe(false);
    await expect(acquireDraw(SLUG, 1, { deck })).rejects.toThrow();
    store.delete(MANIFEST_CACHE_KEY);
    await expect(acquireDraw(SLUG, 1, { deck })).rejects.toThrow();
    expect((await loadDeckWallet(SLUG)).availablePulls).toBe(5);
  });

  it('a failed provenance write denies spending, then a retry verifies the actual bundle before attesting', async () => {
    store.set(STAGE_KEY, 'done');
    onWrite = key => { if (key === RECEIPT_KEY) throw Error('disk full'); };
    expect(await ensureStarterDeckInstalled(SLUG)).toBe('unavailable');
    expect(store.has(RECEIPT_KEY)).toBe(false);
    await saveDeckWallet(SLUG, { availablePulls: 5, reservePulls: 0 });
    const deck = await getCachedDeck(SLUG);
    await expect(acquireDraw(SLUG, 1, { deck })).rejects.toThrow();
    expect((await loadDeckWallet(SLUG)).availablePulls).toBe(5);
    onWrite = null;
    expect(await ensureStarterDeckInstalled(SLUG)).toBe('already-installed');
    expect((await acquireDraw(SLUG, 1, { deck })).spent).toBe(1);
  });

  it('an unsuccessful install meta write cannot attest the bundle or spend pulls', async () => {
    store.set(STAGE_KEY, 'done');
    await saveDeckWallet(SLUG, { availablePulls: 5, reservePulls: 0 });
    onWrite = key => { if (key === META_KEY) throw Error('disk full'); };
    expect(await ensureStarterDeckInstalled(SLUG)).toBe('unavailable');
    expect(store.has(META_KEY)).toBe(false);
    await expect(acquireDraw(SLUG, 1)).rejects.toThrow();
    expect((await loadDeckWallet(SLUG)).availablePulls).toBe(5);
    expect(store.has(`devcards:u:anon:devcards:draw-state:${SLUG}`)).toBe(false);
  });

  it('an unrecognized remote slug cannot use a lookalike bundled receipt without a manifest', async () => {
    const deck = await installedStarterForDraw();
    const slug = 'remote-unknown';
    const fileUri = `file:///docs/devcards-decks-v2/anon/${slug}.json`;
    store.set(`devcards:content:deckmeta:v2:anon:${slug}`, JSON.stringify({ slug, buildId: PACK.version, fileUri }));
    store.set(`${BUNDLED_STARTER_RECEIPT_PREFIX}anon:${slug}`, JSON.stringify({ userSub: 'anon', buildId: PACK.version, fileUri, installId: null }));
    await saveDeckWallet(slug, { availablePulls: 5, reservePulls: 0 });
    await expect(acquireDraw(slug, 1, { deck: { ...deck, Slug: slug } })).rejects.toThrow();
    expect((await loadDeckWallet(slug)).availablePulls).toBe(5);
    expect(store.has(`devcards:u:anon:devcards:draw-state:${slug}`)).toBe(false);
  });

  it.each(['different-build', 'same-build-path', 'failed-late-receipt'])('full replacement wins during the final attestation await: %s', async mode => {
    const stale = await installedStarterForDraw();
    const original = JSON.parse(store.get(META_KEY)!);
    store.delete(RECEIPT_KEY);
    const replacementVersion = mode === 'same-build-path' ? PACK.version : FULL_BUILD;
    const replacement = { ...FULL_DECK, version: replacementVersion };
    const source = 'file:///cache/concurrent-full.json';
    files.set(source, JSON.stringify(replacement));
    let manifestReads = 0;
    let replaced = false;
    if (mode === 'failed-late-receipt') onWrite = key => { if (key === RECEIPT_KEY) throw Error('disk full'); };
    onRead = async key => {
      if (key === MANIFEST_CACHE_KEY && ++manifestReads === 2) {
        // Metadata was checked; publication completes while the final manifest read is pending.
        expect(await installDeckAndInvalidate(SLUG, source, mode === 'same-build-path' ? null : replacementVersion, null)).toBe(true);
        replaced = true;
        expect(JSON.parse(store.get(META_KEY)!).buildId).toBe(replacementVersion);
        expect(JSON.parse(store.get(META_KEY)!).bundledStarter).toBeUndefined();
      }
    };
    await ensureStarterDeckInstalled(SLUG);
    onRead = null;
    expect(replaced).toBe(true);
    expect(files.get(original.fileUri)).toBe(JSON.stringify(replacement));
    expect(JSON.parse(store.get(META_KEY)!).buildId).toBe(replacementVersion);
    expect(JSON.parse(store.get(META_KEY)!).installId).not.toBe(original.installId);
    if (mode === 'failed-late-receipt') expect(store.has(RECEIPT_KEY)).toBe(false);
    else expect(JSON.parse(store.get(RECEIPT_KEY)!).installId).toBe(original.installId);
    await expect(acquireDraw(SLUG, 1, { deck: stale })).rejects.toThrow();
    expect((await loadDeckWallet(SLUG)).availablePulls).toBe(5);
    expect(store.has(`devcards:u:anon:devcards:draw-state:${SLUG}`)).toBe(false);
  });

  it('a failed final metadata write denies spending and a same-version retry publishes a drawable file record', async () => {
    const stale = await installedStarterForDraw();
    const original = JSON.parse(store.get(META_KEY)!);
    const source = 'file:///cache/meta-failure-full.json';
    files.set(source, JSON.stringify(FULL_DECK));
    onWrite = (key, value) => {
      const meta = key === META_KEY ? JSON.parse(value) : null;
      if (meta?.buildId === FULL_BUILD && meta.fileUri) throw Error('disk full');
    };
    expect(await installDeckAndInvalidate(SLUG, source, FULL_BUILD, null)).toBe(false);
    expect(files.get(original.fileUri)).toBe(JSON.stringify(FULL_DECK));
    const pending = JSON.parse(store.get(META_KEY)!);
    expect(pending.fileUri).toBe('');
    expect(pending.installId).not.toBe(original.installId);
    onWrite = null;
    await expect(acquireDraw(SLUG, 1, { deck: stale })).rejects.toThrow();
    expect((await loadDeckWallet(SLUG)).availablePulls).toBe(5);
    expect(store.has(`devcards:u:anon:devcards:draw-state:${SLUG}`)).toBe(false);

    // The pending record has the requested build ID, but is not an up-to-date installation.
    expect(await installDeckAndInvalidate(SLUG, source, FULL_BUILD, null)).toBe(true);
    const recovered = JSON.parse(store.get(META_KEY)!);
    expect(recovered).toMatchObject({ buildId: FULL_BUILD, fileUri: original.fileUri, cardCount: FULL_DECK.cards.length });
    expect(typeof recovered.installId).toBe('string');
    expect(recovered.installId).not.toBe(pending.installId);
    expect(files.get(recovered.fileUri)).toBe(JSON.stringify(FULL_DECK));
    const deck = await getCachedDeck(SLUG);
    expect(deck?.Version).toBe(FULL_BUILD);
    expect(deck?.Cards).toHaveLength(FULL_DECK.cards.length);
    await expect(acquireDraw(SLUG, 1, { deck: stale })).rejects.toThrow();
    expect((await loadDeckWallet(SLUG)).availablePulls).toBe(5);
    expect(store.has(`devcards:u:anon:devcards:draw-state:${SLUG}`)).toBe(false);
  });

  it('legacy null-instance receipts require exact read-back and become inert after a fixed-time same-build replacement', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const stale = await installedStarterForDraw();
      const original = JSON.parse(store.get(META_KEY)!);
      delete original.installId;
      store.set(META_KEY, JSON.stringify(original));
      store.delete(RECEIPT_KEY);
      expect(await ensureStarterDeckInstalled(SLUG)).toBe('already-installed');
      expect(JSON.parse(store.get(RECEIPT_KEY)!).installId).toBeNull();
      expect((await acquireDraw(SLUG, 1, { deck: stale })).spent).toBe(1);
      const source = 'file:///cache/same-build.json';
      files.set(source, JSON.stringify(PACK));
      expect(await installDeckAndInvalidate(SLUG, source, null, null)).toBe(true);
      const firstId = JSON.parse(store.get(META_KEY)!).installId;
      expect(typeof firstId).toBe('string');
      expect(firstId.length).toBeGreaterThan(0);
      expect(await installDeckAndInvalidate(SLUG, source, null, null)).toBe(true);
      expect(JSON.parse(store.get(META_KEY)!).installId).not.toBe(firstId);
      await expect(acquireDraw(SLUG, 1, { deck: stale })).rejects.toThrow();
      expect((await loadDeckWallet(SLUG)).availablePulls).toBe(4);
    } finally { random.mockRestore(); }
  });

  it.each(['patch', 'chunked'])('%s publication mints a new installed instance and invalidates the bundled receipt', async mode => {
    const stale = await installedStarterForDraw();
    const original = JSON.parse(store.get(META_KEY)!);
    const registry = new Map<string, string>();
    const entry: any = { ...MANIFEST.decks[0] };
    if (mode === 'patch') {
      const path = `decks/${SLUG}/starter-full.patch.json`;
      entry.patches = [{ fromVersion: PACK.version, toVersion: FULL_BUILD, path }];
      registry.set(`${BASE}/content/${path}`, JSON.stringify({ schemaVersion: 2, slug: SLUG,
        fromVersion: PACK.version, toVersion: FULL_BUILD, deck: { ...FULL_DECK, cards: undefined },
        added: EXTRA_CARDS, updated: [], deleted: [] }));
    } else {
      const path = `decks/${SLUG}/full-package.json`;
      const chunkPath = `decks/${SLUG}/full-chunk.json`;
      const chunk = JSON.stringify({ slug: SLUG, version: FULL_BUILD, cards: FULL_DECK.cards });
      entry.packagePath = path;
      registry.set(`${BASE}/content/${path}`, JSON.stringify({ schemaVersion: 1, slug: SLUG, version: FULL_BUILD,
        deck: { ...FULL_DECK, cards: undefined }, totalCards: FULL_DECK.cards.length,
        chunks: [{ seq: 1, path: chunkPath, bytes: chunk.length, sha256: createHash('sha256').update(chunk).digest('hex'), cardCount: FULL_DECK.cards.length }] }));
      registry.set(`${BASE}/content/${chunkPath}`, chunk);
    }
    store.set(MANIFEST_CACHE_KEY, JSON.stringify({ ...MANIFEST, decks: [entry] }));
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      requested.push(String(input));
      const body = registry.get(String(input));
      return new Response(body ?? 'not found', { status: body ? 200 : 404 });
    }));
    expect(await installDeckAndInvalidate(SLUG, DECK_URL, FULL_BUILD, null)).toBe(true);
    expect(requested).not.toContain(DECK_URL);
    const installed = JSON.parse(store.get(META_KEY)!);
    expect(installed.buildId).toBe(FULL_BUILD);
    expect(typeof installed.installId).toBe('string');
    expect(installed.installId).not.toBe(original.installId);
    expect(JSON.parse(files.get(installed.fileUri)!).version).toBe(FULL_BUILD);
    store.delete(MANIFEST_CACHE_KEY);
    await expect(acquireDraw(SLUG, 1, { deck: stale })).rejects.toThrow();
    expect((await loadDeckWallet(SLUG)).availablePulls).toBe(5);
  });

  it('does not attest a changed file or an account switch during bundled read-back', async () => {
    await installedStarterForDraw();
    const meta = JSON.parse(store.get(META_KEY)!);
    store.delete(RECEIPT_KEY);
    files.set(meta.fileUri, JSON.stringify({ ...PACK, cards: PACK.cards.slice(1) }));
    expect(await ensureStarterDeckInstalled(SLUG)).toBe('unavailable');
    expect(store.has(RECEIPT_KEY)).toBe(false);
    files.set(meta.fileUri, JSON.stringify(PACK));
    onRead = key => { if (key === META_KEY) setActiveUserSubForStorage('user-b'); };
    expect(await ensureStarterDeckInstalled(SLUG)).toBe('unavailable');
    expect(store.has(RECEIPT_KEY)).toBe(false);
  });

  it('does not trust an adopted guest marker for an account; explicit bundled read-back can attest the copy', async () => {
    await installedStarterForDraw();
    // The existing public adoption path authorizes a real file copy using the live manifest.
    store.set(MANIFEST_CACHE_KEY, JSON.stringify(MANIFEST));
    authUserSub = 'user-a';
    setActiveUserSubForStorage('user-a');
    invalidateDeckCache();
    await adoptAnonymousPublicDecks('user-a');
    const accountMetaKey = `devcards:content:deckmeta:v2:user-a:${SLUG}`;
    const accountReceiptKey = `${BUNDLED_STARTER_RECEIPT_PREFIX}user-a:${SLUG}`;
    expect(store.has(accountReceiptKey)).toBe(false);
    // Even copying the guest receipt verbatim cannot authorize the account.
    store.set(accountReceiptKey, store.get(RECEIPT_KEY)!);
    store.delete(MANIFEST_CACHE_KEY);
    await saveDeckWallet(SLUG, { availablePulls: 5, reservePulls: 0 });
    const deck = await getCachedDeck(SLUG);
    await expect(acquireDraw(SLUG, 1, { deck })).rejects.toThrow();
    expect((await loadDeckWallet(SLUG)).availablePulls).toBe(5);
    expect(await ensureStarterDeckInstalled(SLUG)).toBe('already-installed');
    expect(JSON.parse(store.get(accountReceiptKey)!).userSub).toBe('user-a');
    expect(JSON.parse(store.get(accountMetaKey)!).installId).toBe(JSON.parse(store.get(META_KEY)!).installId);
    expect((await acquireDraw(SLUG, 1, { deck })).spent).toBe(1);
    expect(JSON.parse(store.get('devcards:u:anon:recallsmith:deck-wallets:v1')!).decks[SLUG].availablePulls).toBe(5);
  });

  it('ensureStarterDeckInstalled: installs once, then reports the installed deck; unknown slugs have no pack', async () => {
    expect(await ensureStarterDeckInstalled('claude-ccdv-f')).toBe('installed-starter');
    expect(await ensureStarterDeckInstalled('claude-ccdv-f')).toBe('already-installed');
    expect((await getCachedDeck('claude-ccdv-f'))!.Cards).toHaveLength(STARTER_PACKS['claude-ccdv-f'].cards.length);
    expect(await ensureStarterDeckInstalled('not-a-bundled-deck')).toBe('unavailable');
    // 2026-10-14 three decks: the hidden csharp-basics ships no pack, and fundamentals never had one.
    expect(await ensureStarterDeckInstalled('csharp-basics')).toBe('unavailable');
    expect(await ensureStarterDeckInstalled('aws-saa-fundamentals')).toBe('unavailable');
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
    expect(store.has('devcards:content:deckmeta:v2:anon:not-a-bundled-deck')).toBe(false);
    expect([...store.keys()].filter((key) => key.startsWith('devcards:content:deckmeta:'))).toEqual([]);
    act(() => draw.unmount());
  });

  it('shelf entries carry the full deck size for a starter pack and the installed size otherwise', async () => {
    expect(await ensureStarterDeckInstalled(SLUG)).toBe('installed-starter');
    const entries = await listInstalledDeckEntries();
    expect(entries.map((e) => [e.slug, e.totalCards])).toEqual([[SLUG, PACK.totalCards]]);

    // Once the full deck replaces the pack, the entry is the installed deck's own size.
    online = true;
    expect(await upgradeStarterDecks()).toEqual([SLUG]);
    online = false;
    const after = await listInstalledDeckEntries();
    expect(after.map((e) => [e.slug, e.totalCards])).toEqual([[SLUG, FULL_DECK.cards.length]]);
  });

  it('SessionCard keeps the plain error offline for a bundled deck that is not the lesson deck', async () => {
    store.set(STAGE_KEY, 'starter');
    store.set(STUDY_GOAL_KEY, JSON.stringify({ deckSlug: 'claude-ccdv-f', examDate: null }));
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionCardScreen
          navigation={{ navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any}
          route={{ key: 'session-card', name: 'SessionCard', params: { slug: SLUG, mode: 'learn-new' } } as any}
        />,
      );
    });
    await flush();
    expect(fetchCalls).toContain(MANIFEST_URL);
    expect(store.has(META_KEY)).toBe(false);
    expect(tree.root.findAll((node) => node.props?.testID === 'session-card-offline-starter')).toHaveLength(0);
    expect(hasText(tree, STARTER_COPY.offlineStarterNotice)).toBe(false);
    expect(hasText(tree, 'Deck not available')).toBe(true);
    act(() => tree.unmount());
  });
});
