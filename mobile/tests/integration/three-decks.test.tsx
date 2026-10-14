// 2026-10-14 three decks, end to end: the app shows aws-saa-fundamentals, aws-saa-c03 and
// claude-ccdv-f, in that order, and never csharp-basics -- also on a device that still has it
// installed, as its active deck and as its study goal, with a manifest cached before it was hidden.
// Such a device switches to the first visible deck instead of opening it, and keeps its files.
//
// Same real stack as offline-first-run.test.tsx (repository, deck cache, starter module, active
// deck, study goal, wallet); only the network, the file system and a few leaf side effects are
// stand-ins.
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
import { loadActiveDeckSlug, setActiveDeckSlug } from '../../src/content/activeDeck';
import { getCachedDeck, installDeckAndInvalidate, invalidateDeckCache } from '../../src/content/deckCache';
import {
  ensureStarterDeckInstalled,
  listInstalledDeckEntries,
  resetStarterUpgradeBackoff,
} from '../../src/content/starterOffline';
import { STUDY_GOAL_KEY, getStudyGoal } from '../../src/features/goal/studyGoal';
import { STARTER_COPY } from '../../src/features/gacha/starter/starterCopy';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import {
  loadHomeDeckSummaries,
  resetAutoUpdateAttemptsForTests,
  resetLastKnownDeckUpdatesForTests,
} from '../../src/features/gacha/home/deckActionResolver';

const THREE = ['aws-saa-fundamentals', 'aws-saa-c03', 'claude-ccdv-f'];
const BASE = 'https://cdn.test';
const MANIFEST_URL = `${BASE}/content/manifest.json`;
const STAGE_KEY = 'recallsmith:onboarding:stage:v1';
const ACTIVE_KEY = 'active-deck-slug';
const metaKey = (slug: string) => `devcards:content:deckmeta:v2:anon:${slug}`;

type FlatDeck = { slug: string; title: string; locale: string; deckType: 1; version: string; totalCards: number; cards: any[] };

function flatDeck(slug: string, title: string, buildId: string): FlatDeck {
  const cards = Array.from({ length: 8 }, (_, i) => ({
    stableUid: `${slug}-${i + 1}`,
    orderInDeck: i + 1,
    difficulty: 1,
    question: `${title} question ${i + 1}`,
    explanation: `${title} answer ${i + 1}`,
    codeLanguage: '',
    codeSnippet: '',
    realWorldUsage: '',
    revision: 1,
  }));
  return { slug, title, locale: 'en-US', deckType: 1, version: buildId, totalCards: cards.length, cards };
}

const DECKS: Record<string, FlatDeck> = {
  'csharp-basics': flatDeck('csharp-basics', 'C# Hidden Deck', '20261001T000000Z-c5000001'),
  'aws-saa-fundamentals': flatDeck('aws-saa-fundamentals', 'AWS Fundamentals Deck', '20261014T000000Z-f0000001'),
  'aws-saa-c03': flatDeck('aws-saa-c03', 'AWS SAA Deck', '20261014T000000Z-a0000001'),
  'claude-ccdv-f': flatDeck('claude-ccdv-f', 'Claude Deck', '20261014T000000Z-b0000001'),
};
const deckPath = (slug: string) => `decks/${slug}/builds/${DECKS[slug].version}/deck.json`;

// A manifest cached before csharp-basics was hidden: it still lists the deck, and first.
const STALE_MANIFEST = {
  schemaVersion: 2,
  generatedAtMs: 1,
  prefix: 'content',
  decks: ['csharp-basics', ...THREE].map((slug, i) => ({
    order: (i + 1) * 10,
    slug,
    title: DECKS[slug].title,
    locale: 'en-US',
    deckType: 1,
    tier: 'free',
    availability: 'live',
    downloadMode: 'public',
    version: DECKS[slug].version,
    buildId: DECKS[slug].version,
    totalCards: DECKS[slug].totalCards,
    path: deckPath(slug),
    sha256: null,
  })),
};

let online = false;
const fetchCalls: string[] = [];
const fetchMock = vi.fn(async (input: any) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? input);
  fetchCalls.push(url);
  if (!online) throw new TypeError('Network request failed');
  const slug = Object.keys(DECKS).find((s) => url === `${BASE}/content/${deckPath(s)}`);
  const body = url === MANIFEST_URL ? STALE_MANIFEST : slug ? DECKS[slug] : null;
  if (!body) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
});

async function flush(rounds = 3) {
  for (let r = 0; r < rounds; r += 1) {
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function textBlob(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children ?? '');
    })
    .join('\n');
}

function hasText(tree: renderer.ReactTestRenderer, text: string): boolean {
  return tree.root.findAll((node) => (node.type as any) === 'Text' && node.props.children === text).length > 0;
}

/** Installs a deck from a local file through the normal install path (what a past download left). */
async function installOnDevice(slug: string) {
  const uri = `file:///cache/seed-${slug}.json`;
  files.set(uri, JSON.stringify(DECKS[slug]));
  expect(await installDeckAndInvalidate(slug, uri, DECKS[slug].version, null)).toBe(true);
}

/** csharp-basics installed, active and the study goal, onboarding long done. */
async function seedCsharpDevice() {
  await installOnDevice('csharp-basics');
  await setActiveDeckSlug('csharp-basics');
  store.set(STUDY_GOAL_KEY, JSON.stringify({ deckSlug: 'csharp-basics', examDate: null }));
  store.set(STAGE_KEY, 'done');
}

describe('2026-10-14 three decks: csharp-basics is hidden everywhere', () => {
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
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('online with a stale manifest: Home, Library, Draw and SessionCard show the three decks in order and open fundamentals, never csharp-basics', async () => {
    await seedCsharpDevice();
    online = true;

    // The stored active deck and goal read as none; nothing is deleted.
    expect(await loadActiveDeckSlug()).toBeNull();
    expect(await getStudyGoal()).toBeNull();
    expect(store.get(ACTIVE_KEY)).toBe('csharp-basics');

    // Home shelf: the manifest order, csharp-basics left out although the manifest lists it.
    const summary = await loadHomeDeckSummaries({ premium: false, remote: true });
    expect(summary.deckSummaries.map((d) => d.slug)).toEqual(THREE);

    // Library: the deck switcher lists the three decks in order and opens fundamentals.
    let library!: renderer.ReactTestRenderer;
    await act(async () => {
      library = renderer.create(
        <LibraryScreen
          navigation={{ goBack: vi.fn(), navigate: vi.fn(), replace: vi.fn(), setParams: vi.fn() } as any}
          route={{ key: 'library', name: 'Library', params: { focusSlug: 'csharp-basics' } } as any}
        />,
      );
    });
    await flush();
    const chips = library.root
      .findAll((node) => (node.type as any) === 'Pressable' && /^library-deck-/.test(String(node.props?.testID ?? '')))
      .map((node) => node.props.testID);
    expect(chips).toEqual(THREE.map((slug) => `library-deck-${slug}`));
    expect(library.root.findAllByProps({ testID: 'library-card-grid' }).length).toBeGreaterThan(0);
    expect(textBlob(library)).not.toContain('C# Hidden Deck');
    expect(store.get(ACTIVE_KEY)).toBe('aws-saa-fundamentals');
    act(() => library.unmount());

    // Draw from a recallsmith://draw/csharp-basics link, csharp-basics active again: fundamentals opens,
    // and the rail holds only the other two decks.
    await setActiveDeckSlug('csharp-basics');
    let draw!: renderer.ReactTestRenderer;
    await act(async () => {
      draw = renderer.create(
        <DrawScreen
          navigation={{ goBack: vi.fn(), navigate: vi.fn(), replace: vi.fn() } as any}
          route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp-basics' } } as any}
        />,
      );
    });
    await flush();
    expect(draw.root.findByProps({ testID: 'draw-pack-pulls-badge' }).props.accessibilityLabel).toMatch(/for AWS Fundamentals Deck$/);
    const rail = ['left', 'right'].map((side) =>
      draw.root.find((node) => (node.type as any) === 'Pressable' && node.props.testID === `draw-neighbor-${side}`).props.accessibilityLabel,
    );
    expect(rail.sort()).toEqual(['Select AWS SAA Deck', 'Select Claude Deck']);
    expect(textBlob(draw)).not.toContain('C# Hidden Deck');
    act(() => draw.unmount());

    // SessionCard asked for csharp-basics: it studies fundamentals instead.
    await setActiveDeckSlug('csharp-basics');
    let session!: renderer.ReactTestRenderer;
    await act(async () => {
      session = renderer.create(
        <SessionCardScreen
          navigation={{ navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any}
          route={{ key: 'session-card', name: 'SessionCard', params: { slug: 'csharp-basics' } } as any}
        />,
      );
    });
    await flush();
    expect(await loadActiveDeckSlug()).toBe('aws-saa-fundamentals');
    expect(textBlob(session)).not.toContain('C# Hidden Deck');
    act(() => session.unmount());

    // csharp-basics was never downloaded or opened, and stays on the device untouched.
    expect(fetchCalls).not.toContain(`${BASE}/content/${deckPath('csharp-basics')}`);
    expect(store.has(metaKey('csharp-basics'))).toBe(true);
    expect((await getCachedDeck('csharp-basics'))?.Cards).toHaveLength(8);
    expect(JSON.parse(store.get(STUDY_GOAL_KEY)!)).toEqual({ deckSlug: 'csharp-basics', examDate: null });
  });

  it('offline with no manifest: the shelf lists the installed decks fundamentals, SAA-C03, Claude, without csharp-basics', async () => {
    await seedCsharpDevice();
    await installOnDevice('aws-saa-fundamentals');
    expect(await ensureStarterDeckInstalled('claude-ccdv-f')).toBe('installed-starter');
    expect(await ensureStarterDeckInstalled('aws-saa-c03')).toBe('installed-starter');

    expect((await listInstalledDeckEntries()).map((e) => e.slug)).toEqual(THREE);
    const summary = await loadHomeDeckSummaries({ premium: false, remote: true });
    expect(fetchCalls).toContain(MANIFEST_URL);
    expect(summary.deckSummaries.map((d) => [d.slug, d.canStudy])).toEqual(THREE.map((slug) => [slug, true]));
  });

  it('offline first run on the default goal: fundamentals, no csharp-basics anywhere, and the lesson waits for the network', async () => {
    const replace = vi.fn();
    let survey!: renderer.ReactTestRenderer;
    await act(async () => {
      survey = renderer.create(
        <AudienceSurveyScreen navigation={{ replace } as any} route={{ key: 'audience', name: 'AudienceSurvey' } as any} />,
      );
    });
    const choices = survey.root
      .findAll((node) => (node.type as any) === 'Pressable' && node.props.accessibilityRole === 'radio')
      .map((node) => node.props.testID);
    expect(choices).toEqual(THREE.map((slug) => `goal-choice-${slug}`));
    for (const label of ['Continue', 'Finish setup']) {
      await act(async () => {
        survey.root
          .find(
            (node) =>
              (node.type as any) === 'Pressable' &&
              node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
          )
          .props.onPress();
        await Promise.resolve();
      });
      await flush(1);
    }
    expect(replace).toHaveBeenCalledWith('Home');
    expect(await getStudyGoal()).toEqual({ deckSlug: 'aws-saa-fundamentals', examDate: null });
    expect(await loadActiveDeckSlug()).toBe('aws-saa-fundamentals');
    act(() => survey.unmount());

    // Fundamentals ships no starter pack (accepted): offline, the lesson shows its offline copy.
    let session!: renderer.ReactTestRenderer;
    await act(async () => {
      session = renderer.create(
        <SessionCardScreen
          navigation={{ navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any}
          route={{ key: 'session-card', name: 'SessionCard', params: { slug: 'aws-saa-fundamentals', mode: 'learn-new' } } as any}
        />,
      );
    });
    await flush();
    expect(hasText(session, STARTER_COPY.offlineTitle)).toBe(true);
    act(() => session.unmount());

    // Nothing was installed, csharp-basics least of all.
    expect([...store.keys()].filter((key) => key.startsWith('devcards:content:deckmeta:'))).toEqual([]);
    expect(await listInstalledDeckEntries()).toEqual([]);
  });
});
