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
    // CodeBlock (under CardAnswerSections) reads Platform.select at module scope.
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    useWindowDimensions: () => dims,
  };
});

import {
  CHROME_MAX_FONT_SCALE,
  isLargeFontScale,
  packSizeForWindowHeight,
} from '../../src/theme/dynamicType';
import { RatingBar } from '../../src/features/gacha/components/RatingBar';
import { LearningStudyDock } from '../../src/features/gacha/components/LearningStudyView';
import { CardAnswerSections } from '../../src/features/gacha/components/CardAnswerSections';

function flatten(style: any): Record<string, any> {
  if (Array.isArray(style)) {
    return style.reduce((acc: Record<string, any>, entry: any) => Object.assign(acc, flatten(entry)), {});
  }
  return style && typeof style === 'object' ? style : {};
}

function renderBar(fourButtons = true) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<RatingBar onRate={() => {}} revealed fourButtons={fourButtons} />);
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

  it('RatingBar keeps the two-button default on one row at large font scales', () => {
    dims.fontScale = 1.5;
    const two = renderBar(false);
    const grid = two.root.find((node) => (node.type as any) === 'View' && node.props.testID === 'review-rating-grid');
    expect(flatten(grid.props.style).flexWrap).toBeUndefined();
    for (const text of two.root.findAll((node) => (node.type as any) === 'Text')) {
      expect(text.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
    }
    dims.fontScale = 1.0;
  });

  // 2026-10-14 learning flow: the study dock is chrome (capped); the highlighted 答 line is card body
  // text (never capped, never clamped), and the key-line hint is chrome like the plain one.
  it('caps the study dock at CHROME_MAX_FONT_SCALE before and after Show answer', () => {
    for (const revealed of [false, true]) {
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<LearningStudyDock revealed={revealed} onShowAnswer={() => {}} onGotIt={() => {}} />);
      });
      const texts = tree.root.findAll((node) => (node.type as any) === 'Text');
      expect(texts).toHaveLength(2);
      for (const text of texts) expect(text.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
    }
  });

  it('never caps or clamps the highlighted key line or the lines after it', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <CardAnswerSections
          card={{ StableUid: 'k', OrderInDeck: 1, Difficulty: 1, Question: 'Q', Explanation: '答：结论。\n因为：原因。' } as any}
        />,
      );
    });
    const body = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .filter((node) => node.props.children !== 'EXPLANATION');
    expect(body.map((node) => node.props.children)).toEqual(['答：结论。', '因为：原因。']);
    for (const text of body) {
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
      expect(text.props.numberOfLines).toBeUndefined();
    }
  });

  it('caps the key-line hint like every other RatingBar text', () => {
    dims.fontScale = 1;
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RatingBar onRate={() => {}} revealed keyLine />);
    });
    const hint = tree.root.find((node) => (node.type as any) === 'Text' && node.props.testID === 'review-rating-hint');
    expect(hint.props.children).toBe('Did you get the highlighted line?');
    expect(hint.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
  });
});
