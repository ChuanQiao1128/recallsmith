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

// Partial mock (only loadRewardWalletState): this is exactly the mock hazard the
// selector's dedicated module guards against — spendablePullsNow lives in its own
// module and imports only the type, so it is unaffected by this partial mock.
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

import { DrawResultScreen } from '../../src/screens/DrawResultScreen';

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

describe('DrawResultScreen pulls-left selector (MGACHA-21)', () => {
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

  it('shows the same spendable count as the Draw badge when reserve pulls exist', async () => {
    walletFixture = { availablePulls: 60, reservePulls: 5 };
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any}
        />,
      );
    });
    await flush();

    const text = collectText(tree);
    expect(text).toContain('60 pulls left');
    expect(text).not.toContain('65 pulls left');
  });

  it('still offers the library path when no pulls are spendable', async () => {
    walletFixture = { availablePulls: 0, reservePulls: 0 };
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any}
        />,
      );
    });
    await flush();

    expect(collectText(tree)).toContain('Go to Library');
  });
});
