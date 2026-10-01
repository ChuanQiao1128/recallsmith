import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Y01: a C# question with a fenced code block reaches the draw and library surfaces as prose
// only. The real commitDraw maps the deck, and DrawResult renders its result: the featured
// question, the grid and the detail sheet never print raw backticks. An AWS card is untouched.

let walletFixture = { availablePulls: 2, reservePulls: 0 };
let viewportWidth = 390;
let walletLoader: () => Promise<{ availablePulls: number; reservePulls: number }> = async () =>
  walletFixture;

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
  },
}));

const SLUG = 'dotnet';
const SCOPE = 'devcards:u:anon:';
const FENCED =
  'What does this print?\n```csharp\nvar total = 0;\nforeach (var n in new[] { 1, 2 })\n    total += n;\nConsole.WriteLine(total);\n```';
const AWS =
  'A company stores logs in Amazon S3 and must keep them for 7 years at the LEAST cost. Which storage class meets these requirements?';
const deckCards = [
  { StableUid: 'code-1', Question: FENCED, Difficulty: 3, OrderInDeck: 1, Topic: 'Loops' },
  { StableUid: 'aws-1', Question: AWS, Difficulty: 1, OrderInDeck: 2 },
];
const deck = {
  Slug: SLUG,
  Title: '.NET Interview',
  Locale: 'en',
  Version: '1',
  DeckType: 1,
  IsFreeStarter: true,
  TotalCards: deckCards.length,
  FreeCardCount: deckCards.length,
  Cards: deckCards,
};

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async (slug: string) => (slug === SLUG ? deck : null)),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  getUserScopedKey: vi.fn(async (baseKey: string) => `${SCOPE}${baseKey}`),
}));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    // Image is what the rarity frame, the glow and the pack-art thumbnail render through
    // (the screen reads it defensively via readRN); a plain element so the featured-card
    // layout case can see where the frame sits.
    Image: (props: any) => React.createElement('Image', props),
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Modal: ({ children, visible }: any) => (visible ? React.createElement('Modal', null, children) : null),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    useWindowDimensions: () => ({ width: viewportWidth, height: 844, scale: 3, fontScale: 1 }),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children) };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

// 1.7: DrawResult reads the per-pack wallet for the "N pulls left" CTA.
vi.mock('../../src/features/gacha/rewards/deckWallet', () => ({
  loadDeckWallet: vi.fn((_slug: string) => walletLoader()),
}));

let permissionPromptPendingFixture = false;
const clearPermissionPromptPendingMock = vi.fn(async () => {});
vi.mock('../../src/screens/PermissionPromptScreen', () => ({
  isPermissionPromptPending: vi.fn(async () => permissionPromptPendingFixture),
  clearPermissionPromptPending: () => clearPermissionPromptPendingMock(),
}));

let shareResultFixture: { status: 'shared' | 'unavailable' | 'cancelled' | 'failed' } = { status: 'shared' };
// Rest parameters on the vi.fn: the wrapper below spreads whatever the screen passed
// (ref, opts). Spreading into a zero-parameter vi.fn is TS2556 ("A spread argument must
// either have a tuple type or be passed to a rest parameter") under tsc, which covers tests.
const shareDrawImageMock = vi.fn(async (..._args: unknown[]) => shareResultFixture);
vi.mock('../../src/features/gacha/share/shareDraw', () => ({
  SHARE_DRAW_TESTID: 'draw-result-share-button',
  shareDrawImage: (...args: unknown[]) => shareDrawImageMock(...args),
}));
let streakFixture = { currentDailyStreak: 0 };
vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => streakFixture),
}));
const maybeRequestRatingMock = vi.fn(async (..._args: unknown[]) => 'requested' as const);
vi.mock('../../src/features/gacha/milestones/ratingPrompt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/gacha/milestones/ratingPrompt')>()),
  maybeRequestRating: (...args: unknown[]) => maybeRequestRatingMock(...args),
}));

import { DrawResultScreen } from '../../src/screens/DrawResultScreen';
import { commitDraw } from '../../src/features/gacha/draw/drawCommit';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { buildLibraryCardRows } from '../../src/features/gacha/library/libraryMapper';

const STATE_KEY = `${SCOPE}devcards:draw-state:${SLUG}`;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function allText(tree: renderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
}

describe('question code on draw and library surfaces (Y01)', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    store.clear();
    invalidateDrawStateCache();
    store.set(STATE_KEY, JSON.stringify({ owned: [], pity: { draws: 0, threshold: 10 } }));
    walletFixture = { availablePulls: 2, reservePulls: 0 };
    walletLoader = async () => walletFixture;
    viewportWidth = 390;
    permissionPromptPendingFixture = false;
    shareResultFixture = { status: 'shared' };
    streakFixture = { currentDailyStreak: 0 };
  });

  it('commitDraw hands the reveal and grid the prose only, and leaves an AWS question unchanged', async () => {
    const result = await commitDraw(SLUG, 10);
    expect(result).not.toBeNull();
    const byUid = Object.fromEntries(result!.cards.map((card) => [card.stableUid, card]));
    expect(byUid['code-1'].question).toBe('What does this print?');
    expect(byUid['aws-1'].question).toBe(AWS);
  });

  it('renders the DrawResult featured card, grid and detail sheet without backticks', async () => {
    const result = await commitDraw(SLUG, 10);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'result',
            name: 'DrawResult',
            params: { slug: SLUG, deckTitle: '.NET Interview', drawResult: result, ownedAfter: 2, totalCards: 2 },
          } as any}
        />,
      );
    });
    await flush();

    const hostByTestID = (id: string) => tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);
    expect(hostByTestID('draw-result-summary-cell-0')).toHaveLength(1);
    expect(hostByTestID('draw-result-summary-cell-1')).toHaveLength(1);
    act(() => {
      hostByTestID('draw-result-summary-cell-0')[0].props.onPress();
    });

    const text = allText(tree);
    expect(text.some((line) => line.includes('`'))).toBe(false);
    expect(text.some((line) => line.includes('Console.WriteLine'))).toBe(false);
    expect(text).toContain('What does this print?');
    expect(text).toContain(AWS);
    const labels = tree.root
      .findAll((n) => typeof n.type === 'string' && typeof n.props.accessibilityLabel === 'string')
      .map((n) => n.props.accessibilityLabel as string);
    expect(labels.some((label) => label.includes('`'))).toBe(false);
  });

  // F01 z-tests-2: DrawResult and the reveal face strip inline-code backticks themselves, on top
  // of the drawCommit strip. Feeding them a question that still carries spans proves each of
  // the featured face, its label, the grid tiles and the detail sheet does its own strip. (The
  // summary-grid caption and the spotlight sheet print the drawCommit text as given.)
  it('strips inline-code backticks on the featured face, its label, the grid and the detail sheet', async () => {
    const committed = await commitDraw(SLUG, 10);
    const INLINE = 'Why does `List<int>` regrow on `Add(4)`?';
    const clean = 'Why does List<int> regrow on Add(4)?';
    const result = { ...committed!, cards: committed!.cards.map((card) => ({ ...card, question: INLINE })) };
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'result',
            name: 'DrawResult',
            params: { slug: SLUG, deckTitle: '.NET Interview', drawResult: result, ownedAfter: 2, totalCards: 2 },
          } as any}
        />,
      );
    });
    await flush();

    const hostByTestID = (id: string) => tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);
    const textOf = (n: renderer.ReactTestInstance) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    };

    // RevealCardFace slab.
    expect(hostByTestID('draw-result-featured-question').map(textOf)).toEqual([clean]);
    // Featured label.
    const featured = hostByTestID('screen-draw-result-featured-card');
    expect(featured.map((n) => n.props.accessibilityLabel)).toContain(`Open featured card detail: ${clean}`);
    // Featured slab plus one tile per drawn card in the all-cards sheet.
    act(() => {
      hostByTestID('draw-result-open-all-cards')[0].props.onPress();
    });
    expect(allText(tree).filter((line) => line === clean)).toHaveLength(1 + result.cards.length);

    act(() => {
      hostByTestID('draw-result-summary-cell-0')[0].props.onPress();
    });
    // Detail sheet title.
    expect(hostByTestID('draw-result-detail-question').map(textOf)).toEqual([clean]);
  });

  it('gives library tiles the prose only', () => {
    const rows = buildLibraryCardRows({ deck: deck as any, progress: [] });
    const byUid = Object.fromEntries(rows.map((row) => [row.stableUid, row]));
    expect(byUid['code-1'].question).toBe('What does this print?');
    expect(byUid['aws-1'].question).toBe(AWS);
  });
});
