import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: any) => styles, absoluteFillObject: {} },
    useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

import { RevealSpotlight, RevealSpotlightProps, REVEAL_SPOTLIGHT_TESTID } from '../../src/components/ceremony/RevealSpotlight';
import { spotlightFlipPlan } from '../../src/features/gacha/draw/spotlightPlan';

const COVER = ['#5C3DA0', '#7A4DC4', '#A77FE0', '#5C3DA0'] as const;

function makeProps(overrides: Partial<RevealSpotlightProps> = {}): RevealSpotlightProps {
  return {
    card: { stableUid: '1', question: 'A fairly long question about the runtime that needs the read-full sheet.', rarity: 'RAR' },
    index: 0,
    total: 1,
    visible: true,
    interactive: true,
    reduceMotion: false,
    packPaletteCover: COVER,
    ...overrides,
  };
}

function render(overrides: Partial<RevealSpotlightProps> = {}) {
  const props = makeProps(overrides);
  let tree: any;
  act(() => {
    tree = renderer.create(React.createElement(RevealSpotlight, props));
  });
  return { tree, props };
}

function collectText(tree: any): string {
  return tree.root
    .findAll((n: any) => (n.type as any) === 'Text')
    .map((n: any) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RevealSpotlight', () => {
  it('mounts no face text until the card is flipped', () => {
    const { tree } = render();
    expect(tree.root.findByProps({ testID: REVEAL_SPOTLIGHT_TESTID })).toBeTruthy();
    // Face down: no rarity word, no face question in the tree.
    expect(collectText(tree)).not.toContain('Rare');
    expect(tree.root.findAllByProps({ testID: 'reveal-spotlight-face-question' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.accessibilityLabel).toBe('Card 1 of 1, face down');

    act(() => {
      tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.onPress();
    });
    // The flip is requested: the front face (with its rarity chip) is now in the tree.
    expect(collectText(tree)).toContain('Rare');
    expect(tree.root.findByProps({ testID: 'reveal-spotlight-face-question' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.accessibilityLabel).toBe('Card 1 of 1, Rare revealed');
  });

  it('flips by itself after the entrance when autoFlip is set', () => {
    vi.useFakeTimers();
    const onFlipStart = vi.fn();
    render({ autoFlip: true, onFlipStart });
    expect(onFlipStart).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(spotlightFlipPlan('RAR', false).entranceMs - 1);
    });
    expect(onFlipStart).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onFlipStart).toHaveBeenCalledTimes(1);
    expect(onFlipStart).toHaveBeenCalledWith(spotlightFlipPlan('RAR', false));
  });

  it('starts face up with no flip when initialFaceUp is set', () => {
    const onFlipStart = vi.fn();
    const { tree } = render({ initialFaceUp: true, onFlipStart });
    expect(onFlipStart).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'reveal-spotlight-face-question' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'reveal-spotlight-card' }).props.accessibilityLabel).toBe('Card 1 of 1, Rare revealed');
    expect(tree.root.findByProps({ testID: 'reveal-spotlight-banner' }).props.children).toBe('Rare');
  });

  it('reports onLanded after the plan landMs and hands a face-up tap to onPressFaceUp', () => {
    vi.useFakeTimers();
    const onLanded = vi.fn();
    const onPressFaceUp = vi.fn();
    const { tree } = render({ onLanded, onPressFaceUp });
    const card = () => tree.root.findByProps({ testID: 'reveal-spotlight-card' });
    act(() => {
      card().props.onPress();
    });
    expect(onLanded).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(spotlightFlipPlan('RAR', false).landMs);
    });
    expect(onLanded).toHaveBeenCalledTimes(1);
    // A tap on the face-up card is handed to onPressFaceUp (it never re-flips).
    act(() => {
      card().props.onPress();
    });
    expect(onPressFaceUp).toHaveBeenCalledTimes(1);
  });

  it('a tap during the flip finishes it at once and reports onFinishEarly', () => {
    vi.useFakeTimers();
    const onFinishEarly = vi.fn();
    const onLanded = vi.fn();
    const { tree } = render({ onFinishEarly, onLanded });
    const card = () => tree.root.findByProps({ testID: 'reveal-spotlight-card' });

    act(() => {
      card().props.onPress(); // face down → flipping
    });
    expect(card().props.accessibilityLabel).toBe('Card 1 of 1, Rare revealed');
    expect(onFinishEarly).not.toHaveBeenCalled();

    act(() => {
      card().props.onPress(); // tap during the flip → finish early
    });
    expect(onFinishEarly).toHaveBeenCalledTimes(1);
    expect(onLanded).toHaveBeenCalledTimes(1);

    // The flip timers were cancelled: no second landing fires later.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onFinishEarly).toHaveBeenCalledTimes(1);
    expect(onLanded).toHaveBeenCalledTimes(1);
  });

  it('omits every transform under reduce motion', () => {
    const { tree } = render({ reduceMotion: true });
    // Every animated node's transform is empty under Reduce Motion (no scale/shake/rotateY).
    const transformNodes = tree.root.findAll((n: any) => {
      if (typeof n.type !== 'string' || !Array.isArray(n.props.style)) return false;
      const last = n.props.style[n.props.style.length - 1];
      return last && typeof last === 'object' && 'transform' in last;
    });
    expect(transformNodes.length).toBeGreaterThan(0);
    for (const node of transformNodes) {
      const last = node.props.style[node.props.style.length - 1];
      expect(last.transform).toEqual([]);
    }
  });
});
