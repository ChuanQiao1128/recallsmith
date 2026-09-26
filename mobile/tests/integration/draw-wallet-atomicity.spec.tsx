import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// deckCache memoizes deck reads at module scope; clear it between tests so a
// changed resolveDeckBySlug mock is not shadowed by a prior test's entry (G30).
beforeEach(() => {
  invalidateDeckCache();
});

/**
 * Composite draw-screen tests: the REAL commitDraw, the REAL reward wallet
 * and a real (in-memory) AsyncStorage underneath the screen.
 *
 * draw.screen.test.tsx mocks both, which is why it can assert that a refund
 * was requested but never that the collection and the wallet agree
 * afterwards. Everything in this file is about that agreement: what the two
 * stores hold, and in what order they were written, when a pull is spent on
 * an exhausted pool or a commit dies mid-write.
 */

const store = new Map<string, string>();
// Crash injection, same shape as tests/unit/drawAtomicity.test.ts: returns
// true for the key whose write should die.
let failSetItemFor: ((key: string) => boolean) | null = null;
const setItemCalls: string[] = [];
// Runs immediately after the named key's write lands. Used to simulate a
// reward arriving from another part of the app between the debit and the
// failure that follows it.
let afterSetItem: ((key: string) => Promise<void> | void) | null = null;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      setItemCalls.push(key);
      if (failSetItemFor?.(key)) {
        throw new Error(`storage write killed: ${key}`);
      }
      store.set(key, value);
      if (afterSetItem) await afterSetItem(key);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

const SLUG = 'csharp';
const SCOPE = 'devcards:u:anon:';
const STATE_KEY = `${SCOPE}devcards:draw-state:${SLUG}`;
const HISTORY_KEY = `${SCOPE}devcards:draw-history:${SLUG}`;
const WALLET_KEY = `${SCOPE}recallsmith:reward-wallet:v1`;

const deckCards = Array.from({ length: 3 }, (_, index) => ({
  StableUid: `c${index + 1}`,
  Question: `Question ${index + 1}`,
  Difficulty: 1,
  OrderInDeck: index + 1,
}));

const deck = {
  Slug: SLUG,
  Title: 'C# Interview',
  Locale: 'en',
  Version: '1',
  DeckType: 1,
  IsFreeStarter: true,
  TotalCards: deckCards.length,
  FreeCardCount: deckCards.length,
  Cards: deckCards,
};

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
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
  loadActiveDeckSlug: vi.fn(async () => SLUG),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

// deckCache reads the user scope through a guarded dynamic import of
// progressScope; mock it so that import resolves to a fixed scope instead of
// dragging in the real authStore -> react-native chain the runner cannot parse.
vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [{ slug: SLUG, availability: 'live', title: 'C# Interview' }]),
  resolveDeckBySlug: vi.fn(async (slug: string) => (slug === SLUG ? deck : null)),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => false),
}));

vi.mock('../../src/review/storage', () => ({
  getUserScopedKey: vi.fn(async (baseKey: string) => `${SCOPE}${baseKey}`),
  loadDeckProgress: vi.fn(async () => []),
}));

const scheduleProgressSyncMock = vi.fn();
vi.mock('../../src/sync/progressSync', () => ({
  scheduleProgressSync: (arg?: any) => scheduleProgressSyncMock(arg),
}));

import { DrawScreen } from '../../src/screens/DrawScreen';
// store.clear() below wipes the keys behind the draw store's back, the same
// way the debug reset does in production -- and, like production, the
// in-memory read model has to be told or one test's collection leaks into the
// next one's fixture.
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { flushDrawHistory } from '../../src/features/gacha/draw/drawCommit';
import { DRAW_COMMITTED_SYNC_DELAY_MS } from '../../src/features/gacha/draw/ceremonyTimings';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function armPackSwipe(tree: renderer.ReactTestRenderer) {
  const swipeZone = tree.root.findByProps({ testID: 'draw-card-stack-stage' });
  act(() => {
    swipeZone.props.onResponderGrant({ nativeEvent: { pageX: 10 } });
    swipeZone.props.onResponderRelease({ nativeEvent: { pageX: 120 } });
  });
}

function collectText(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

async function mountDraw(navigate: ReturnType<typeof vi.fn>) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <DrawScreen
        navigation={{ goBack: vi.fn(), navigate } as any}
        route={{ key: 'draw', name: 'Draw', params: { slug: SLUG } } as any}
      />,
    );
  });
  await flush();
  return tree;
}

function readWallet(): { availablePulls: number; reservePulls: number } {
  return JSON.parse(store.get(WALLET_KEY) ?? '{"availablePulls":0,"reservePulls":0}');
}

describe('draw screen · exhausted pool', () => {
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    // Drain any fire-and-forget history append the previous test enqueued
    // through the real commitDraw before wiping the store, so a late write
    // cannot land in the next test's fixture.
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    setItemCalls.length = 0;
    failSetItemFor = null;
    afterSetItem = null;
    scheduleProgressSyncMock.mockClear();
  });

  it('charges nothing and refuses the pull when every card is already owned', async () => {
    store.set(WALLET_KEY, JSON.stringify({ availablePulls: 12, reservePulls: 0 }));
    store.set(STATE_KEY, JSON.stringify({ owned: ['c1', 'c2', 'c3'], pity: { draws: 0, threshold: 10 } }));

    const navigate = vi.fn();
    const tree = await mountDraw(navigate);
    armPackSwipe(tree);

    // The Pressable test double ignores `disabled`, so pressing here reaches
    // open() the way a stale render would. The guard inside open() is what
    // this pins, not the greyed-out styling.
    setItemCalls.length = 0;
    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The wallet is the assertion that matters: a pull that buys nothing
    // must not be spent.
    expect(readWallet()).toEqual({ availablePulls: 12, reservePulls: 0 });
    expect(navigate).not.toHaveBeenCalled();
    // Nothing is written either: a press the screen already knows is
    // pointless should not reach commitDraw at all. Without this the
    // downstream zero-cards refund would mask a missing guard.
    expect(setItemCalls).toEqual([]);
    // And the user stays on the pack rather than being thrown into the
    // error card by their own disabled button.
    expect(collectText(tree)).toContain('Collection complete');
    expect(collectText(tree)).not.toContain('Draw unavailable right now');
  });

  it('tells the user the collection is complete instead of offering a dead Open button', async () => {
    store.set(WALLET_KEY, JSON.stringify({ availablePulls: 12, reservePulls: 0 }));
    store.set(STATE_KEY, JSON.stringify({ owned: ['c1', 'c2', 'c3'], pity: { draws: 0, threshold: 10 } }));

    const navigate = vi.fn();
    const tree = await mountDraw(navigate);
    armPackSwipe(tree);

    expect(collectText(tree)).toContain('Collection complete');
    expect(tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.disabled).toBe(true);

    // The screen still owes the user somewhere to go; a dead pack with no
    // exit is the state this replaced.
    const secondary = tree.root.findByProps({ testID: 'screen-draw-secondary-cta' });
    expect(secondary.props.disabled).toBe(false);
    act(() => {
      secondary.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Library', { focusSlug: SLUG });
  });

  it('refunds nothing because nothing was charged when the pool empties under the screen', async () => {
    // The screen loaded while one card was still missing, so its buttons are
    // live; another device (or another tab) took the last card before the
    // press landed. This is the race the disabled state above cannot cover.
    store.set(WALLET_KEY, JSON.stringify({ availablePulls: 12, reservePulls: 0 }));
    store.set(STATE_KEY, JSON.stringify({ owned: ['c1', 'c2'], pity: { draws: 0, threshold: 10 } }));

    const navigate = vi.fn();
    const tree = await mountDraw(navigate);
    armPackSwipe(tree);

    // The remote card arrives through saveDrawState, which is how it arrives
    // in production: drawStateSync merges the server's owned set and writes it
    // with this call. This used to poke the storage key directly, which stopped
    // modelling anything real once the store gained a write-through cache --
    // a raw setItem now describes a writer that does not exist. The race being
    // tested is unchanged: the deck fills up after the screen has already
    // decided its buttons are live.
    await saveDrawState(SLUG, { owned: ['c1', 'c2', 'c3'], pity: { draws: 0, threshold: 10 } });

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readWallet()).toEqual({ availablePulls: 12, reservePulls: 0 });
    expect(navigate).not.toHaveBeenCalled();
    expect(collectText(tree)).toContain('Draw unavailable right now');
  });
});

describe('draw screen · sync trigger', () => {
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    // Drain any fire-and-forget history append the previous test enqueued
    // through the real commitDraw before wiping the store, so a late write
    // cannot land in the next test's fixture.
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    setItemCalls.length = 0;
    failSetItemFor = null;
    afterSetItem = null;
    scheduleProgressSyncMock.mockClear();
  });

  it('asks for a sync as soon as a draw commits', async () => {
    store.set(WALLET_KEY, JSON.stringify({ availablePulls: 12, reservePulls: 0 }));
    store.set(STATE_KEY, JSON.stringify({ owned: [], pity: { draws: 0, threshold: 10 } }));

    const tree = await mountDraw(vi.fn());
    armPackSwipe(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The reason string is load-bearing: it is what puts this sync on the
    // pull whitelist in syncProgressOnce. The delay is deferred past the longest
    // ceremony (MGACHA-03) so its work never lands on the JS thread mid-ceremony.
    expect(scheduleProgressSyncMock).toHaveBeenCalledWith({ delayMs: DRAW_COMMITTED_SYNC_DELAY_MS, reason: 'draw_committed' });
  });

  it('does not ask for a sync when the pull bought nothing', async () => {
    store.set(WALLET_KEY, JSON.stringify({ availablePulls: 12, reservePulls: 0 }));
    store.set(STATE_KEY, JSON.stringify({ owned: ['c1', 'c2'], pity: { draws: 0, threshold: 10 } }));

    const tree = await mountDraw(vi.fn());
    armPackSwipe(tree);
    // Same production-shaped stimulus as the exhausted-pool case above: the
    // last card arrives the way drawStateSync delivers it, not by writing the
    // storage key behind the store's back.
    await saveDrawState(SLUG, { owned: ['c1', 'c2', 'c3'], pity: { draws: 0, threshold: 10 } });

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(scheduleProgressSyncMock).not.toHaveBeenCalled();
  });
});

describe('draw screen · wallet/draw-state ordering', () => {
  beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    // Drain any fire-and-forget history append the previous test enqueued
    // through the real commitDraw before wiping the store, so a late write
    // cannot land in the next test's fixture.
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    setItemCalls.length = 0;
    failSetItemFor = null;
    afterSetItem = null;
    scheduleProgressSyncMock.mockClear();
  });

  it('does not touch the wallet until the draw state has landed', async () => {
    store.set(WALLET_KEY, JSON.stringify({ availablePulls: 12, reservePulls: 0 }));
    store.set(STATE_KEY, JSON.stringify({ owned: [], pity: { draws: 0, threshold: 10 } }));

    const navigate = vi.fn();
    const tree = await mountDraw(navigate);
    armPackSwipe(tree);
    setItemCalls.length = 0;

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    const walletIndex = setItemCalls.indexOf(WALLET_KEY);
    const stateIndex = setItemCalls.indexOf(STATE_KEY);
    expect(stateIndex).toBeGreaterThanOrEqual(0);
    expect(walletIndex).toBeGreaterThan(stateIndex);
    expect(readWallet().availablePulls).toBe(11);
    expect(navigate).toHaveBeenCalled();
  });

  it('leaves the wallet whole when the draw-state write is killed', async () => {
    // Process death between the two writes is the case a try/catch cannot
    // reach, so the property under test is "was the wallet written at all",
    // not "was it written back". Charging second is the only ordering where
    // a kill costs the user nothing.
    store.set(WALLET_KEY, JSON.stringify({ availablePulls: 12, reservePulls: 0 }));
    store.set(STATE_KEY, JSON.stringify({ owned: [], pity: { draws: 0, threshold: 10 } }));
    const navigate = vi.fn();
    const tree = await mountDraw(navigate);
    armPackSwipe(tree);
    setItemCalls.length = 0;
    failSetItemFor = (key) => key === STATE_KEY;

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setItemCalls).not.toContain(WALLET_KEY);
    expect(readWallet()).toEqual({ availablePulls: 12, reservePulls: 0 });
    expect(store.has(HISTORY_KEY)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('refunds incrementally, keeping pulls granted while the draw was in flight', async () => {
    // A settlement lands its reward between the debit and the failure. A
    // snapshot restore would write the pre-draw wallet back over it and the
    // grant would vanish; an incremental refund adds the spend back to
    // whatever the wallet holds now.
    store.set(WALLET_KEY, JSON.stringify({ availablePulls: 12, reservePulls: 0 }));
    store.set(STATE_KEY, JSON.stringify({ owned: [], pity: { draws: 0, threshold: 10 } }));
    const navigate = vi.fn(() => {
      throw new Error('navigation exploded after the charge landed');
    });
    const tree = await mountDraw(navigate);
    armPackSwipe(tree);

    let granted = false;
    afterSetItem = async (key) => {
      if (key !== WALLET_KEY || granted) return;
      granted = true;
      const current = JSON.parse(store.get(WALLET_KEY)!);
      store.set(
        WALLET_KEY,
        JSON.stringify({ ...current, availablePulls: current.availablePulls + 3 }),
      );
    };

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 12 - 10 spent = 2, +3 granted = 5, +10 refunded = 15. A snapshot
    // restore would say 12 and eat the grant.
    expect(readWallet().availablePulls).toBe(15);
  });
});
