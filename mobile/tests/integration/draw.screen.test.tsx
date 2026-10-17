import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// deckCache memoizes deck reads at module scope; clear it between tests so a
// changed resolveDeckBySlug mock is not shadowed by a prior test's entry (G30).
beforeEach(() => {
  invalidateDeckCache();
});

// 2026-10-17 batch open: the open buttons follow min(draws held, cards not yet owned), so the
// default pack has 12 cards -- enough that 12 draws really can open a five-card batch. A test
// that means a one-card pack builds one.
function makeCards(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    StableUid: String(index + 1),
    OrderInDeck: index + 1,
    Difficulty: 1,
    Question: `Q${index + 1}`,
  }));
}
function csharpDeck(cardCount = 12) {
  return { Slug: 'csharp', Title: 'C# Interview', Cards: makeCards(cardCount) };
}

let walletFixture = { availablePulls: 12, reservePulls: 0 };
let manifestFixture: any[] = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
let resolveDeckFixture: any = csharpDeck();
let installDeckOkFixture = false;
let updatesFixture: Record<string, any> = {};

const consumeDeckPullsMock = vi.fn(async (_slug: string, count: number) => {
  const spent = Math.min(count, walletFixture.availablePulls);
  const nextWallet = {
    availablePulls: Math.max(0, walletFixture.availablePulls - spent),
    reservePulls: walletFixture.reservePulls,
  };
  walletFixture = nextWallet;
  return {
    wallet: nextWallet,
    spent,
    promotedFromReserve: 0,
  };
});

const saveRewardWalletStateMock = vi.fn(async (wallet: { availablePulls: number; reservePulls: number }) => {
  walletFixture = { ...wallet };
});

const commitDrawMock = vi.fn(async (_slug: string, drawCount: number) => ({
  cards: Array.from({ length: drawCount }, (_, index) => ({
    stableUid: `card-${index + 1}`,
    question: `Q${index + 1}`,
    difficulty: 1,
    rarity: 'COM' as const,
  })),
  poolExhausted: false,
  pityFiredFor: null,
  highlightedRarity: null,
  ownedAfter: drawCount,
  totalCards: 30,
  pityBefore: 0,
  pityAfter: 1,
}));

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
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

// Records how the screen asked for the manifest, so a test can tell the
// blocking read apart from the background revalidation. Null loader = both
// calls answer from the same fixture, which is what every pre-existing test
// in this file assumes.
const manifestCalls: Array<{ preferRemote: boolean }> = [];
let remoteManifestLoader: (() => Promise<any[]>) | null = null;

// deckCache reads the user scope through a guarded dynamic import of
// progressScope; mock it so that import resolves to a fixed scope instead of
// dragging in the real authStore -> react-native chain the runner cannot parse.
vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async (options?: { preferRemote?: boolean }) => {
    const preferRemote = options?.preferRemote === true;
    manifestCalls.push({ preferRemote });
    if (preferRemote && remoteManifestLoader) return remoteManifestLoader();
    return manifestFixture;
  }),
  resolveDeckBySlug: vi.fn(async (slug: string) => {
    if (typeof resolveDeckFixture === 'function') return resolveDeckFixture(slug);
    return resolveDeckFixture;
  }),
  checkManifestForUpdates: vi.fn(async () => updatesFixture),
  installDeckFromUrl: vi.fn(async () => installDeckOkFixture),
}));

const refundDeckPullsMock = vi.fn(async (_slug: string, count: number) => {
  walletFixture = {
    availablePulls: walletFixture.availablePulls + count,
    reservePulls: walletFixture.reservePulls,
  };
  return walletFixture;
});

// 1.7: DrawScreen reads, spends and refunds the per-pack wallet, and runs the
// first-visit bootstrap + legacy migration on load. Both of the latter are inert
// no-ops here; the fixture is the pack's balance.
vi.mock('../../src/features/gacha/rewards/deckWallet', () => ({
  loadDeckWallet: vi.fn(async () => walletFixture),
  consumeDeckPulls: vi.fn(async (slug: string, count: number) => consumeDeckPullsMock(slug, count)),
  refundDeckPulls: vi.fn(async (slug: string, count: number) => refundDeckPullsMock(slug, count)),
  ensureDeckBootstrap: vi.fn(async () => ({ granted: 0, wallet: walletFixture })),
  migrateLegacyWalletIfNeeded: vi.fn(async () => ({ kind: 'noop', moved: {} })),
}));

vi.mock('../../src/features/gacha/draw/drawCommit', () => ({
  commitDraw: vi.fn(async (slug: string, drawCount: number) => commitDrawMock(slug, drawCount)),
}));

// DrawScreen now schedules a sync when a draw commits. Mocked here for the
// same reason every other module in this file is: importing the real one
// drags expo-constants and the amplify session into a suite whose
// react-native double has four exports.
const scheduleProgressSyncMock = vi.fn();
vi.mock('../../src/sync/progressSync', () => ({
  scheduleProgressSync: (arg?: any) => scheduleProgressSyncMock(arg),
}));

import { DrawScreen } from '../../src/screens/DrawScreen';
import {
  DRAW_COMMITTED_SYNC_DELAY_MS,
  drawCommittedSyncDelayMs,
} from '../../src/features/gacha/draw/ceremonyTimings';

async function flush() {
  await act(async () => {
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

// The text of the open buttons a learner can see: the hidden 0×0 probes carry no label.
function footerLabels(tree: renderer.ReactTestRenderer): string[] {
  return footerActions(tree)
    .filter((node) => node.props.accessibilityElementsHidden !== true)
    .map((node) =>
      node
        .findAll((child) => (child.type as any) === 'Text')
        .map((child) => String(child.props.children ?? ''))
        .join(''),
    );
}

async function renderDraw(navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
    );
  });
  await flush();
  return tree;
}

function footerActions(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      (node.type as any) === 'Pressable' &&
      (node.props.testID === 'screen-draw-primary-cta' || node.props.testID === 'screen-draw-secondary-cta'),
  );
}

describe('DrawScreen v9', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    walletFixture = { availablePulls: 12, reservePulls: 0 };
    manifestFixture = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
    resolveDeckFixture = csharpDeck();
    installDeckOkFixture = false;
    updatesFixture = {};
    manifestCalls.length = 0;
    remoteManifestLoader = null;
    consumeDeckPullsMock.mockClear();
    saveRewardWalletStateMock.mockClear();
    commitDrawMock.mockClear();
    scheduleProgressSyncMock.mockClear();
  });

  it('renders wallet-only top row and exactly two footer actions', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    expect(tree.root.findByProps({ testID: 'draw-header' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-card-stack-stage' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-pack-pulls-badge' })).toBeTruthy();
    expect(footerActions(tree)).toHaveLength(2);

    const headerText = tree.root
      .findByProps({ testID: 'draw-header' })
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => String(Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children ?? ''))
      .join('\n');

    expect(headerText).toContain('× 12');
    expect(headerText).not.toContain('Home');
    expect(collectText(tree)).toContain('Swipe right to arm this pack');
    expect(collectText(tree)).not.toContain('Pull briefing');
    expect(collectText(tree)).not.toContain('Current pool');
  });

  it('isolates the 3D pack in its own stacking context above the hero halo', async () => {
    // The pack wobbles on perspective + rotateY; without a stacking context of its own Fabric
    // hoists it next to the halo and Core Animation depth-sorts the halo through the tilted
    // half. The wrapper is a real native view (collapsable=false), stacked above the halo, and
    // adds no layout of its own.
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    const wrapper = tree.root.find((n) => (n.type as any) === 'View' && n.props.testID === 'draw-pack-3d-wrapper');
    expect(wrapper.props.collapsable).toBe(false);
    expect(wrapper.props.style.zIndex).toBeGreaterThanOrEqual(1);
    expect(Object.keys(wrapper.props.style)).toEqual(['zIndex']);
    // Inside the swipe zone, wrapping the pack (the only LinearGradient cover in the stage).
    const stage = tree.root.find((n) => (n.type as any) === 'View' && n.props.testID === 'draw-swipe-zone');
    expect(stage.findAll((n) => (n.type as any) === 'View' && n.props.testID === 'draw-pack-3d-wrapper')).toHaveLength(1);
    expect(wrapper.findAll((n) => (n.type as any) === 'LinearGradient').length).toBeGreaterThan(0);
    // The halo is a sibling before the stage, never inside the wrapper.
    expect(wrapper.findAll((n) => (n.type as any) === 'View' && n.props.style?.some?.((st: any) => st && st.borderRadius === 320))).toHaveLength(0);
  });

  it('opens 5 cards in one ceremony and routes to it', async () => {
    const navigate = vi.fn();
    const tree = await renderDraw(navigate);
    armPackSwipe(tree);

    const primary = tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    expect(primary.props.accessibilityLabel).toBe('Open 5 cards from C# Interview');
    expect(footerLabels(tree)).toEqual(['Open 5', 'Open 1']);

    await act(async () => {
      primary.props.onPress();
      await Promise.resolve();
    });

    expect(commitDrawMock).toHaveBeenCalledTimes(1);
    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 5);
    expect(consumeDeckPullsMock).toHaveBeenCalledWith('csharp', 5);
    expect(walletFixture.availablePulls).toBe(7);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      'DrawCeremony',
      expect.objectContaining({
        slug: 'csharp',
        drawResult: expect.objectContaining({ cards: expect.any(Array) }),
      }),
    );
    expect(navigate.mock.calls[0][1].drawResult.cards).toHaveLength(5);
    // The sync waits out the five-card reveal, not just the trip to the table.
    expect(scheduleProgressSyncMock).toHaveBeenCalledWith({ delayMs: drawCommittedSyncDelayMs(5), reason: 'draw_committed' });
    expect(drawCommittedSyncDelayMs(5)).toBeGreaterThan(DRAW_COMMITTED_SYNC_DELAY_MS);
  });

  it('opens 1 card with secondary action', async () => {
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();
    armPackSwipe(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.accessibilityLabel).toBe(
      'Open 1 card from C# Interview',
    );
    expect(consumeDeckPullsMock).toHaveBeenCalledWith('csharp', 1);
    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 1);
    const params = (navigate.mock.calls.at(-1) ?? [])[1];
    expect(params.drawResult.cards).toHaveLength(1);
    // A single card keeps the original sync delay.
    expect(scheduleProgressSyncMock).toHaveBeenCalledWith({ delayMs: DRAW_COMMITTED_SYNC_DELAY_MS, reason: 'draw_committed' });
  });

  it.each([
    [2, 'Open 2'],
    [3, 'Open 3'],
    [4, 'Open 4'],
    [5, 'Open 5'],
    [6, 'Open 5'],
    [9, 'Open 5'],
    [10, 'Open 5'],
    [12, 'Open 5'],
  ])('holding %i draws offers %s beside Open 1, and never Open 10', async (held, label) => {
    walletFixture = { availablePulls: held, reservePulls: 0 };
    const tree = await renderDraw();
    armPackSwipe(tree);

    expect(footerLabels(tree)).toEqual([label, 'Open 1']);
    const primary = tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    const secondary = tree.root.findByProps({ testID: 'screen-draw-secondary-cta' });
    expect(primary.props.disabled).toBe(false);
    expect(secondary.props.disabled).toBe(false);
    expect(primary.props.accessibilityLabel).toBe(`${label} cards from C# Interview`);
    // No greyed bigger button and no "save up" hint, whatever the balance.
    expect(collectText(tree)).not.toMatch(/Open 10|need \d+ draws|when you have/i);
  });

  it('sizes the batch by the cards still missing when they are fewer than the draws', async () => {
    resolveDeckFixture = csharpDeck(3);
    const tree = await renderDraw();
    armPackSwipe(tree);
    expect(footerLabels(tree)).toEqual(['Open 3', 'Open 1']);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
    });
    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 3);
    expect(consumeDeckPullsMock).toHaveBeenCalledWith('csharp', 3);
  });

  it('counts the opened cards off the missing ones, so the next batch never outgrows the pack', async () => {
    resolveDeckFixture = csharpDeck(6);
    const tree = await renderDraw();
    armPackSwipe(tree);
    expect(footerLabels(tree)).toEqual(['Open 5', 'Open 1']);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
    });

    // 7 draws left, 1 card missing: only Open 1 is left to offer.
    expect(walletFixture.availablePulls).toBe(7);
    expect(footerLabels(tree)).toEqual(['Open 1']);
  });

  it('re-reads the wallet right before the commit and opens only what the pack still holds', async () => {
    const navigate = vi.fn();
    const tree = await renderDraw(navigate);
    armPackSwipe(tree);
    expect(footerLabels(tree)).toEqual(['Open 5', 'Open 1']);

    // Another screen (or a sync) spent ten of the twelve draws after the buttons were drawn.
    walletFixture = { availablePulls: 2, reservePulls: 0 };
    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
    });

    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 2);
    expect(consumeDeckPullsMock).toHaveBeenCalledWith('csharp', 2);
    expect(walletFixture.availablePulls).toBe(0);
    expect(navigate.mock.calls[0][1].drawResult.cards).toHaveLength(2);
  });

  it('opens nothing when the pack holds no draws at the moment of the press', async () => {
    const navigate = vi.fn();
    const tree = await renderDraw(navigate);
    armPackSwipe(tree);

    walletFixture = { availablePulls: 0, reservePulls: 0 };
    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
    });

    expect(commitDrawMock).not.toHaveBeenCalled();
    expect(consumeDeckPullsMock).not.toHaveBeenCalled();
    expect(scheduleProgressSyncMock).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // The screen now shows the balance it just read: nothing to open, go and earn draws.
    expect(collectText(tree)).toContain('× 0');
    expect(tree.root.findByProps({ testID: 'draw-earn-pulls-cta' })).toBeTruthy();
    expect(collectText(tree)).not.toContain('Draw unavailable right now');
  });

  it('offers a single Open 1 when one draw remains', async () => {
    walletFixture = { availablePulls: 1, reservePulls: 0 };
    const navigate = vi.fn();
    const tree = await renderDraw(navigate);
    armPackSwipe(tree);

    // Both testIDs stay findable: the batch one as a hidden, disabled probe.
    expect(footerActions(tree)).toHaveLength(2);
    const batchProbe = tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    const open1 = tree.root.findByProps({ testID: 'screen-draw-secondary-cta' });
    expect(batchProbe.props.disabled).toBe(true);
    expect(batchProbe.props.accessibilityElementsHidden).toBe(true);
    expect(open1.props.disabled).toBe(false);
    expect(open1.props.accessibilityLabel).toBe('Open 1 card from C# Interview');
    expect(footerLabels(tree)).toEqual(['Open 1']);
    expect(collectText(tree)).not.toMatch(/Open 10|Open 5|need \d+ draws/);

    // The probe opens nothing even if pressed; Open 1 opens one card.
    await act(async () => {
      batchProbe.props.onPress();
      await Promise.resolve();
    });
    expect(commitDrawMock).not.toHaveBeenCalled();
    await act(async () => {
      open1.props.onPress();
      await Promise.resolve();
    });
    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 1);
    expect(consumeDeckPullsMock).toHaveBeenCalledWith('csharp', 1);
  });

  it('offers a single Open 1 when one card is missing, however many draws are held', async () => {
    resolveDeckFixture = csharpDeck(1);
    const tree = await renderDraw();
    armPackSwipe(tree);

    expect(footerLabels(tree)).toEqual(['Open 1']);
    expect(tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.disabled).toBe(true);
    expect(tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.disabled).toBe(false);
  });

  it('shows the earn-pulls escape CTA when no pulls remain', async () => {
    // When wallet is empty, the dead-end "two greyed-out Open buttons"
    // pattern is replaced with a prominent pokeBlue "Earn pulls by
    // studying" CTA that drops the user straight into a SessionCard run.
    // The two open testIDs remain in the tree as 0×0 hidden probes
    // (disabled) so the testID + disabled-state contract holds.
    walletFixture = { availablePulls: 0, reservePulls: 0 };
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    // Test contract preserved: both Open testIDs still exist + disabled
    expect(footerActions(tree)).toHaveLength(2);
    const open10 = tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    const open1 = tree.root.findByProps({ testID: 'screen-draw-secondary-cta' });
    expect(open10.props.disabled).toBe(true);
    expect(open1.props.disabled).toBe(true);
    expect(footerLabels(tree)).toEqual([]);
    expect(collectText(tree)).not.toMatch(/Open 10|Open 5/);

    // The per-pack "no pulls" text is preserved (hidden) for any
    // accessibility / collectText harness that checks for it.
    expect(collectText(tree)).toContain('No draws for this pack yet. Learn its cards to earn more.');

    // New escape CTA — visible + actionable
    const earnCta = tree.root.findByProps({ testID: 'draw-earn-pulls-cta' });
    expect(earnCta).toBeTruthy();
    expect(collectText(tree)).toContain('Earn draws by studying');
    expect(earnCta.props.accessibilityLabel).toBe("Start today's session to earn draws");

    act(() => {
      earnCta.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('SessionCard', { slug: 'csharp' });
  });

  it('supports neighbor hint selection and resets swipe arm state on switch', async () => {
    manifestFixture = [
      { slug: 'csharp', availability: 'live', title: 'C# Interview' },
      { slug: 'aws', availability: 'live', title: 'AWS Interview' },
    ];
    resolveDeckFixture = (slug: string) => {
      if (slug === 'aws') {
        return {
          Slug: 'aws',
          Title: 'AWS Interview',
          Cards: [{ StableUid: '2', OrderInDeck: 1, Difficulty: 1, Question: 'Q2' }],
        };
      }
      return {
        Slug: 'csharp',
        Title: 'C# Interview',
        Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
      };
    };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    armPackSwipe(tree);
    expect(tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.disabled).toBe(false);

    await act(async () => {
      tree.root.findByProps({ testID: 'draw-neighbor-left' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(collectText(tree)).toContain('AWS Interview');
    expect(tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.disabled).toBe(true);
  });

  it('labels the neighbour rail with the short deck title, two lines allowed', async () => {
    // 2026-10-14 three decks: csharp-basics is hidden, so the open pack here is SAA-C03.
    manifestFixture = [
      { slug: 'aws-saa-c03', availability: 'live', title: 'AWS Solutions Architect (SAA-C03)' },
      { slug: 'claude-ccdv-f', availability: 'live', title: 'Claude Developer Foundations (CCDV-F)' },
    ];
    resolveDeckFixture = (slug: string) => ({
      Slug: slug,
      Title: slug === 'claude-ccdv-f' ? 'Claude Developer Foundations (CCDV-F)' : 'AWS Solutions Architect (SAA-C03)',
      Cards: [{ StableUid: `${slug}-1`, OrderInDeck: 1, Difficulty: 1, Question: 'Q' }],
    });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen
          navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any}
          route={{ key: 'draw', name: 'Draw', params: { slug: 'aws-saa-c03' } } as any}
        />,
      );
    });
    await flush();

    const neighbour = tree.root.findByProps({ testID: 'draw-neighbor-left' });
    const title = neighbour.find(
      (node) => (node.type as any) === 'Text' && node.props.children === 'Claude CCDV-F',
    );
    expect(title.props.numberOfLines).toBe(2);
    // The accessibility label keeps the full name: a screen reader has room.
    expect(neighbour.props.accessibilityLabel).toBe('Select Claude Developer Foundations (CCDV-F)');
  });

  it('requires a swipe arm before either open action can fire', async () => {
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    const open10 = tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    const open1 = tree.root.findByProps({ testID: 'screen-draw-secondary-cta' });
    expect(open10.props.disabled).toBe(true);
    expect(open1.props.disabled).toBe(true);
    expect(tree.root.findAllByProps({ testID: 'draw-arm-fallback-cta' })).toHaveLength(0);

    await act(async () => {
      open10.props.onPress();
      open1.props.onPress();
      await Promise.resolve();
    });

    expect(commitDrawMock).not.toHaveBeenCalled();
    expect(consumeDeckPullsMock).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sizes the batch from spendable draws only, never the reserve', async () => {
    // 3 spendable + 5 in reserve: counting the reserve would offer Open 5 for a wallet that can
    // only pay for three right now.
    walletFixture = { availablePulls: 3, reservePulls: 5 };
    const tree = await renderDraw();
    armPackSwipe(tree);

    expect(footerLabels(tree)).toEqual(['Open 3', 'Open 1']);
    expect(tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.disabled).toBe(false);
    expect(tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.disabled).toBe(false);
    expect(collectText(tree)).toContain('× 3');
  });

  it('never charges the wallet when draw commit returns null', async () => {
    // Was "rolls back wallet pulls if draw commit returns null": it pinned
    // charge-then-restore, and passed because the snapshot write happened to
    // land. The charge now runs after the commit, so a failed commit costs
    // nothing to begin with and there is no rollback to get wrong. Same
    // user-visible guarantee, one fewer window to be killed in.
    const navigate = vi.fn();
    const walletBeforeOpen = { availablePulls: 12, reservePulls: 0 };
    walletFixture = { ...walletBeforeOpen };
    commitDrawMock.mockImplementationOnce(async () => null as any);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();
    armPackSwipe(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 5);
    expect(consumeDeckPullsMock).not.toHaveBeenCalled();
    // No snapshot write either -- the old restore is what erased pulls that
    // arrived while the draw was in flight.
    expect(saveRewardWalletStateMock).not.toHaveBeenCalled();
    expect(walletFixture).toEqual(walletBeforeOpen);
    expect(navigate).not.toHaveBeenCalled();
    expect(collectText(tree)).toContain('Draw unavailable right now');
  });

  it('never charges the wallet when the pool comes back empty', async () => {
    // An exhausted pool is a non-null result with zero cards. The old
    // `!result` guard did not catch it, so the wallet was debited and the
    // ceremony ran over nothing.
    const navigate = vi.fn();
    const walletBeforeOpen = { availablePulls: 12, reservePulls: 0 };
    walletFixture = { ...walletBeforeOpen };
    commitDrawMock.mockImplementationOnce(async () =>
      // `as any`: the mock's inferred return type is pinned to the happy-path
      // fixture above (cards non-empty). An exhausted pool is
      // exactly the shape that inference excludes, which is the bug.
      ({
        cards: [],
        poolExhausted: true,
        pityFiredFor: null,
        highlightedRarity: null,
        ownedAfter: 30,
        totalCards: 30,
        pityBefore: 0,
        pityAfter: 0,
      }) as any,
    );

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();
    armPackSwipe(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 5);
    expect(consumeDeckPullsMock).not.toHaveBeenCalled();
    expect(walletFixture).toEqual(walletBeforeOpen);
    expect(navigate).not.toHaveBeenCalled();
    expect(collectText(tree)).toContain('Every card in this pack is already yours.');
  });

  it('charges only for the cards a partly-drained pool actually handed over', async () => {
    // The sibling test above covers the pool that is exactly empty. This is the
    // interior the previous fix skipped: `cards.length === 0` was promoted to an
    // error, and 1..4 cards for an Open 5 stayed a success that billed five.
    // selectDrawCards stops at `remaining.length > 0` and reports the short pack
    // as `poolExhausted`, not as a failure, so nothing downstream objected.
    //
    // Two cards left (another device took the rest after this screen loaded),
    // twelve draws banked. The wallet must fall by two.
    const navigate = vi.fn();
    walletFixture = { availablePulls: 12, reservePulls: 0 };
    commitDrawMock.mockImplementationOnce(async () =>
      ({
        cards: Array.from({ length: 2 }, (_, index) => ({
          stableUid: `card-${index + 1}`,
          question: `Q${index + 1}`,
          difficulty: 1,
          rarity: 'COM' as const,
        })),
        poolExhausted: true,
        pityFiredFor: null,
        highlightedRarity: null,
        ownedAfter: 30,
        totalCards: 30,
        pityBefore: 0,
        pityAfter: 0,
      }) as any,
    );

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();
    armPackSwipe(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 5);
    // The number on the wire, not only the resulting balance.
    expect(consumeDeckPullsMock).toHaveBeenCalledWith('csharp', 2);
    expect(walletFixture.availablePulls).toBe(10);
    // A short pack is still a pack: real cards came out, so the ceremony runs.
    expect(navigate).toHaveBeenCalled();
    // The sync waits for the reveal of the cards that actually came out.
    expect(scheduleProgressSyncMock).toHaveBeenCalledWith({ delayMs: drawCommittedSyncDelayMs(2), reason: 'draw_committed' });
  });

  it('renders empty state when no active deck is available', async () => {
    manifestFixture = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
    resolveDeckFixture = null;
    updatesFixture = { csharp: { remoteUrl: null, remoteVersion: null, remoteSha256: null } };
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    expect(collectText(tree)).toContain('No active pack yet');
    const primary = tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    act(() => {
      primary.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Library');
  });

  it('opens the pack from the cached manifest without waiting on the network', async () => {
    // The manifest read used to be `{ preferRemote: true }`, so the tab sat
    // on "Preparing draw..." for the length of a CDN round trip -- forever,
    // on a network that accepts the connection and never answers.
    remoteManifestLoader = () => new Promise<any[]>(() => {});

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    expect(collectText(tree)).not.toContain('Preparing draw...');
    expect(footerLabels(tree)).toEqual(['Open 5', 'Open 1']);
    // The first read is cache-first; the revalidation still goes out.
    expect(manifestCalls[0]).toEqual({ preferRemote: false });
    expect(manifestCalls.some((call) => call.preferRemote)).toBe(true);
  });

  it('folds a newly published pack into the deck rail when the revalidation lands', async () => {
    let resolveRemote: ((decks: any[]) => void) | undefined;
    remoteManifestLoader = () =>
      new Promise<any[]>((resolve) => {
        resolveRemote = resolve;
      });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    expect(collectText(tree)).not.toContain('AWS Interview');

    await act(async () => {
      resolveRemote?.([
        { slug: 'csharp', availability: 'live', title: 'C# Interview' },
        { slug: 'aws', availability: 'live', title: 'AWS Interview' },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(collectText(tree)).toContain('AWS Interview');
    // The open pack is untouched by the revalidation.
    expect(tree.root.findByProps({ testID: 'draw-header' })).toBeTruthy();
    expect(footerLabels(tree)).toEqual(['Open 5', 'Open 1']);
  });

  it('auto-installs live pack when slug exists but deck is not installed yet', async () => {
    let resolveCalls = 0;
    resolveDeckFixture = () => {
      resolveCalls += 1;
      if (resolveCalls >= 2) {
        return {
          Slug: 'csharp',
          Title: 'C# Interview',
          Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
        };
      }
      return null;
    };
    updatesFixture = {
      csharp: {
        remoteUrl: 'https://cdn.example.com/content/csharp.json',
        remoteVersion: 'v1',
        remoteSha256: null,
      },
    };
    installDeckOkFixture = true;

    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();

    expect(tree.root.findByProps({ testID: 'draw-header' })).toBeTruthy();
    // The installed pack holds one card: a single Open 1.
    expect(footerLabels(tree)).toEqual(['Open 1']);
    expect(collectText(tree)).not.toContain('No active pack yet');
  });
});
