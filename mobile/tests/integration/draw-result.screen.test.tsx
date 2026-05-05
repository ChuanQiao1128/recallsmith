import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let walletFixture = { availablePulls: 2, reservePulls: 0 };

vi.mock('react-native', () => {
  const React = require('react');
  return {
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Modal: ({ children, visible }: any) => (visible ? React.createElement('Modal', null, children) : null),
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles },
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
  loadRewardWalletState: vi.fn(async () => walletFixture),
}));

import { DrawResultScreen } from '../../src/screens/DrawResultScreen';
import { MOCK_DRAW_RESULTS } from '../../src/mock/draw';

function findPressablesByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

function collectText(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
    const c = node.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  }).join('\n');
}

function makeRouteParams(overrides?: Record<string, unknown>) {
  return {
    slug: 'csharp',
    drawResult: MOCK_DRAW_RESULTS,
    deckTitle: 'C# Interview',
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

describe('DrawResultScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    walletFixture = { availablePulls: 2, reservePulls: 0 };
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('opens card detail modal from a draw result card', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams() } as any} />);
    });

    act(() => {
      findPressablesByText(tree, MOCK_DRAW_RESULTS.cards[0].question)[0].props.onPress();
    });

    const textBlob = collectText(tree);

    expect(textBlob).toContain('Close detail');
    expect(textBlob).toContain(MOCK_DRAW_RESULTS.cards[0].question);
    expect(textBlob).not.toMatch(/reveal layer|premium|library detail takes over/i);
  });

  it('uses single-action draw flow actions instead of study/start-level actions', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams() } as any} />);
    });
    await flush();

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Continue draw');
    expect(textBlob).toContain('Done');
    expect(textBlob).not.toContain('Enter level');
    expect(textBlob).not.toContain('Store for later');
    expect(tree.root.findByProps({ testID: 'draw-result-collection-bar' })).toBeTruthy();
    expect(textBlob).toContain('Collection 4/20');
    expect(tree.root.findAllByProps({ testID: 'screen-draw-result-ghost-cta' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'screen-draw-result-secondary-cta' })).toHaveLength(0);
  });

  it('uses the reward draw naming system consistently on the result page', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams() } as any} />);
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Reward draw result');
    expect(textBlob).toContain('drawn cards');
    expect(textBlob).toContain('seed #');
    expect(textBlob).not.toContain('COLLECTIBLE REVEAL');
    expect(textBlob).not.toContain('BOSS PULL');
  });

  it('keeps ceremony handoff jargon out of the result hero', async () => {
    const jargonSafeResult = {
      ...MOCK_DRAW_RESULTS,
      cards: [
        {
          stableUid: 'handoff-1',
          question: 'What should a queue consumer do after processing a message?',
          difficulty: 2,
          rarity: 'LEG' as const,
          tag: 'Messaging',
        },
      ],
    };
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'draw-result',
            name: 'DrawResult',
            params: {
              slug: 'csharp',
              drawResult: jargonSafeResult,
              deckTitle: 'Messaging Patterns',
              ceremonyEcho: { rarity: 'LEG', phaseCue: 'Center card revealed last · Flip axis at 180°' },
            },
          } as any}
        />,
      );
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Reward ready');
    expect(textBlob).toContain('Legendary · just drawn');
    expect(textBlob).not.toMatch(/axis|breach|unlocked|core|drift|resonance/i);
  });

  it('omits seed placeholders when no seed label is available', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'draw-result',
            name: 'DrawResult',
            params: makeRouteParams({ drawResult: { ...MOCK_DRAW_RESULTS, seedLabel: undefined } }),
          } as any}
        />,
      );
    });

    const textBlob = collectText(tree);
    expect(textBlob).not.toContain('seed #----');
  });

  it('uses supplied deck titles instead of deriving labels from slug', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'draw-result',
            name: 'DrawResult',
            params: makeRouteParams({
              slug: 'frontend',
              deckTitle: 'Frontend Patterns',
              drawResult: { ...MOCK_DRAW_RESULTS, poolId: 'frontend' },
            }),
          } as any}
        />,
      );
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Frontend Patterns');
    expect(textBlob).not.toContain('C# Interview');
  });

  it('does not fabricate card tags for unknown-topic draw cards', async () => {
    const unknownTopicResult = {
      ...MOCK_DRAW_RESULTS,
      cards: [
        {
          stableUid: 'unknown-1',
          question: 'What should a queue consumer do after processing a message?',
          difficulty: 2,
          rarity: 'COM' as const,
        },
      ],
    };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams({ drawResult: unknownTopicResult, deckTitle: 'Queue Patterns' }) } as any}
        />,
      );
    });

    const textBlob = collectText(tree);
    expect(textBlob).not.toContain('CORE');
  });

  it('gives single-pull results a dedicated hero outcome', async () => {
    const singlePull = { ...MOCK_DRAW_RESULTS, cards: [MOCK_DRAW_RESULTS.cards[0]] };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams({ drawResult: singlePull }) } as any} />,
      );
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Single pull secured');
    expect(textBlob).toContain('1 drawn card ready');
    expect(textBlob).toContain(singlePull.cards[0].question);
  });

  it('provides the required DrawResult testIDs including modal close action', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams() } as any} />);
    });

    expect(tree.root.findByProps({ testID: 'screen-draw-result-root' })).toBeTruthy();
    const primaryCta = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    expect(primaryCta).toBeTruthy();
    expect(primaryCta.props.accessibilityRole).toBe('button');
    expect(primaryCta.props.accessibilityLabel).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-result-collection-bar' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-result-done-link' })).toBeTruthy();

    const featuredCard = tree.root.findByProps({ testID: 'screen-draw-result-featured-card' });
    expect(featuredCard).toBeTruthy();
    expect(featuredCard.props.accessibilityRole).toBe('button');
    expect(String(featuredCard.props.accessibilityLabel)).toContain('Open featured reward detail');

    const firstGridCard = tree.root.findByProps({ testID: 'screen-draw-result-grid-card-0' });
    expect(firstGridCard).toBeTruthy();
    expect(firstGridCard.props.accessibilityRole).toBe('button');
    expect(String(firstGridCard.props.accessibilityLabel)).toContain('Open reward detail');

    act(() => {
      findPressablesByText(tree, MOCK_DRAW_RESULTS.cards[0].question)[0].props.onPress();
    });

    const closeDetail = tree.root.findByProps({ testID: 'screen-draw-result-detail-close' });
    expect(closeDetail).toBeTruthy();

    act(() => {
      closeDetail.props.onPress();
    });

    expect(tree.root.findAllByProps({ testID: 'screen-draw-result-detail-close' })).toHaveLength(0);
  });

  it('renders loading state with recovery CTA back to Draw', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate } as any}
          route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams({ stateOverride: 'loading' }) } as any}
        />,
      );
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Preparing draw result');
    expect(tree.root.findByProps({ testID: 'screen-draw-result-root' })).toBeTruthy();
    const primary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    act(() => {
      primary.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp' });
  });

  it('renders error state with recovery CTA back to Draw', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate } as any}
          route={{
            key: 'draw-result',
            name: 'DrawResult',
            params: makeRouteParams({ stateOverride: 'error', errorMessage: 'Payload missing from ceremony handoff.' }),
          } as any}
        />,
      );
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Draw result unavailable');
    expect(textBlob).toContain('Payload missing from ceremony handoff.');
    const primary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    act(() => {
      primary.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp' });
  });

  it('renders empty-card state with recovery CTA back to Draw', async () => {
    const navigate = vi.fn();
    const emptyDrawResult = { ...MOCK_DRAW_RESULTS, cards: [] };
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate } as any}
          route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams({ drawResult: emptyDrawResult }) } as any}
        />,
      );
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('No cards were drawn');
    const primary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    act(() => {
      primary.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp' });
  });

  it('routes the primary action to the real study flow', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate } as any} route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams() } as any} />);
    });
    await flush();

    const primary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    act(() => {
      primary.props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp' });
  });

  it('routes done link to Home', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate } as any} route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams() } as any} />);
    });
    await flush();

    const secondary = tree.root.findByProps({ testID: 'draw-result-done-link' });
    act(() => {
      secondary.props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('Home');
  });

  it('uses Go to Library CTA when wallet has no pulls remaining', async () => {
    walletFixture = { availablePulls: 0, reservePulls: 0 };
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate } as any} route={{ key: 'draw-result', name: 'DrawResult', params: makeRouteParams() } as any} />);
    });
    await flush();

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Go to Library');

    const primary = tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' });
    act(() => {
      primary.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Library', { focusSlug: 'csharp', scrollToNew: true });
  });
});
