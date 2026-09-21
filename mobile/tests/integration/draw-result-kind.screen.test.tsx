import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let walletFixture = { availablePulls: 2, reservePulls: 0 };
let viewportWidth = 390;
let walletLoader: () => Promise<{ availablePulls: number; reservePulls: number }> = async () =>
  walletFixture;

vi.mock('react-native', () => {
  const React = require('react');
  return {
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
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

vi.mock('../../src/features/gacha/rewards/rewardWallet', () => ({
  loadRewardWalletState: vi.fn(() => walletLoader()),
}));

let permissionPromptPendingFixture = false;
const clearPermissionPromptPendingMock = vi.fn(async () => {});
vi.mock('../../src/screens/PermissionPromptScreen', () => ({
  isPermissionPromptPending: vi.fn(async () => permissionPromptPendingFixture),
  clearPermissionPromptPending: () => clearPermissionPromptPendingMock(),
}));

let shareResultFixture: { status: 'shared' | 'unavailable' | 'cancelled' | 'failed' } = { status: 'shared' };
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

import { DrawResultScreen, FEATURED_STEM_LINES } from '../../src/screens/DrawResultScreen';

const DRAW_RESULT_FIXTURE = {
  poolId: 'csharp',
  pityBefore: 0,
  pityAfter: 1,
  pityTriggered: false,
  highlightedRarity: 'LEG' as const,
  cards: [
    { stableUid: '1', question: 'Q1', difficulty: 3, rarity: 'LEG' as const, tag: 'Core' },
    { stableUid: '2', question: 'Q2', difficulty: 2, rarity: 'RAR' as const },
  ],
};

function makeParams(overrides?: Record<string, unknown>) {
  return {
    slug: 'csharp',
    deckTitle: 'C# Interview',
    drawResult: DRAW_RESULT_FIXTURE,
    ownedAfter: 4,
    totalCards: 20,
    ...(overrides ?? {}),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
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

async function renderScreen(params: Record<string, unknown>): Promise<renderer.ReactTestRenderer> {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <DrawResultScreen
        navigation={{ navigate: vi.fn() } as any}
        route={{ key: 'result', name: 'DrawResult', params } as any}
      />,
    );
  });
  await flush();
  return tree;
}

describe('DrawResultScreen MCQ face mark', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    walletFixture = { availablePulls: 2, reservePulls: 0 };
    walletLoader = async () => walletFixture;
    viewportWidth = 390;
    permissionPromptPendingFixture = false;
    clearPermissionPromptPendingMock.mockClear();
    shareResultFixture = { status: 'shared' };
    streakFixture = { currentDailyStreak: 0 };
    shareDrawImageMock.mockClear();
    maybeRequestRatingMock.mockClear();
  });

  it('marks the featured MCQ card and leaves Q/A cards alone', async () => {
    const tree = await renderScreen(
      makeParams({
        drawResult: {
          ...DRAW_RESULT_FIXTURE,
          cards: [
            { stableUid: '1', question: 'Q1', difficulty: 3, rarity: 'LEG' as const, tag: 'Core', kind: 'mcq' as const, requiredCount: 2 },
            { stableUid: '2', question: 'Q2', difficulty: 2, rarity: 'RAR' as const },
          ],
        },
      }),
    );

    // The mock renders each View as composite → host, so a testID matches twice
    // under findAllByProps; the type-filtered find isolates the single host node
    // (the way the sibling harness locates the art window at :551).
    const kindHosts = tree.root.findAll(
      (n) => (n.type as any) === 'View' && n.props.testID === 'draw-result-featured-kind',
    );
    expect(kindHosts).toHaveLength(1);
    const artWindow = tree.root.find(
      (n) => (n.type as any) === 'View' && n.props.testID === 'draw-result-featured-art-window',
    );
    const kind = tree.root.findByProps({ testID: 'draw-result-featured-kind' });
    expect(kind.parent).toBe(artWindow);
    expect(kind.findAll((n) => (n.type as any) === 'Text').map((n) => n.props.children)).toEqual(['MC · pick 2']);

    const topic = tree.root.findByProps({ testID: 'draw-result-featured-topic' });
    expect(topic.findAll((n) => (n.type as any) === 'Text').map((n) => n.props.children)).toEqual(['Core']);

    const question = tree.root.findByProps({ testID: 'draw-result-featured-question' });
    expect(question.props.numberOfLines).toBe(FEATURED_STEM_LINES);

    const card = tree.root.find(
      (n) => (n.type as any) === 'Pressable' && n.props.testID === 'screen-draw-result-featured-card',
    );
    const frame = tree.root.findByProps({ testID: 'draw-result-featured-frame' });
    expect(card.children[card.children.length - 1]).toBe(frame);

    expect(collectText(tree).match(/MC · pick 2/g)).toHaveLength(1);
  });

  it('shows a plain MC mark for a single-answer card and nothing for Q/A', async () => {
    const single = await renderScreen(
      makeParams({
        drawResult: {
          ...DRAW_RESULT_FIXTURE,
          cards: [
            { stableUid: '1', question: 'Q1', difficulty: 3, rarity: 'LEG' as const, tag: 'Core', kind: 'mcq' as const, requiredCount: 1 },
            { stableUid: '2', question: 'Q2', difficulty: 2, rarity: 'RAR' as const },
          ],
        },
      }),
    );
    const kind = single.root.findByProps({ testID: 'draw-result-featured-kind' });
    expect(kind.findAll((n) => (n.type as any) === 'Text').map((n) => n.props.children)).toEqual(['MC']);

    const qa = await renderScreen(makeParams());
    expect(qa.root.findAllByProps({ testID: 'draw-result-featured-kind' })).toHaveLength(0);
  });
});
