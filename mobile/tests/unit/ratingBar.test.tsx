import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

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
  };
});

import { RATING_HINT, RATING_ITEMS, RatingBar } from '../../src/features/gacha/components/RatingBar';

function render(props: { revealed?: boolean; disabled?: boolean }) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<RatingBar onRate={() => {}} {...props} />);
  });
  return tree;
}

function texts(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Text');
}

// Owner's device, 2026-09-21 (screenshot 15): after reveal the dock still
// said "Think about how well you recalled this before seeing the answer",
// and the button subtitles were cut to "Show very s…" / "Normal inte…".
describe('RatingBar hint copy', () => {
  it('asks for the recall attempt before reveal', () => {
    const hint = texts(render({ revealed: false, disabled: true })).find((node) => node.props.testID === 'review-rating-hint');
    expect(hint?.props.children).toBe(RATING_HINT.beforeReveal);
    expect(hint?.props.children).toBe('Think about how well you recalled this before seeing the answer.');
  });

  it('asks how well it went after reveal, never the pre-reveal sentence', () => {
    const hint = texts(render({ revealed: true, disabled: false })).find((node) => node.props.testID === 'review-rating-hint');
    expect(hint?.props.children).toBe(RATING_HINT.afterReveal);
    expect(hint?.props.children).toBe('How well did you recall it?');
    expect(String(hint?.props.children)).not.toMatch(/before seeing the answer/i);
  });

  it('defaults to the pre-reveal hint when the caller does not say', () => {
    const hint = texts(render({})).find((node) => node.props.testID === 'review-rating-hint');
    expect(hint?.props.children).toBe(RATING_HINT.beforeReveal);
  });
});

describe('RatingBar subtitles fit a 4-up grid', () => {
  it('keeps every subtitle to two short words so a one-line clamp cannot truncate it', () => {
    expect(RATING_ITEMS.map((item) => item.subtitle)).toEqual(['Show soon', 'Short gap', 'Normal gap', 'Much later']);
    for (const item of RATING_ITEMS) {
      // ~64pt of button at 11pt: 10 characters is the widest that fits with padding at the default font scale.
      expect(item.subtitle.length).toBeLessThanOrEqual(10);
      expect(item.subtitle.split(' ')).toHaveLength(2);
      expect(item.subtitle).not.toMatch(/interval|very/i);
    }
  });

  it('renders the four titles and subtitles, one line each', () => {
    const tree = render({ revealed: true });
    const rendered = texts(tree).map((node) => node.props.children);
    for (const item of RATING_ITEMS) {
      expect(rendered).toContain(item.title);
      expect(rendered).toContain(item.subtitle);
    }
    const subtitleNodes = texts(tree).filter((node) => RATING_ITEMS.some((item) => item.subtitle === node.props.children));
    expect(subtitleNodes).toHaveLength(4);
    for (const node of subtitleNodes) expect(node.props.numberOfLines).toBe(1);
  });

  it('routes each button to its rating', () => {
    const onRate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RatingBar onRate={onRate} revealed />);
    });
    const buttons = tree.root.findAll((node) => (node.type as any) === 'Pressable');
    expect(buttons).toHaveLength(4);
    act(() => {
      buttons.forEach((button) => button.props.onPress());
    });
    expect(onRate.mock.calls.map((call) => call[0])).toEqual(['again', 'hard', 'good', 'easy']);
  });
});
