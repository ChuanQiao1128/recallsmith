import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

import {
  TapCard,
  TapCardProps,
  TAP_QUEUE_GAP_MS,
  createTapQueue,
  arcTransform,
  rarityLabel,
} from '../../src/components/ceremony/TapCard';
import { ceremonyStyles } from '../../src/components/ceremony/ceremonyStyles';
import { getCeremonyHaptics } from '../../src/components/ceremonyHaptics';

// TEST_BASE timing values — every duration is 0 so the fallback collapses each
// animation to its target instantly.
const TIMINGS = { flipMs: { COM: 0, RAR: 0, LEG: 0 }, rimSettleMs: { COM: 0, RAR: 0, LEG: 0 }, liftMs: 0, landMs: 0 };

function makeProps(overrides: Partial<TapCardProps> = {}): TapCardProps {
  return {
    card: { stableUid: 'u1', question: 'Question?', difficulty: 3, rarity: 'RAR' },
    index: 0,
    total: 2,
    width: 80,
    height: 116,
    disabled: false,
    flipped: false,
    onTapStart: vi.fn(),
    onFlipped: vi.fn(),
    reduceMotion: false,
    timings: TIMINGS,
    ...overrides,
  };
}

function renderCard(overrides: Partial<TapCardProps> = {}) {
  const props = makeProps(overrides);
  let tree: any;
  act(() => {
    tree = renderer.create(React.createElement(TapCard, props));
  });
  return { tree, props };
}

function faces(tree: any) {
  // Host nodes only (the fallback Reanimated.View wraps a host 'View', so each
  // face otherwise shows up twice — component instance + host).
  return tree.root.findAll(
    (n: any) => typeof n.type === 'string' && Array.isArray(n.props.style) && n.props.style[0] === ceremonyStyles.tapCardSide,
  );
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).__ceremonyMocks?.haptics?.impactAsync?.mockClear?.();
});

describe('TapCard', () => {
  it('createTapQueue spaces flips by the gap and never returns a negative delay', () => {
    const stamps = [1000, 1010, 1010, 5000];
    let i = 0;
    const q = createTapQueue(undefined, () => stamps[i++]);
    expect([q.enqueue('a'), q.enqueue('b'), q.enqueue('c'), q.enqueue('d')]).toEqual([0, 80, 170, 0]);
    q.clear();
    const after = createTapQueue(undefined, () => 1010);
    expect(after.enqueue('e')).toBe(0);
    expect(TAP_QUEUE_GAP_MS).toBe(90);
  });

  it('is disabled outside the table phase and never flips or reports a tap', () => {
    const { tree, props } = renderCard({ disabled: true, flipped: false });
    const root = tree.root.findByProps({ testID: 'tap-card-0' });
    expect(root.props.accessibilityState.disabled).toBe(true);
    expect(root.props.disabled).toBe(true);
    act(() => {
      root.props.onPress();
    });
    expect(props.onTapStart).not.toHaveBeenCalled();
    expect(props.onFlipped).not.toHaveBeenCalled();
    expect(root.props.accessibilityLabel).toBe('Card 1 of 2, face down');
  });

  it('flips exactly once on the table and labels the revealed rarity', () => {
    const card = { stableUid: 'u1', question: 'Q?', difficulty: 3, rarity: 'RAR' as const };
    const onTapStart = vi.fn();
    const onFlipped = vi.fn();
    const onFocusToggle = vi.fn();
    const props = makeProps({ card, disabled: false, onTapStart, onFlipped, onFocusToggle });
    let tree: any;
    act(() => {
      tree = renderer.create(React.createElement(TapCard, props));
    });
    act(() => {
      tree.root.findByProps({ testID: 'tap-card-0' }).props.onPress();
    });
    expect(onTapStart).toHaveBeenCalledWith(card, expect.any(Number));
    expect(onFlipped).toHaveBeenCalledWith('u1');

    // Read styles on the very render that flips — pins the mirror-before-styles order.
    act(() => {
      tree.update(React.createElement(TapCard, { ...props, flipped: true }));
    });
    const root = tree.root.findByProps({ testID: 'tap-card-0' });
    expect(root.props.accessibilityLabel).toBe('Card 1 of 2, Rare revealed');
    const [back, front] = faces(tree);
    expect(front.props.style[1].opacity).toBe(1);
    expect(back.props.style[1].opacity).toBe(0);

    // A second tap on the flipped rare card toggles focus, it does not re-flip.
    act(() => {
      root.props.onPress();
    });
    expect(onFocusToggle).toHaveBeenCalledWith('u1');
    expect(onFlipped).toHaveBeenCalledTimes(1);
  });

  it('keeps the testID on every render path', () => {
    const bare = renderCard({ index: 3, total: 5 });
    expect(bare.tree.root.findByProps({ testID: 'tap-card-3' })).toBeTruthy();
    const withArt = renderCard({ index: 3, total: 5, cardBackImage: { uri: 'back' } as any, frameImage: { uri: 'frame' } as any });
    expect(withArt.tree.root.findByProps({ testID: 'tap-card-3' })).toBeTruthy();
  });

  it('fires the heavy landing haptic for LEG only', () => {
    const impactSpy = vi.spyOn(getCeremonyHaptics(), 'impact');
    getCeremonyHaptics().reset();
    impactSpy.mockClear();

    renderCard({ card: { stableUid: 'leg', question: 'Q?', difficulty: 9, rarity: 'LEG' }, flipped: true });
    expect(impactSpy).toHaveBeenCalledWith('heavy');

    impactSpy.mockClear();
    renderCard({ card: { stableUid: 'rar', question: 'Q?', difficulty: 5, rarity: 'RAR' }, flipped: true });
    expect(impactSpy).not.toHaveBeenCalledWith('heavy');

    impactSpy.mockRestore();
  });

  it('reduce motion omits the rotateY transform', () => {
    const { tree } = renderCard({ reduceMotion: true, flipped: true });
    for (const side of faces(tree)) {
      const transform = side.props.style[1].transform;
      expect(transform.some((t: any) => 'rotateY' in t)).toBe(false);
    }
    const [, front] = faces(tree);
    expect(front.props.style[1].opacity).toBe(1);
  });

  it('arcTransform reproduces the fanned-hand geometry', () => {
    expect(arcTransform(2, 5)).toMatchObject({ rotateDeg: 0, liftY: 0 });
    expect(arcTransform(0, 5)).toMatchObject({ rotateDeg: -14, liftY: 28 });
    expect(arcTransform(0, 1)).toMatchObject({ rotateDeg: 0, liftY: 0 });
    expect(rarityLabel('LEG')).toBe('Legendary');
  });

  it('mounts the foil only for a focused rare card', () => {
    const rare = renderCard({ card: { stableUid: 'u1', question: 'Q?', difficulty: 5, rarity: 'RAR' }, focused: true, flipped: true });
    expect(rare.tree.root.findAll((n: any) => n.type === 'Skia.Canvas')).toHaveLength(0);

    const com = renderCard({ card: { stableUid: 'c1', question: 'Q?', difficulty: 1, rarity: 'COM' }, focused: true, flipped: true });
    expect(com.tree.root.findAll((n: any) => n.props?.style === ceremonyStyles.tapCardFocusLayer)).toHaveLength(0);
  });
});
