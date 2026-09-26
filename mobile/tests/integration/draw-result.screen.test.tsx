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

import { DrawResultScreen, FEATURED_FRAME_LAYOUT, FEATURED_STEM_LINES } from '../../src/screens/DrawResultScreen';
import { RATING_PROMPT_DELAY_MS } from '../../src/features/gacha/milestones/ratingPrompt';
import { drawResultStyles } from '../../src/features/gacha/components/drawResultStyles';
import { CARD_FRAME_ART_WINDOW, CARD_FRAME_SIZE, CARD_FRAME_SLAB, CARD_FRAME_TITLE_STRIP } from '../../src/theme/packArt';

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
    shareResultFixture = { status: 'shared' };
    streakFixture = { currentDailyStreak: 0 };
    shareDrawImageMock.mockClear();
    maybeRequestRatingMock.mockClear();
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

  it('prints the featured card\'s deck rank as "No. 011 / 441", not the owned count', async () => {
    // Owner's device, 2026-09-21: the serial read "REG. 011 / 441" where 011
    // was ownedAfter -- the collection bar's figure, not this card's number.
    // The Library tile and the session header say "#011" for the card ranked
    // 11th; the serial has to agree with them.
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'result',
            name: 'DrawResult',
            params: makeParams({
              ownedAfter: 4,
              totalCards: 441,
              drawResult: {
                ...DRAW_RESULT_FIXTURE,
                cards: [
                  { stableUid: '1', question: 'Q1', difficulty: 3, rarity: 'LEG' as const, rank: 11 },
                  { stableUid: '2', question: 'Q2', difficulty: 2, rarity: 'RAR' as const, rank: 300 },
                ],
              },
            }),
          } as any}
        />,
      );
    });
    await flush();

    const serial = tree.root.findByProps({ testID: 'draw-result-featured-serial' });
    const text = Array.isArray(serial.props.children) ? serial.props.children.join('') : String(serial.props.children);
    expect(text).toBe('No. 011 / 441');
    expect(collectText(tree)).not.toContain('REG.');
    // The collection bar keeps owned / total; the two numbers are different questions.
    expect(collectText(tree)).toContain('4/441');
  });

  it('falls back to the owned count in the serial when an older caller sends cards without a rank', async () => {
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
    const serial = tree.root.findByProps({ testID: 'draw-result-featured-serial' });
    const text = Array.isArray(serial.props.children) ? serial.props.children.join('') : String(serial.props.children);
    expect(text).toBe('No. 004 / 20');
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

  it('shows the full question, topic and MCQ mark in a scrollable detail modal', async () => {
    const longQuestion = (
      'A company must design a resilient, cost-effective architecture on AWS that durably captures every incoming order during seasonal traffic spikes and processes each one asynchronously with the least operational overhead possible. '
    ).repeat(4).slice(0, 550);
    expect(longQuestion).toHaveLength(550);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'result',
            name: 'DrawResult',
            params: makeParams({
              drawResult: {
                ...DRAW_RESULT_FIXTURE,
                cards: [
                  { stableUid: '1', question: longQuestion, difficulty: 3, rarity: 'LEG', tag: 'Networking', kind: 'mcq' },
                  { stableUid: '2', question: 'Q2', difficulty: 2, rarity: 'RAR' },
                ],
              },
            }),
          } as any}
        />,
      );
    });
    await flush();

    // Host instances only — the mocked RN components render both a composite and a host node
    // carrying the same testID, so filter to the host (string type) to count once.
    const hostByTestID = (id: string) =>
      tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);

    // Open the modal from the featured (LEG) card.
    act(() => {
      hostByTestID('screen-draw-result-featured-card')[0].props.onPress();
    });

    expect(hostByTestID('draw-result-detail-scroll')).toHaveLength(1);

    const question = hostByTestID('draw-result-detail-question')[0];
    expect(question.props.children).toBe(longQuestion);
    expect(question.props.numberOfLines).toBeUndefined();

    expect(hostByTestID('draw-result-detail-topic')[0].props.children).toBe('Networking');
    expect(hostByTestID('draw-result-detail-kind')[0].props.children).toBe('MC');
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

  // revealedUids (which cards were flipped on the ceremony table) no longer produces any
  // copy: every card on this screen is face up with its stem, so a "Not flipped" stamp was
  // table state leaking into the result. Whatever the ceremony reports, the tree is the same.
  it.each([
    ['some cards skipped', { revealedUids: ['1'] }],
    ['nothing flipped', { revealedUids: [] }],
    ['everything flipped', { revealedUids: ['1', '2'] }],
    ['no reveal information', {}],
  ])('shows no Not-flipped chip on any card when %s', async (_label, overrides) => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'result', name: 'DrawResult', params: makeParams(overrides) } as any}
        />,
      );
    });
    await flush();

    expect(tree.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.includes('unrevealed'))).toHaveLength(0);
    expect(collectText(tree)).not.toContain('Not flipped');
    // Both cards are still listed face up.
    expect(collectText(tree)).toContain('Q1');
    expect(collectText(tree)).toContain('Q2');

    expect(tree.root.findByProps({ testID: 'draw-result-header' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-result-collection-bar' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'screen-draw-result-featured-card' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'screen-draw-result-primary-cta' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'draw-result-done-link' })).toBeTruthy();
  });

  it('shows no Not-flipped chip on a single unflipped pull either', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'result',
            name: 'DrawResult',
            params: makeParams({ drawResult: { ...DRAW_RESULT_FIXTURE, cards: [DRAW_RESULT_FIXTURE.cards[0]] }, revealedUids: [] }),
          } as any}
        />,
      );
    });
    await flush();

    expect(tree.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.includes('unrevealed'))).toHaveLength(0);
    expect(collectText(tree)).not.toContain('Not flipped');
    expect(tree.root.findByProps({ testID: 'screen-draw-result-featured-card' })).toBeTruthy();
  });

  it('stretches the rarity frame over the whole featured card and lays the face out at its cut-outs', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any} />,
      );
    });
    await flush();

    const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100 * 100) / 100}%`;
    const W = CARD_FRAME_SIZE.width;
    const H = CARD_FRAME_SIZE.height;
    // The layout constants are the frame's own geometry (400×560) as percentages of the card.
    expect(FEATURED_FRAME_LAYOUT.artWindow).toEqual({
      left: pct(CARD_FRAME_ART_WINDOW.x, W), top: pct(CARD_FRAME_ART_WINDOW.y, H),
      width: pct(CARD_FRAME_ART_WINDOW.width, W), height: pct(CARD_FRAME_ART_WINDOW.height, H),
    });
    expect(FEATURED_FRAME_LAYOUT.artWindow).toEqual({ left: '7%', top: '11.43%', width: '86%', height: '52.86%' });
    expect(FEATURED_FRAME_LAYOUT.slab).toEqual({
      left: pct(CARD_FRAME_SLAB.x, W), top: pct(CARD_FRAME_SLAB.y, H),
      width: pct(CARD_FRAME_SLAB.width, W), height: pct(CARD_FRAME_SLAB.height, H),
    });
    expect(FEATURED_FRAME_LAYOUT.titleStrip).toEqual({
      left: pct(CARD_FRAME_TITLE_STRIP.x, W), top: pct(CARD_FRAME_TITLE_STRIP.y, H),
      width: pct(CARD_FRAME_TITLE_STRIP.width, W), height: pct(CARD_FRAME_TITLE_STRIP.height, H),
    });

    // The host element (the mock's function component sits one level above it).
    const card = tree.root.find((n) => (n.type as any) === 'Pressable' && n.props.testID === 'screen-draw-result-featured-card');
    // The frame is a direct child of the (unpadded, 5:7) card, so its 100 % is the full card —
    // not a child of a padded gradient whose content box was 88 % × 91 % of it.
    const frame = tree.root.findByProps({ testID: 'draw-result-featured-frame' });
    expect(frame.parent).toBe(card);
    expect(frame.props.resizeMode).toBe('stretch');
    expect(frame.props.style).toMatchObject({ width: '100%', height: '100%' });
    const cardStyle = card.props.style({ pressed: false })[0];
    expect(cardStyle).toBe(drawResultStyles.featured);
    expect(cardStyle.aspectRatio).toBe(5 / 7);
    expect((cardStyle as Record<string, unknown>).padding).toBeUndefined();
    expect((drawResultStyles.featuredGradient as Record<string, unknown>).padding).toBeUndefined();
    // The frame paints last (over the face).
    expect(card.children[card.children.length - 1]).toBe(frame);

    // Art window and slab sit at the frame's transparent windows, absolutely, not flex: 1.
    const artWindow = tree.root.find((n) => (n.type as any) === 'View' && n.props.testID === 'draw-result-featured-art-window');
    expect(artWindow.props.style).toMatchObject({ position: 'absolute', ...FEATURED_FRAME_LAYOUT.artWindow });
    expect(artWindow.props.style.flex).toBeUndefined();
    const question = tree.root.findByProps({ testID: 'draw-result-featured-question' });
    expect(question.props.numberOfLines).toBe(FEATURED_STEM_LINES);
    expect(FEATURED_STEM_LINES).toBe(6);
    expect(question.props.ellipsizeMode).toBe('tail');
    expect(question.props.children).toBe('Q1');
    const slab = question.parent!;
    expect(slab.props.style[0]).toMatchObject({ position: 'absolute', ...FEATURED_FRAME_LAYOUT.slab });

    // The art window shows the deck's pack art (cover-cropped) with the rarity chip and the
    // topic label over it — no slug monogram.
    const art = tree.root.findByProps({ testID: 'draw-result-featured-art' });
    expect(art.parent).toBe(artWindow);
    expect(art.props.resizeMode).toBe('cover');
    expect(art.props.source).toBeTruthy();
    expect(collectText(tree)).not.toContain('CSH');
    const topic = tree.root.findByProps({ testID: 'draw-result-featured-topic' });
    expect(topic.parent).toBe(artWindow);
    expect(topic.findAll((n) => (n.type as any) === 'Text').map((n) => n.props.children)).toEqual(['Core']);
    expect(collectText(tree)).toContain('★ Legendary');
    // The registry serial moved to the frame's title strip and prints the card's rank
    // (here the owned-count fallback: makeParams sends cards without one).
    const serial = tree.root.findByProps({ testID: 'draw-result-featured-serial' });
    expect(String(serial.props.children)).toBe('No. 004 / 20');
    expect(serial.parent!.props.style).toMatchObject({ position: 'absolute', ...FEATURED_FRAME_LAYOUT.titleStrip });
    expect(collectText(tree)).not.toContain('REG.');
  });

  it('shares the pull image from the share button and reports unavailable inline', async () => {
    let tree!: renderer.ReactTestRenderer;
    let tree2!: renderer.ReactTestRenderer;
    try {
      await act(async () => {
        tree = renderer.create(
          <DrawResultScreen
            navigation={{ navigate: vi.fn() } as any}
            route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any}
          />,
          { createNodeMock: () => ({}) },
        );
      });
      await flush();

      const target = tree.root.findByProps({ testID: 'draw-result-share-target' });
      expect(target.props.collapsable).toBe(false);

      await act(async () => {
        tree.root.findByProps({ testID: 'draw-result-share-button' }).props.onPress();
      });
      await flush();

      expect(shareDrawImageMock).toHaveBeenCalledTimes(1);
      expect(shareDrawImageMock).toHaveBeenCalledWith(
        expect.objectContaining({ current: expect.anything() }),
        { slug: 'csharp', deckTitle: 'C# Interview' },
      );
      expect(tree.root.findAllByProps({ testID: 'draw-result-share-status' })).toHaveLength(0);

      shareResultFixture = { status: 'unavailable' };
      await act(async () => {
        tree2 = renderer.create(
          <DrawResultScreen
            navigation={{ navigate: vi.fn() } as any}
            route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any}
          />,
          { createNodeMock: () => ({}) },
        );
      });
      await flush();

      await act(async () => {
        tree2.root.findByProps({ testID: 'draw-result-share-button' }).props.onPress();
      });
      await flush();

      const status = tree2.root.findByProps({ testID: 'draw-result-share-status' });
      expect(status.props.children).toBe('Sharing is not available on this device');
      expect(collectText(tree2)).toContain('Share this pull');
    } finally {
      await act(async () => {
        tree?.unmount();
        tree2?.unmount();
      });
    }
  });

  it('requests a store review once for a Legendary pull after the delay', async () => {
    vi.useFakeTimers();
    maybeRequestRatingMock.mockClear();
    let tree!: renderer.ReactTestRenderer;
    try {
      await act(async () => {
        tree = renderer.create(
          <DrawResultScreen
            navigation={{ navigate: vi.fn() } as any}
            route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any}
          />,
        );
      });
      await flush();

      expect(maybeRequestRatingMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RATING_PROMPT_DELAY_MS);
      });

      expect(maybeRequestRatingMock).toHaveBeenCalledWith('first-legendary');
      expect(maybeRequestRatingMock).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        tree?.unmount();
      });
      vi.useRealTimers();
    }
  });

  it('requests a store review on a seven-day streak when no Legendary was pulled', async () => {
    vi.useFakeTimers();
    maybeRequestRatingMock.mockClear();
    const noLegParams = makeParams({
      drawResult: {
        ...DRAW_RESULT_FIXTURE,
        cards: [
          { stableUid: '1', question: 'Q1', difficulty: 3, rarity: 'COM' as const, tag: 'Core' },
          { stableUid: '2', question: 'Q2', difficulty: 2, rarity: 'RAR' as const },
        ],
      },
    });
    let tree!: renderer.ReactTestRenderer;
    let tree2!: renderer.ReactTestRenderer;
    try {
      streakFixture = { currentDailyStreak: 7 };
      await act(async () => {
        tree = renderer.create(
          <DrawResultScreen
            navigation={{ navigate: vi.fn() } as any}
            route={{ key: 'result', name: 'DrawResult', params: noLegParams } as any}
          />,
        );
      });
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RATING_PROMPT_DELAY_MS);
      });
      expect(maybeRequestRatingMock).toHaveBeenCalledWith('streak-7');

      await act(async () => {
        tree.unmount();
      });
      maybeRequestRatingMock.mockClear();
      streakFixture = { currentDailyStreak: 6 };
      await act(async () => {
        tree2 = renderer.create(
          <DrawResultScreen
            navigation={{ navigate: vi.fn() } as any}
            route={{ key: 'result', name: 'DrawResult', params: noLegParams } as any}
          />,
        );
      });
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RATING_PROMPT_DELAY_MS);
      });
      expect(maybeRequestRatingMock).not.toHaveBeenCalledWith('streak-7');
      expect(maybeRequestRatingMock).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        tree?.unmount();
        tree2?.unmount();
      });
      vi.useRealTimers();
    }
  });
});
