import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// A mutable dimensions object shared with the react-native mock. Tests mutate
// `dims.fontScale` / `dims.height` before rendering to drive the policy.
const dims = vi.hoisted(() => ({ fontScale: 1, height: 800 }));

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
    StyleSheet: { create: (styles: any) => styles },
    useWindowDimensions: () => dims,
  };
});

import {
  CHROME_MAX_FONT_SCALE,
  isLargeFontScale,
  packSizeForWindowHeight,
} from '../../src/theme/dynamicType';
import { RatingBar } from '../../src/features/gacha/components/RatingBar';

function flatten(style: any): Record<string, any> {
  if (Array.isArray(style)) {
    return style.reduce((acc: Record<string, any>, entry: any) => Object.assign(acc, flatten(entry)), {});
  }
  return style && typeof style === 'object' ? style : {};
}

function renderBar() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<RatingBar onRate={() => {}} revealed />);
  });
  return tree;
}

describe('dynamicType policy', () => {
  it('isLargeFontScale switches above 1.3', () => {
    expect(isLargeFontScale(1.3)).toBe(false);
    expect(isLargeFontScale(1.0)).toBe(false);
    expect(isLargeFontScale(1.31)).toBe(true);
    expect(isLargeFontScale(1.5)).toBe(true);
    // Non-finite input never counts as large.
    expect(isLargeFontScale(Number.NaN)).toBe(false);
    expect(isLargeFontScale(Infinity)).toBe(false);
  });

  it('packSizeForWindowHeight shrinks the pack below a 700pt window', () => {
    expect(packSizeForWindowHeight(667)).toEqual({ width: 192, height: 269 });
    expect(packSizeForWindowHeight(844)).toEqual({ width: 240, height: 336 });
    expect(packSizeForWindowHeight(Number.NaN)).toEqual({ width: 240, height: 336 });
  });

  it('RatingBar caps chrome text at CHROME_MAX_FONT_SCALE', () => {
    dims.fontScale = 1;
    const tree = renderBar();
    const texts = tree.root.findAll((node) => (node.type as any) === 'Text');
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
      expect(text.props.maxFontSizeMultiplier).toBe(1.4);
    }
  });

  it('RatingBar switches to a 2x2 grid at large font scales', () => {
    dims.fontScale = 1.5;
    const large = renderBar();
    const largeGrid = large.root.find(
      (node) => (node.type as any) === 'View' && node.props.testID === 'review-rating-grid',
    );
    expect(flatten(largeGrid.props.style).flexWrap).toBe('wrap');

    dims.fontScale = 1.0;
    const normal = renderBar();
    const normalGrid = normal.root.find(
      (node) => (node.type as any) === 'View' && node.props.testID === 'review-rating-grid',
    );
    expect(flatten(normalGrid.props.style).flexWrap).toBeUndefined();
  });
});
