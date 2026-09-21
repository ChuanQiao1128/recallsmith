import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The economy floor, driven through the real Home load chain over a real
 * (in-memory) storage.
 *
 * The deadlock it closes is a product of the ownership gate, so it only
 * exists once the gate is on: a user who holds nothing has nothing to learn
 * (owned-new = 0), nothing to review (due = 0), and pulls are earned by
 * clearing a route -- which needs cards. Home's own view model names the
 * trap: kind `nothing_to_learn` wants to hand the primary button to the draw,
 * the wallet is `locked` so it cannot, and the button falls back to a library
 * of silhouettes.
 *
 * Every test here runs the same three loads Home runs, in Home's order, so
 * the numbers under test are the numbers a user would actually be shown.
 */

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      setItemCalls.push(key);
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

const setItemCalls: string[] = [];

const DECK = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 3,
  Cards: [
    { StableUid: 'c1', OrderInDeck: 1, Difficulty: 1, Question: 'Q one', Answer: 'A1' },
    { StableUid: 'c2', OrderInDeck: 2, Difficulty: 1, Question: 'Q two', Answer: 'A2' },
    { StableUid: 'c3', OrderInDeck: 3, Difficulty: 1, Question: 'Q three', Answer: 'A3' },
  ],
} as any;

const QUESTION_BY_UID: Record<string, string> = {
  c1: 'Q one',
  c2: 'Q two',
  c3: 'Q three',
};

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

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    {
      slug: 'csharp',
      title: 'C# Interview',
      locale: 'en-US',
      version: '1',
      deckType: 1,
      availability: 'live',
      totalCards: 3,
    },
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

// The one card on screen, by its question text: the cheapest honest answer to
// "which card did the planner hand this session?".
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

import { loadHomeDeckSummaries } from '../../src/features/gacha/home/deckActionResolver';
import { buildHomeScreenVM } from '../../src/features/gacha/selectors/homeSelectors';
import { applyEconomyFloorIfStarved } from '../../src/features/gacha/rewards/economyFloor';
import {
  consumePullsFromStoredWallet,
  loadRewardWalletState,
  saveRewardWalletState,
  type RewardWalletState,
} from '../../src/features/gacha/rewards/rewardWallet';
import { commitDraw } from '../../src/features/gacha/draw/drawCommit';
import { listManifestDecks } from '../../src/content/deckRepository';
import { saveDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import type { CardProgress } from '../../src/review/model';

const DAY_MS = 86_400_000;

function untouched(stableUid: string): CardProgress {
  return { stableUid, stage: 0, nextReviewAt: 0, lastSeenRevision: 0 };
}

function learnedDueToday(stableUid: string): CardProgress {
  const now = Date.now();
  return { stableUid, stage: 2, lastReviewedAt: now - DAY_MS, nextReviewAt: now, lastSeenRevision: 1 };
}

async function seed(params: {
  owned: string[];
  progress?: CardProgress[];
  wallet?: RewardWalletState;
}) {
  store.clear();
  setItemCalls.length = 0;
  invalidateDrawStateCache();
  setActiveUserSubForStorage(null);
  await saveDeckProgress(DECK, params.progress ?? [untouched('c1'), untouched('c2'), untouched('c3')]);
  await saveDrawState('csharp', { owned: params.owned, pity: null });
  await saveRewardWalletState(params.wallet ?? { availablePulls: 0, reservePulls: 0 });
}

/**
 * The Home load chain, exactly as HomeScreen.refreshHome runs it: summaries
 * and wallet in one join, then the floor, then the view model off the wallet
 * the floor returned.
 */
async function runHomeLoadChain(opts: { now?: Date } = {}) {
  const summary = await loadHomeDeckSummaries({ premium: false });
  const walletBeforeFloor = await loadRewardWalletState();
  const outcome = await applyEconomyFloorIfStarved({
    ownedNewCount: summary.totalNewAllDecks,
    dueCount: summary.totalDueAllDecks,
    wallet: walletBeforeFloor,
    now: opts.now ?? new Date(summary.asOfISO),
  });
  const vm = buildHomeScreenVM({
    state: 'ready',
    params: {
      deckSummaries: summary.deckSummaries,
      selectedSlug: 'csharp',
      hasSignedInUser: false,
      wallet: outcome.wallet,
      updates: summary.updates,
      allUpcoming30: summary.allUpcoming30,
      premium: false,
    },
  });
  return { summary, wallet: outcome.wallet, granted: outcome.granted, vm };
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

const nav = () => ({ navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() }) as any;

describe('economy floor', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    resetSessionStore();
    vi.clearAllMocks();
  });

  describe('all three conditions', () => {
    it('turns the dead end into a pull the same load can spend', async () => {
      await seed({ owned: [] });

      const { summary, wallet, granted, vm } = await runHomeLoadChain();

      // The three starvation inputs, read off the real chain.
      expect(summary.totalNewAllDecks).toBe(0);
      expect(summary.totalDueAllDecks).toBe(0);

      expect(granted).toBe(1);
      expect(wallet).toEqual({ availablePulls: 1, reservePulls: 0 });
      // Persisted, not just returned: the next screen reads storage.
      expect(await loadRewardWalletState()).toEqual({ availablePulls: 1, reservePulls: 0 });

      // Before the floor this kind fell through to 'Open library' because the
      // wallet was locked -- a library of silhouettes. It now points at the
      // draw, which is the only action that can change the user's situation.
      // The kind is empty_deck (nothing owned), not nothing_to_learn (owned,
      // nothing scheduled): the floor grants either way, and the CTA names
      // the first pull rather than a reward draw.
      expect(vm.cta.kind).toBe('empty_deck');
      expect(vm.draw.state).toBe('available');
      expect(vm.cta.nav).toBe('draw');
      expect(vm.cta.label).toBe('Open a pack to get your first cards');
    });

    it('grants to an account with no deck installed at all', async () => {
      // Vacuously starved: no deck means no owned-new and no due, and the
      // three conditions are met without the user owning anything to be
      // starved *of*. Granting anyway is the deliberate reading -- the floor
      // has three conditions and inventing a fourth ("must have a studiable
      // deck") would withhold the pull from the one user whose next act is to
      // install a deck and want one. The per-day cap bounds the cost either
      // way; this test exists so the choice is visible rather than incidental.
      await seed({ owned: [] });
      vi.mocked(listManifestDecks).mockResolvedValueOnce([]);

      const { summary, granted, wallet } = await runHomeLoadChain();

      expect(summary.deckSummaries).toHaveLength(0);
      expect(granted).toBe(1);
      expect(wallet).toEqual({ availablePulls: 1, reservePulls: 0 });
    });
  });

  describe('any one condition unmet', () => {
    it('grants nothing while the account holds an unstudied card', async () => {
      await seed({ owned: ['c1'] });

      const { summary, wallet, granted } = await runHomeLoadChain();

      expect(summary.totalNewAllDecks).toBe(1);
      expect(granted).toBe(0);
      expect(wallet).toEqual({ availablePulls: 0, reservePulls: 0 });
    });

    it('grants nothing while a review is due', async () => {
      // Grandfathered card: studied on an ungated client, never drawn, due
      // today. Owned-new is still 0 and the wallet is still empty, so due is
      // the single condition holding the grant back.
      await seed({
        owned: [],
        progress: [learnedDueToday('c1'), untouched('c2'), untouched('c3')],
      });

      const { summary, wallet, granted } = await runHomeLoadChain();

      expect(summary.totalNewAllDecks).toBe(0);
      expect(summary.totalDueAllDecks).toBe(1);
      expect(granted).toBe(0);
      expect(wallet).toEqual({ availablePulls: 0, reservePulls: 0 });
    });

    it('grants nothing while the wallet still has a pull', async () => {
      await seed({ owned: [], wallet: { availablePulls: 1, reservePulls: 0 } });

      const { granted, wallet } = await runHomeLoadChain();

      expect(granted).toBe(0);
      expect(wallet).toEqual({ availablePulls: 1, reservePulls: 0 });
    });

    it('counts reserve pulls as pulls', async () => {
      // Reserve is not spendable today, but it promotes into available on the
      // next spend. A user holding reserve is holding pulls, not starving.
      await seed({ owned: [], wallet: { availablePulls: 0, reservePulls: 2 } });

      const { granted, wallet } = await runHomeLoadChain();

      expect(granted).toBe(0);
      expect(wallet).toEqual({ availablePulls: 0, reservePulls: 2 });
    });
  });

  describe('idempotency', () => {
    it('gives nothing more when the same day’s Home is re-entered', async () => {
      await seed({ owned: [] });
      // Local components on purpose: the day marker is a local day key, and a
      // UTC literal in a UTC+12 test box silently lands on the next local day.
      const today = new Date(2026, 7, 19, 9, 0, 0);

      const first = await runHomeLoadChain({ now: today });
      expect(first.granted).toBe(1);

      // Navigate away and back: same day, still starved on every input,
      // because the user has not spent the pull.
      const second = await runHomeLoadChain({ now: new Date(2026, 7, 19, 21, 30, 0) });

      expect(second.granted).toBe(0);
      expect(await loadRewardWalletState()).toEqual({ availablePulls: 1, reservePulls: 0 });
    });

    it('gives nothing more after the pull is spent and Home reloads the same day', async () => {
      // The re-entry that actually threatens the cap: the wallet is back to
      // zero, so the three conditions are met a second time and only the
      // day marker stands between the user and an unlimited pull faucet.
      await seed({ owned: [] });
      // Local components on purpose: the day marker is a local day key, and a
      // UTC literal in a UTC+12 test box silently lands on the next local day.
      const today = new Date(2026, 7, 19, 9, 0, 0);

      expect((await runHomeLoadChain({ now: today })).granted).toBe(1);
      await consumePullsFromStoredWallet(1);
      expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });

      const second = await runHomeLoadChain({ now: new Date(2026, 7, 19, 23, 59, 0) });

      expect(second.granted).toBe(0);
      expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });
    });

    it('grants again the next day', async () => {
      await seed({ owned: [] });

      expect((await runHomeLoadChain({ now: new Date(2026, 7, 19, 9, 0, 0) })).granted).toBe(1);
      await consumePullsFromStoredWallet(1);

      const tomorrow = await runHomeLoadChain({ now: new Date(2026, 7, 20, 9, 0, 0) });

      expect(tomorrow.granted).toBe(1);
      expect(await loadRewardWalletState()).toEqual({ availablePulls: 1, reservePulls: 0 });
    });

    it('grants once when two Home loads race', async () => {
      // Home refreshes on focus and again when auth/premium resolves, so two
      // overlapping loads are the normal case, not a contrived one.
      await seed({ owned: [] });
      // Local components on purpose: the day marker is a local day key, and a
      // UTC literal in a UTC+12 test box silently lands on the next local day.
      const today = new Date(2026, 7, 19, 9, 0, 0);

      const [first, second] = await Promise.all([
        runHomeLoadChain({ now: today }),
        runHomeLoadChain({ now: today }),
      ]);

      // Both loads may believe they granted; the guarantee is on the wallet,
      // not on the return value. Each computes its new balance from the same
      // zero it read, so the losing write re-states the winner's value instead
      // of stacking a second pull on top of it.
      expect(first.granted + second.granted).toBeGreaterThanOrEqual(1);
      expect(await loadRewardWalletState()).toEqual({ availablePulls: 1, reservePulls: 0 });
    });

    it('writes the day marker before it touches the wallet', async () => {
      await seed({ owned: [] });

      await runHomeLoadChain({ now: new Date(2026, 7, 19, 9, 0, 0) });

      const markerKey = 'devcards:u:anon:recallsmith:economy-floor:v1';
      const walletKey = 'devcards:u:anon:recallsmith:reward-wallet:v1';
      const markerAt = setItemCalls.lastIndexOf(markerKey);
      const walletAt = setItemCalls.lastIndexOf(walletKey);

      expect(markerAt).toBeGreaterThanOrEqual(0);
      // Same reasoning as the session-reward dedupe: a crash between the two
      // writes should cost one pull, never arm a second grant.
      expect(markerAt).toBeLessThan(walletAt);
      expect(store.get(markerKey)).toBe('2026-08-19');
    });
  });

  describe('a new user’s first day', () => {
    it('walks from an empty collection to exactly one studiable card', async () => {
      // 0 owned, 0 studied, 0 pulls: a fresh install whose starter grant has
      // already been spent, which is the shape the gate turns into a trap.
      await seed({ owned: [] });

      // 1. Home load -> the floor notices the trap and grants the way out.
      const home = await runHomeLoadChain();
      expect(home.granted).toBe(1);
      expect(home.vm.cta.nav).toBe('draw');

      // 2. Draw, paid for out of the wallet the floor just filled.
      const spend = await consumePullsFromStoredWallet(1);
      expect(spend.spent).toBe(1);
      // The draw seeds its RNG from the clock, so pin the clock. Any card
      // would satisfy "the drawn one is studiable", but only a card that is
      // not first in deck order makes step 4 distinguish a gated pick from an
      // ungated one -- an ungated planner always hands back OrderInDeck #1,
      // and an unpinned draw would agree with it one time in three.
      const clock = vi.spyOn(Date, 'now').mockReturnValue(1_755_000_000_001);
      const result = await commitDraw('csharp', 1);
      clock.mockRestore();
      expect(result?.cards).toHaveLength(1);
      const drawnUid = result!.cards[0].stableUid;
      expect(drawnUid).not.toBe('c1');
      const drawnQuestion = QUESTION_BY_UID[drawnUid];
      const strangerQuestions = Object.entries(QUESTION_BY_UID)
        .filter(([uid]) => uid !== drawnUid)
        .map(([, question]) => question);
      expect(strangerQuestions).toHaveLength(2);

      // 3. The drawn card is studiable immediately -- no sync in between.
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(
          <SessionCardScreen
            navigation={nav()}
            route={{ key: 'k', name: 'SessionCard', params: { slug: 'csharp', mode: 'learn-new' } } as any}
          />,
        );
      });
      await flush();

      const blob = textBlob(tree);
      expect(blob).toContain(drawnQuestion);
      // 4. ...and nothing else is. The two cards nobody pulled stay invisible.
      for (const question of strangerQuestions) {
        expect(blob).not.toContain(question);
      }
      // One owned new card plans a one-node route: R6 removed the padded
      // warm-up slot, so due 0 / new 1 is a single node the user can full-clear.
      // Asserted so a regression that re-opens the route to the whole deck file
      // (3 cards) fails here too.
      expect(blob).toContain('Run 0/1');

      // 5. The floor does not fire again: the user now has work to do, which
      //    is a different reason from "already granted today" and the one that
      //    should be doing the work.
      const after = await runHomeLoadChain();
      expect(after.summary.totalNewAllDecks).toBe(1);
      expect(after.granted).toBe(0);
      expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });
    });
  });
});
