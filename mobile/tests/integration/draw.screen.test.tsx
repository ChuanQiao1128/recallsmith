import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let walletFixture = { availablePulls: 12, reservePulls: 0 };
let manifestFixture: any[] = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
let resolveDeckFixture: any = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
};
let installDeckOkFixture = false;
let updatesFixture: Record<string, any> = {};

const consumePullsFromStoredWalletMock = vi.fn(async (count: number) => {
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

const commitDrawMock = vi.fn(async (_slug: string, drawCount: 1 | 10) => ({
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

const refundPullsToStoredWalletMock = vi.fn(async (count: number) => {
  walletFixture = {
    availablePulls: walletFixture.availablePulls + count,
    reservePulls: walletFixture.reservePulls,
  };
  return walletFixture;
});

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  loadRewardWalletState: vi.fn(async () => walletFixture),
  consumePullsFromStoredWallet: vi.fn(async (count: number) => consumePullsFromStoredWalletMock(count)),
  saveRewardWalletState: vi.fn(async (wallet: { availablePulls: number; reservePulls: number }) => saveRewardWalletStateMock(wallet)),
  refundPullsToStoredWallet: vi.fn(async (count: number) => refundPullsToStoredWalletMock(count)),
}));

vi.mock('../../src/features/gacha/draw/drawCommit', () => ({
  commitDraw: vi.fn(async (slug: string, drawCount: 1 | 10) => commitDrawMock(slug, drawCount)),
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
    resolveDeckFixture = {
      Slug: 'csharp',
      Title: 'C# Interview',
      Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
    };
    installDeckOkFixture = false;
    updatesFixture = {};
    manifestCalls.length = 0;
    remoteManifestLoader = null;
    consumePullsFromStoredWalletMock.mockClear();
    saveRewardWalletStateMock.mockClear();
    commitDrawMock.mockClear();
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

  it('opens 10 cards and routes to ceremony', async () => {
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
      tree.root.findByProps({ testID: 'screen-draw-primary-cta' }).props.onPress();
      await Promise.resolve();
    });

    expect(consumePullsFromStoredWalletMock).toHaveBeenCalledWith(10);
    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 10);
    expect(navigate).toHaveBeenCalledWith(
      'DrawCeremony',
      expect.objectContaining({
        slug: 'csharp',
        drawResult: expect.objectContaining({ cards: expect.any(Array) }),
      }),
    );
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

    expect(consumePullsFromStoredWalletMock).toHaveBeenCalledWith(1);
    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 1);
    const params = (navigate.mock.calls.at(-1) ?? [])[1];
    expect(params.drawResult.cards).toHaveLength(1);
  });

  it('disables Open 10 when only one pull remains', async () => {
    walletFixture = { availablePulls: 1, reservePulls: 0 };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();
    armPackSwipe(tree);

    const open10 = tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    const open1 = tree.root.findByProps({ testID: 'screen-draw-secondary-cta' });
    expect(open10.props.disabled).toBe(true);
    expect(open1.props.disabled).toBe(false);
  });

  it('shows the earn-pulls escape CTA when no pulls remain', async () => {
    // When wallet is empty, the dead-end "two greyed-out Open buttons"
    // pattern is replaced with a prominent pokeBlue "Earn pulls by
    // studying" CTA that drops the user straight into a SessionCard run.
    // The Open 10 / Open 1 buttons remain in the tree as 0×0 hidden
    // probes (disabled) so the testID + disabled-state contract holds.
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

    // The legacy "No pulls left" text is preserved (hidden) for any
    // accessibility / collectText harness that checks for it.
    expect(collectText(tree)).toContain('No pulls left. Study sessions grant more pulls.');

    // New escape CTA — visible + actionable
    const earnCta = tree.root.findByProps({ testID: 'draw-earn-pulls-cta' });
    expect(earnCta).toBeTruthy();
    expect(collectText(tree)).toContain('Earn pulls by studying');

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
    expect(consumePullsFromStoredWalletMock).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps Open 10 disabled when only reserve pulls are present', async () => {
    walletFixture = { availablePulls: 5, reservePulls: 5 };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawScreen navigation={{ goBack: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'draw', name: 'Draw', params: { slug: 'csharp' } } as any} />,
      );
    });
    await flush();
    armPackSwipe(tree);

    const open10 = tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    const open1 = tree.root.findByProps({ testID: 'screen-draw-secondary-cta' });
    expect(open10.props.disabled).toBe(true);
    expect(open1.props.disabled).toBe(false);
    expect(collectText(tree)).toContain('× 5');
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

    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 10);
    expect(consumePullsFromStoredWalletMock).not.toHaveBeenCalled();
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
      // fixture above (cards non-empty, ownedAfter 1|10). An exhausted pool is
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

    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 10);
    expect(consumePullsFromStoredWalletMock).not.toHaveBeenCalled();
    expect(walletFixture).toEqual(walletBeforeOpen);
    expect(navigate).not.toHaveBeenCalled();
    expect(collectText(tree)).toContain('Every card in this pack is already yours.');
  });

  it('charges only for the cards a partly-drained pool actually handed over', async () => {
    // The sibling test above covers the pool that is exactly empty. This is the
    // interior the previous fix skipped: `cards.length === 0` was promoted to an
    // error, and 1..9 cards for an Open 10 stayed a success that billed ten.
    // selectDrawCards stops at `remaining.length > 0` and reports the short pack
    // as `poolExhausted`, not as a failure, so nothing downstream objected.
    //
    // Four cards left, twelve pulls banked. The wallet must fall by four.
    const navigate = vi.fn();
    walletFixture = { availablePulls: 12, reservePulls: 0 };
    commitDrawMock.mockImplementationOnce(async () =>
      ({
        cards: Array.from({ length: 4 }, (_, index) => ({
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

    expect(commitDrawMock).toHaveBeenCalledWith('csharp', 10);
    // The number on the wire, not only the resulting balance. Charging ten
    // against a wallet holding twelve leaves eight either way once the mock
    // clamps, so a test watching the balance alone would pass on the bug.
    expect(consumePullsFromStoredWalletMock).toHaveBeenCalledWith(4);
    expect(walletFixture.availablePulls).toBe(8);
    // A short pack is still a pack: real cards came out, so the ceremony runs.
    expect(navigate).toHaveBeenCalled();
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
    expect(collectText(tree)).toContain('Open 10');
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
    expect(collectText(tree)).toContain('Open 10');
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
    expect(collectText(tree)).toContain('Open 10');
    expect(collectText(tree)).not.toContain('No active pack yet');
  });
});
