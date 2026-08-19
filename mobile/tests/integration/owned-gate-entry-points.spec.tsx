import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The end-to-end fixture for the ownership gate, driven through the real
 * screens over a real (in-memory) storage.
 *
 * Three cards, one question each:
 *   stranger -- never drawn, never studied. Must be invisible to every entry
 *               point: it cannot be picked, counted, opened or read.
 *   drawn    -- drawn, never studied. Must be studiable immediately, with no
 *               sync in between: a pull that grants nothing to do is the bug
 *               this phase exists to close.
 *   grand    -- studied on an ungated client, never drawn. Grandfathered, so
 *               it stays studiable everywhere -- the gate takes back nothing a
 *               user has already worked on.
 *
 * Deliberately ordered stranger-first. Every "pick the next card" path walks
 * the deck in OrderInDeck, so an ungated pick returns stranger and a gated one
 * returns drawn: the assertions distinguish the two rather than passing under
 * either.
 */

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

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
    FlatList: ({ data = [], renderItem, ListHeaderComponent, ListEmptyComponent, ...props }: any) =>
      React.createElement(
        'FlatList',
        props,
        ListHeaderComponent,
        (data as any[]).length === 0
          ? typeof ListEmptyComponent === 'function'
            ? ListEmptyComponent()
            : ListEmptyComponent
          : null,
        ...(data as any[]).map((item: any, index: number) => renderItem({ item, index })),
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
      spring: () => ({ start: (cb?: any) => cb?.() }),
    },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Alert: { alert: vi.fn() },
    Platform: { OS: 'ios', select: (spec: any) => spec.ios },
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

const DECK = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 3,
  Cards: [
    { StableUid: 'stranger', OrderInDeck: 1, Difficulty: 1, Question: 'Stranger question', Answer: 'A1' },
    { StableUid: 'drawn', OrderInDeck: 2, Difficulty: 1, Question: 'Drawn question', Answer: 'A2' },
    { StableUid: 'grand', OrderInDeck: 3, Difficulty: 1, Question: 'Grandfather question', Answer: 'A3' },
  ],
} as any;

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    { slug: 'csharp', title: 'C# Interview', locale: 'en-US', version: '1', deckType: 1, availability: 'live' },
  ]),
  resolveDeckBySlug: vi.fn(async () => DECK),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => true),
}));

vi.mock('../../src/sync/progressSync', () => ({
  applyCachedRemoteProgress: vi.fn(async () => {}),
  recordReviewEvent: vi.fn(async () => 'evt-1'),
  scheduleProgressSync: vi.fn(() => {}),
}));

vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: vi.fn(async () => {}),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(async () => {}),
}));

vi.mock('../../src/premium/revenuecat', () => ({
  rcGetCustomerInfoSafe: vi.fn(async () => null),
  isPremiumActive: vi.fn(() => false),
}));

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  loadRewardWalletState: vi.fn(async () => ({ availablePulls: 0, reservePulls: 0 })),
}));

// The one card on screen, by its question text: the cheapest honest answer to
// "which card did the planner hand this session?". The reveal control is kept
// because the rating bar refuses to rate a face-down card.
vi.mock('../../src/features/gacha/components/ReviewBody', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ card, onFlip }: any) =>
      React.createElement(
        'View',
        null,
        React.createElement('Text', null, String(card?.Question ?? '')),
        React.createElement('Pressable', { onPress: onFlip }, React.createElement('Text', null, 'Reveal answer')),
      ),
  };
});

import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { ChallengeScreen } from '../../src/screens/ChallengeScreen';
import { CardDetailScreen } from '../../src/screens/CardDetailScreen';
import { saveDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import type { CardProgress } from '../../src/review/model';

const DAY_MS = 86_400_000;

function learnedDueToday(stableUid: string): CardProgress {
  const now = Date.now();
  return { stableUid, stage: 2, lastReviewedAt: now - DAY_MS, nextReviewAt: now, lastSeenRevision: 1 };
}

function untouched(stableUid: string): CardProgress {
  return { stableUid, stage: 0, nextReviewAt: 0, lastSeenRevision: 0 };
}

async function seed(params: { owned: string[]; progress: CardProgress[] }) {
  store.clear();
  invalidateDrawStateCache();
  setActiveUserSubForStorage(null);
  await saveDeckProgress(DECK, params.progress);
  await saveDrawState('csharp', { owned: params.owned, pity: null });
}

/** owned: drawn. studied: grand. untouched and unowned: stranger. */
async function seedMixedFixture() {
  await seed({
    owned: ['drawn'],
    progress: [untouched('stranger'), untouched('drawn'), learnedDueToday('grand')],
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
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

function textByTestId(tree: renderer.ReactTestRenderer, testID: string): string {
  const node = tree.root.findAll((item) => item.props?.testID === testID)[0];
  if (!node) return '';
  const children = node.props.children;
  return Array.isArray(children) ? children.join('') : String(children ?? '');
}

async function renderScreen(element: React.ReactElement): Promise<renderer.ReactTestRenderer> {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(element);
  });
  await flush();
  return tree;
}

const nav = () => ({ navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() }) as any;

function pressText(tree: renderer.ReactTestRenderer, label: string) {
  const target = tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
  target.props.onPress();
}

describe('ownership gate — every entry point', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    resetSessionStore();
    vi.clearAllMocks();
  });

  describe('session pick', () => {
    it('skips a card nobody drew and starts on the one that was drawn', async () => {
      await seedMixedFixture();

      const tree = await renderScreen(
        <SessionCardScreen
          navigation={nav()}
          route={{ key: 'k', name: 'SessionCard', params: { slug: 'csharp', mode: 'learn-new' } } as any}
        />,
      );

      const blob = textBlob(tree);
      expect(blob).toContain('Drawn question');
      expect(blob).not.toContain('Stranger question');
    });

    it('has nothing to teach an account that holds nothing', async () => {
      // A deck installed and never pulled from. Ungated this screen would open
      // on card #001 and the draw would be decorative.
      await seed({
        owned: [],
        progress: [untouched('stranger'), untouched('drawn'), untouched('grand')],
      });

      const tree = await renderScreen(
        <SessionCardScreen
          navigation={nav()}
          route={{ key: 'k', name: 'SessionCard', params: { slug: 'csharp', mode: 'learn-new' } } as any}
        />,
      );

      const blob = textBlob(tree);
      expect(blob).toContain('Route complete');
      // The run header is planned separately from the pick, off its own
      // planChallengeRoute call, and it has to agree: ungated this deck plans a
      // three-card route and then the screen has no card to put in it, so the
      // header counts down against a route that does not exist.
      expect(blob).toContain('Run 0/1');
    });

    it('does not reach for an unowned card after a rating either', async () => {
      // The second pick runs inside buildRatedSessionState, on a different
      // code path from the load-time one, and it is the path that decides
      // whether a run ends or continues. Ungated, rating the one card this
      // account holds hands it 'stranger' and the run continues into content
      // nobody pulled.
      await seed({
        owned: ['drawn'],
        progress: [untouched('stranger'), untouched('drawn'), untouched('grand')],
      });
      const navigation = nav();

      const tree = await renderScreen(
        <SessionCardScreen
          navigation={navigation}
          route={{ key: 'k', name: 'SessionCard', params: { slug: 'csharp', mode: 'learn-new' } } as any}
        />,
      );

      await act(async () => {
        pressText(tree, 'Reveal answer');
      });
      await act(async () => {
        pressText(tree, 'Good');
        await Promise.resolve();
      });
      await flush();

      expect(textBlob(tree)).not.toContain('Stranger question');
      expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.anything());
    });

    it('still teaches a card that was studied before it could be drawn', async () => {
      // The grandfather clause at the entry point that matters most: a user
      // mid-way through a deck on an older client must not lose the review.
      await seed({ owned: [], progress: [untouched('stranger'), untouched('drawn'), learnedDueToday('grand')] });

      const tree = await renderScreen(
        <SessionCardScreen
          navigation={nav()}
          route={{ key: 'k', name: 'SessionCard', params: { slug: 'csharp', mode: 'review-due' } } as any}
        />,
      );

      expect(textBlob(tree)).toContain('Grandfather question');
    });
  });

  describe('challenge route', () => {
    it('sizes today’s run from the collection, not the deck file', async () => {
      await seed({
        owned: ['drawn'],
        progress: [untouched('stranger'), untouched('drawn'), untouched('grand')],
      });

      const tree = await renderScreen(
        <ChallengeScreen navigation={nav()} route={{ key: 'k', name: 'Challenge', params: {} } as any} />,
      );

      // One owned unstudied card -> a one-new route (plus the warm-up slot the
      // builder always adds). Ungated all three unstudied cards count and the
      // route is a card longer.
      expect(textBlob(tree)).toContain('Clear today’s run (2 cards) for +2 free pulls.');
    });
  });

  describe('library', () => {
    it('shows a drawn card’s question and keeps an undrawn one behind the silhouette', async () => {
      await seedMixedFixture();

      const tree = await renderScreen(
        <LibraryScreen navigation={nav()} route={{ key: 'k', name: 'Library', params: {} } as any} />,
      );

      const blob = textBlob(tree);
      expect(blob).toContain('Drawn question');
      expect(blob).toContain('Grandfather question');
      expect(blob).not.toContain('Stranger question');
    });

    it('counts the collection in the header ring', async () => {
      await seedMixedFixture();

      const tree = await renderScreen(
        <LibraryScreen navigation={nav()} route={{ key: 'k', name: 'Library', params: {} } as any} />,
      );

      // drawn + grand out of three. The old formula counted studied cards, so
      // the card the user had just pulled did not appear in its own counter.
      expect(textByTestId(tree, 'library-collection-bar')).toBe('2/3');
      expect(textBlob(tree)).toContain('67%');
    });

    it('stops calling a collection empty when it is not', async () => {
      // Drew a pack, studied none of it. The banner is the "you own nothing"
      // state, and using "studied nothing" as its proxy showed it to users
      // holding a full pack.
      await seed({
        owned: ['stranger', 'drawn'],
        progress: [untouched('stranger'), untouched('drawn'), untouched('grand')],
      });

      const tree = await renderScreen(
        <LibraryScreen navigation={nav()} route={{ key: 'k', name: 'Library', params: {} } as any} />,
      );

      expect(tree.root.findAll((node) => node.props?.testID === 'library-open-first-pack-cta')).toHaveLength(0);
    });

    it('does not congratulate a half-empty collection on being complete', async () => {
      // Filter=New with nothing in it used to mean "you have seen every card in
      // this deck". Gated it means "nothing you hold is unstudied", which is
      // also true of an account holding one card of three.
      await seed({
        owned: ['drawn'],
        progress: [untouched('stranger'), learnedDueToday('drawn'), untouched('grand')],
      });

      const tree = await renderScreen(
        <LibraryScreen navigation={nav()} route={{ key: 'k', name: 'Library', params: {} } as any} />,
      );

      await act(async () => {
        tree.root.findByProps({ testID: 'library-filter-chip-new' }).props.onPress();
      });
      await flush();

      const blob = textBlob(tree);
      expect(blob).not.toContain("You've got every card in this pack.");
      expect(blob).toContain('Nothing matches');
    });

    it('scrolls to a card the user can actually open', async () => {
      await seedMixedFixture();

      const tree = await renderScreen(
        <LibraryScreen
          navigation={nav()}
          route={{ key: 'k', name: 'Library', params: { scrollToNew: true } } as any}
        />,
      );
      await flush();

      // "Show me something new" resolves to the first card the user holds and
      // has not studied. Ungated it resolved to slot #001 -- whatever that is.
      const highlighted = tree.root.findAll(
        (node) => typeof node.props?.testID === 'string' && node.props.testID.startsWith('library-card-'),
      );
      expect(highlighted.length).toBeGreaterThan(0);
      expect(textBlob(tree)).toContain('Drawn question');
    });
  });

  describe('card detail', () => {
    it('locks a card nobody drew and offers no way into a session', async () => {
      await seedMixedFixture();

      const tree = await renderScreen(
        <CardDetailScreen
          navigation={nav()}
          route={{ key: 'k', name: 'CardDetail', params: { cardId: 'stranger' } } as any}
        />,
      );

      const blob = textBlob(tree);
      expect(blob).not.toContain('Stranger question');
      expect(blob).not.toContain('Open deck session');
      expect(blob).toContain('Not in your collection');
    });

    it('opens a grandfathered card in full, study entry included', async () => {
      await seedMixedFixture();

      const tree = await renderScreen(
        <CardDetailScreen
          navigation={nav()}
          route={{ key: 'k', name: 'CardDetail', params: { cardId: 'grand' } } as any}
        />,
      );

      const blob = textBlob(tree);
      expect(blob).toContain('Grandfather question');
      expect(blob).toContain('Open deck session');
    });
  });
});
