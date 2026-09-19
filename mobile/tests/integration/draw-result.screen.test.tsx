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

describe('DrawResultScreen v9', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    walletFixture = { availablePulls: 2, reservePulls: 0 };
    walletLoader = async () => walletFixture;
    viewportWidth = 390;
    permissionPromptPendingFixture = false;
    clearPermissionPromptPendingMock.mockClear();
  });

  it('renders collection bar, featured card, single primary CTA and done link', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any} />,
      );
    });
    await flush();

    expect(tree.root.findByProps({ testID: 'draw-result-header' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-result-collection-bar' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'screen-draw-result-featured-card' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-result-done-link' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'screen-draw-result-secondary-cta' })).toHaveLength(0);
    expect(collectText(tree)).toContain('4/20');
  });

  it('renders rarity strip in COM, RAR, LEG order', async () => {
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

    const strip = tree.root.findByProps({ testID: 'draw-result-summary-strip' });
    const stripTexts = strip.findAll((node) => (node.type as any) === 'Text').map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
    expect(stripTexts).toEqual(['0 COM', '1 RAR', '1 LEG']);
  });

  it('routes primary action to Draw when pulls remain', async () => {
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen navigation={{ navigate } as any} route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any} />,
      );
    });
    await flush();

    const primary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    act(() => {
      primary.props.onPress();
    });

    expect(collectText(tree)).toContain('Continue draw');
    expect(navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp' });
  });

  it('routes primary action to Library naming the cards just drawn when pulls are empty', async () => {
    walletFixture = { availablePulls: 0, reservePulls: 0 };
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen navigation={{ navigate } as any} route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any} />,
      );
    });
    await flush();

    const primary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    act(() => {
      primary.props.onPress();
    });

    expect(collectText(tree)).toContain('Go to Library');
    // Was `{ focusSlug, scrollToNew }` only, which left Library guessing and
    // guessing wrong (it highlighted the first *unstudied* card). The uids
    // of the cards this screen is showing are now part of the ask.
    expect(navigate).toHaveBeenCalledWith('Library', {
      focusSlug: 'csharp',
      scrollToNew: true,
      highlightUids: ['1', '2'],
    });
  });

  it('keeps primary CTA non-routable until wallet pulls resolve', async () => {
    const navigate = vi.fn();
    let resolveWallet:
      | ((value: { availablePulls: number; reservePulls: number }) => void)
      | undefined;
    walletLoader = () =>
      new Promise((resolve) => {
        resolveWallet = resolve;
      });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate } as any}
          route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any}
        />,
      );
    });

    const primary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    expect(collectText(tree)).toContain('Checking pulls...');
    act(() => {
      primary.props.onPress();
    });
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => {
      resolveWallet?.({ availablePulls: 0, reservePulls: 0 });
      await Promise.resolve();
    });

    const resolvedPrimary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    expect(collectText(tree)).toContain('Go to Library');
    act(() => {
      resolvedPrimary.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Library', {
      focusSlug: 'csharp',
      scrollToNew: true,
      highlightUids: ['1', '2'],
    });
  });

  it('routes done link back to Home', async () => {
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen navigation={{ navigate } as any} route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any} />,
      );
    });
    await flush();

    act(() => {
      tree.root.findByProps({ testID: 'draw-result-done-link' }).props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('Home');
  });

  it('routes the first Done into PermissionPrompt once when the onboarding flag is pending', async () => {
    permissionPromptPendingFixture = true;
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen navigation={{ navigate } as any} route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any} />,
      );
    });
    await flush();

    act(() => {
      tree.root.findByProps({ testID: 'draw-result-done-link' }).props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('PermissionPrompt');
    expect(navigate).not.toHaveBeenCalledWith('Home');
    expect(clearPermissionPromptPendingMock).toHaveBeenCalledTimes(1);
  });

  it('opens and closes detail modal from grid card', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any} />,
      );
    });
    await flush();

    act(() => {
      tree.root.findByProps({ testID: 'draw-result-open-all-cards' }).props.onPress();
    });
    act(() => {
      tree.root.findByProps({ testID: 'screen-draw-result-grid-card-0' }).props.onPress();
    });

    const close = tree.root.findByProps({ testID: 'screen-draw-result-detail-close' });
    expect(close).toBeTruthy();

    act(() => {
      close.props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'screen-draw-result-detail-close' })).toHaveLength(0);
  });

  it('keeps sheet testID with single snap point and handles empty draw state', async () => {
    const navigate = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate } as any}
          route={{ key: 'result', name: 'DrawResult', params: makeParams({ drawResult: { ...DRAW_RESULT_FIXTURE, cards: [] } }) } as any}
        />,
      );
    });
    await flush();

    expect(collectText(tree)).toContain('Nothing pulled');

    const primary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    act(() => {
      primary.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp' });
  });

  it('opens all-cards sheet from explicit trigger and keeps 92% snap point metadata', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any} />,
      );
    });
    await flush();

    expect(tree.root.findAllByProps({ testID: 'draw-result-all-cards-sheet' })).toHaveLength(0);
    act(() => {
      tree.root.findByProps({ testID: 'draw-result-open-all-cards' }).props.onPress();
    });
    const sheet = tree.root.findByProps({ testID: 'draw-result-all-cards-sheet' });
    expect(sheet.props.snapPoints).toEqual(['92%']);
    act(() => {
      tree.root.findByProps({ testID: 'draw-result-open-all-cards' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'draw-result-all-cards-sheet' })).toHaveLength(0);
  });

  it.each([360, 375, 390, 430])(
    'keeps W-BASE, W-CTA, and W-MODAL contracts at %ipt width',
    async (width) => {
      viewportWidth = width;
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

      expect(tree.root.findByProps({ testID: 'screen-draw-result-root' })).toBeTruthy();
      const primaryCta = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
      const primaryText = primaryCta.find(
        (node: any) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
      );
      expect(primaryText.props.numberOfLines).toBe(1);

      act(() => {
        tree.root.findByProps({ testID: 'screen-draw-result-featured-card' }).props.onPress();
      });
      expect(tree.root.findByProps({ testID: 'screen-draw-result-detail-close' })).toBeTruthy();
    },
  );
});
