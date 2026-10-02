import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';
import { colors } from '../../src/theme/colors';

// deckCache memoizes deck reads at module scope; clear it between tests so a
// changed resolveDeckBySlug mock is not shadowed by a prior test's entry (G30).
beforeEach(() => {
  invalidateDeckCache();
});

let walletFixture = { availablePulls: 2, reservePulls: 0 };
let manifestFixture: any[] = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
let resolveDeckFixture: any = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
};
let updatesFixture: Record<string, any> = {};

// Swappable async impls so a test can hold a specific call pending.
let loadWalletImpl: () => Promise<any> = async () => walletFixture;
let installDeckImpl: () => Promise<boolean> = async () => false;
let commitDrawImpl: (slug: string, drawCount: 1 | 10, options?: any) => Promise<any> = async (
  _slug,
  drawCount,
) => ({
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
});

const loadDeckWalletMock = vi.fn(() => loadWalletImpl());
const consumeDeckPullsMock = vi.fn(async (_slug: string, count: number) => {
  const spent = Math.min(count, walletFixture.availablePulls);
  const nextWallet = {
    availablePulls: Math.max(0, walletFixture.availablePulls - spent),
    reservePulls: walletFixture.reservePulls,
  };
  walletFixture = nextWallet;
  return { wallet: nextWallet, spent, promotedFromReserve: 0 };
});
const commitDrawMock = vi.fn((slug: string, drawCount: 1 | 10, options?: any) =>
  commitDrawImpl(slug, drawCount, options),
);
const loadDrawStateMock = vi.fn(async () => ({ owned: [], pity: null }));

// Records the latest useFocusEffect callback so a test can invoke it inside act
// to simulate the Draw screen regaining focus after a pull.
const focusHolder = vi.hoisted(() => ({ callback: null as null | (() => void | (() => void)) }));

// The react-native double ALSO exports Image and Animated so hasAnimated is
// true and the PNG cover path (with its auto-arm timer) actually renders.
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
    Image: (props: any) => React.createElement('Image', props),
    Animated: {
      Value: class {
        v: number;
        constructor(v: number) {
          this.v = v;
        }
        interpolate() {
          return 0;
        }
      },
      View: ({ children, ...props }: any) => React.createElement('AnimatedView', props, children),
      loop: () => ({ start: () => {}, stop: () => {} }),
      sequence: () => ({}),
      timing: () => ({}),
      delay: () => ({}),
    },
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
    focusHolder.callback = callback;
    React.useEffect(() => callback(), [callback]);
  },
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

// deckCache reads the user scope through a guarded dynamic import of
// progressScope; mock it so that import resolves to a fixed scope instead of
// dragging in the real authStore -> react-native chain the runner cannot parse.
vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => manifestFixture),
  resolveDeckBySlug: vi.fn(async (slug: string) => {
    if (typeof resolveDeckFixture === 'function') return resolveDeckFixture(slug);
    return resolveDeckFixture;
  }),
  checkManifestForUpdates: vi.fn(async () => updatesFixture),
  installDeckFromUrl: vi.fn(() => installDeckImpl()),
}));

// 1.7: DrawScreen reads/spends/refunds the per-pack wallet and runs the
// first-visit bootstrap + legacy migration on load (both inert no-ops here).
vi.mock('../../src/features/gacha/rewards/deckWallet', () => ({
  loadDeckWallet: vi.fn(() => loadDeckWalletMock()),
  consumeDeckPulls: vi.fn(async (slug: string, count: number) => consumeDeckPullsMock(slug, count)),
  refundDeckPulls: vi.fn(async () => walletFixture),
  ensureDeckBootstrap: vi.fn(async () => ({ granted: 0, wallet: walletFixture })),
  migrateLegacyWalletIfNeeded: vi.fn(async () => ({ kind: 'noop', moved: {} })),
}));

vi.mock('../../src/features/gacha/draw/drawCommit', () => ({
  commitDraw: vi.fn((slug: string, drawCount: 1 | 10, options?: any) => commitDrawMock(slug, drawCount, options)),
}));

vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  loadDrawState: vi.fn(async () => loadDrawStateMock()),
}));

const scheduleProgressSyncMock = vi.fn();
vi.mock('../../src/sync/progressSync', () => ({
  scheduleProgressSync: (arg?: any) => scheduleProgressSyncMock(arg),
}));

import { DrawScreen } from '../../src/screens/DrawScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

function renderDraw(params: any, navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <DrawScreen
        navigation={{ goBack: vi.fn(), navigate } as any}
        route={{ key: 'draw', name: 'Draw', params } as any}
      />,
    );
  });
  return { tree, navigate };
}

// Flatten a style prop (Pressable's is a function; others are arrays) into one
// object by merging in order — the react-native double's StyleSheet.create is
// an identity, so each entry is a plain object.
function flattenStyle(style: any): Record<string, any> {
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  const list = Array.isArray(resolved) ? resolved : [resolved];
  return list.reduce((acc: Record<string, any>, item: any) => {
    if (!item) return acc;
    if (Array.isArray(item)) return Object.assign(acc, flattenStyle(item));
    return Object.assign(acc, item);
  }, {});
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

function statusText(tree: renderer.ReactTestRenderer): string {
  const c = tree.root.findByProps({ testID: 'draw-open-status' }).props.children;
  return Array.isArray(c) ? c.join('') : String(c ?? '');
}

describe('DrawScreen pack arming (I01)', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    walletFixture = { availablePulls: 2, reservePulls: 0 };
    manifestFixture = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
    resolveDeckFixture = {
      Slug: 'csharp',
      Title: 'C# Interview',
      Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
    };
    updatesFixture = {};
    loadWalletImpl = async () => walletFixture;
    installDeckImpl = async () => false;
    commitDrawImpl = async (_slug, drawCount) => ({
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
    });
    focusHolder.callback = null;
    loadDeckWalletMock.mockClear();
    consumeDeckPullsMock.mockClear();
    commitDrawMock.mockClear();
    loadDrawStateMock.mockClear();
    scheduleProgressSyncMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-arms Open 1 when the second load after opening the tab lands after the arm timer', async () => {
    walletFixture = { availablePulls: 2, reservePulls: 0 };
    // The tab opens with no slug, so load() resolves 'csharp' via
    // loadActiveDeckSlug, sets selectedSlug and a second load() runs. Hold that
    // second wallet read so it lands after the 250 ms arm timer.
    let walletCall = 0;
    let releaseSecondWallet!: (wallet: any) => void;
    loadWalletImpl = () => {
      walletCall += 1;
      if (walletCall >= 2) {
        return new Promise((resolve) => {
          releaseSecondWallet = resolve;
        });
      }
      return Promise.resolve({ availablePulls: 2, reservePulls: 0 });
    };

    const { tree } = renderDraw({});
    await flush();
    await advance(300);
    await act(async () => {
      releaseSecondWallet({ availablePulls: 2, reservePulls: 0 });
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    await advance(300);

    expect(loadDeckWalletMock).toHaveBeenCalledTimes(2);
    expect(tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.disabled).toBe(false);
  });

  it('re-arms Open 1 when the Draw screen regains focus after a pull', async () => {
    walletFixture = { availablePulls: 5, reservePulls: 0 };
    const navigate = vi.fn();
    const { tree } = renderDraw({ slug: 'csharp' }, navigate);
    await flush();
    await advance(300);

    // Armed → Open 1 fires and routes to the ceremony.
    await act(async () => {
      tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalled();

    // A pull disarms the pack; returning to Draw must re-arm it.
    await act(async () => {
      focusHolder.callback?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    await advance(300);

    expect(tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.disabled).toBe(false);
  });

  it('gives Open 1 the primary style when pulls are between 1 and 9', async () => {
    walletFixture = { availablePulls: 3, reservePulls: 0 };
    const mid = renderDraw({ slug: 'csharp' });
    await flush();
    await advance(300);

    const midOpen1 = mid.tree.root.findByProps({ testID: 'screen-draw-secondary-cta' });
    const midOpen10 = mid.tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    expect(flattenStyle(midOpen1.props.style).backgroundColor).toBe(colors.pokeBlue);
    expect(flattenStyle(midOpen10.props.style).backgroundColor).toBe('transparent');
    expect(collectText(mid.tree)).toContain('Open 10 · need 10 draws');

    walletFixture = { availablePulls: 12, reservePulls: 0 };
    const full = renderDraw({ slug: 'csharp' });
    await flush();
    await advance(300);

    const fullOpen1 = full.tree.root.findByProps({ testID: 'screen-draw-secondary-cta' });
    const fullOpen10 = full.tree.root.findByProps({ testID: 'screen-draw-primary-cta' });
    expect(flattenStyle(fullOpen10.props.style).backgroundColor).toBe(colors.pokeBlue);
    expect(flattenStyle(fullOpen1.props.style).backgroundColor).toBe('transparent');
    expect(collectText(full.tree)).not.toContain('need 10');
  });

  it('says why the open buttons are disabled while a pack loads or opens', async () => {
    // (a) A neighbour switch whose deck read is held → "Loading pack…".
    manifestFixture = [
      { slug: 'csharp', availability: 'live', title: 'C# Interview' },
      { slug: 'aws', availability: 'live', title: 'AWS Interview' },
    ];
    let releaseAws!: (deck: any) => void;
    resolveDeckFixture = (slug: string) => {
      if (slug === 'aws') {
        return new Promise((resolve) => {
          releaseAws = resolve;
        });
      }
      return {
        Slug: 'csharp',
        Title: 'C# Interview',
        Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
      };
    };
    walletFixture = { availablePulls: 12, reservePulls: 0 };

    const { tree } = renderDraw({ slug: 'csharp' });
    await flush();
    await advance(300);

    await act(async () => {
      tree.root.findByProps({ testID: 'draw-neighbor-left' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(statusText(tree)).toBe('Loading pack…');

    await act(async () => {
      releaseAws({
        Slug: 'aws',
        Title: 'AWS Interview',
        Cards: [{ StableUid: '2', OrderInDeck: 1, Difficulty: 1, Question: 'Q2' }],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(statusText(tree)).toBe('');

    // (b) A held commitDraw after Open 1 is pressed → "Opening…".
    manifestFixture = [{ slug: 'csharp', availability: 'live', title: 'C# Interview' }];
    resolveDeckFixture = {
      Slug: 'csharp',
      Title: 'C# Interview',
      Cards: [{ StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1' }],
    };
    let releaseCommit!: (result: any) => void;
    commitDrawImpl = () =>
      new Promise((resolve) => {
        releaseCommit = resolve;
      });

    const opening = renderDraw({ slug: 'csharp' });
    await flush();
    await advance(300);

    await act(async () => {
      opening.tree.root.findByProps({ testID: 'screen-draw-secondary-cta' }).props.onPress();
      await Promise.resolve();
    });
    expect(statusText(opening.tree)).toBe('Opening…');

    await act(async () => {
      releaseCommit({
        cards: [{ stableUid: 'card-1', question: 'Q1', difficulty: 1, rarity: 'COM' as const }],
        poolExhausted: false,
        pityFiredFor: null,
        highlightedRarity: null,
        ownedAfter: 1,
        totalCards: 30,
        pityBefore: 0,
        pityAfter: 1,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(statusText(opening.tree)).toBe('');
  });

  it('shows Downloading pack… while the pack installs', async () => {
    // Auto-install fixture: the deck is not cached, the manifest offers a
    // remote URL, and the install is held pending so the loading screen sits
    // on the "Downloading pack…" copy.
    resolveDeckFixture = null;
    updatesFixture = {
      csharp: {
        remoteUrl: 'https://cdn.example.com/content/csharp.json',
        remoteVersion: 'v1',
        remoteSha256: null,
      },
    };
    let releaseInstall!: (ok: boolean) => void;
    installDeckImpl = () =>
      new Promise((resolve) => {
        releaseInstall = resolve;
      });

    const { tree } = renderDraw({ slug: 'csharp' });
    await flush();

    expect(collectText(tree)).toContain('Downloading pack…');
    expect(collectText(tree)).not.toContain('Preparing draw...');

    await act(async () => {
      releaseInstall(false);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
  });

  it('draws the whole pack cover with contain at 100% of an unpadded pack', async () => {
    const { tree } = renderDraw({ slug: 'csharp' });
    await flush();
    await advance(300);

    const cover = tree.root.findByProps({ testID: 'draw-pack-cover-image' });
    expect(cover.props.resizeMode).toBe('contain');
    const coverStyle = flattenStyle(cover.props.style);
    expect(coverStyle.width).toBe('100%');
    expect(coverStyle.height).toBe('100%');

    const face = flattenStyle(tree.root.findByProps({ testID: 'draw-pack-face' }).props.style);
    expect(face.paddingHorizontal).toBe(0);
    expect(face.paddingVertical).toBe(0);
  });

  it('keeps the shine sweep faint over a PNG cover', async () => {
    const { tree } = renderDraw({ slug: 'csharp' });
    await flush();
    await advance(300);

    const bg = flattenStyle(tree.root.findByProps({ testID: 'draw-pack-shine' }).props.style).backgroundColor;
    const match = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(bg);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeLessThanOrEqual(0.25);
  });
});
