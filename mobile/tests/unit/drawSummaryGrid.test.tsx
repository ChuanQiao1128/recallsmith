import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    // Image is present so the mini card renders its rarity frame.
    Image: (props: any) => React.createElement('Image', props),
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

import { DrawSummaryGrid } from '../../src/components/ceremony/DrawSummaryGrid';

const COVER = ['#5C3DA0', '#7A4DC4', '#A77FE0', '#5C3DA0'] as const;

const CARDS = [
  { stableUid: '1', question: 'A common one', rarity: 'COM' as const },
  { stableUid: '2', question: 'A rare one', rarity: 'RAR' as const },
  { stableUid: '3', question: 'The legendary', rarity: 'LEG' as const },
];

function render(onPressCard = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      React.createElement(DrawSummaryGrid, {
        cards: CARDS,
        width: 358,
        testIDPrefix: 'grid',
        packPaletteCover: COVER,
        onPressCard,
      }),
    );
  });
  return { tree, onPressCard };
}

function hosts(tree: renderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('DrawSummaryGrid', () => {
  it('renders one framed mini card per pull, Legendary first, with a glow only for rare cards', () => {
    const { tree } = render();
    expect(hosts(tree, 'grid-grid')).toHaveLength(1);

    // One cell + one framed mini face per pulled card.
    for (let i = 0; i < CARDS.length; i += 1) {
      expect(hosts(tree, `grid-cell-${i}`)).toHaveLength(1);
      expect(hosts(tree, `grid-cell-${i}-face-frame`)).toHaveLength(1);
    }
    expect(hosts(tree, `grid-cell-${CARDS.length}`)).toHaveLength(0);

    // Legendary first, then Rare, then Common.
    expect(hosts(tree, 'grid-cell-0')[0].props.accessibilityLabel).toBe('Legendary: The legendary');
    expect(hosts(tree, 'grid-cell-1')[0].props.accessibilityLabel).toBe('Rare: A rare one');
    expect(hosts(tree, 'grid-cell-2')[0].props.accessibilityLabel).toBe('Common: A common one');

    // Glow behind LEG and RAR only — never the COM.
    expect(hosts(tree, 'grid-cell-0-glow')).toHaveLength(1);
    expect(hosts(tree, 'grid-cell-1-glow')).toHaveLength(1);
    expect(hosts(tree, 'grid-cell-2-glow')).toHaveLength(0);

    // Star marks: ★★★ for LEG, ★ for RAR, nothing for COM.
    expect(hosts(tree, 'grid-cell-0-face-stars')[0].props.children).toBe('★★★');
    expect(hosts(tree, 'grid-cell-1-face-stars')[0].props.children).toBe('★');
    expect(hosts(tree, 'grid-cell-2-face-stars')[0].props.children).toBe('');
  });

  it('reports the tapped card uid', () => {
    const { tree, onPressCard } = render();
    act(() => {
      hosts(tree, 'grid-cell-0')[0].props.onPress();
    });
    // Cell 0 is the Legendary (uid '3').
    expect(onPressCard).toHaveBeenCalledWith('3');
    act(() => {
      hosts(tree, 'grid-cell-2')[0].props.onPress();
    });
    expect(onPressCard).toHaveBeenCalledWith('1');
  });
});
