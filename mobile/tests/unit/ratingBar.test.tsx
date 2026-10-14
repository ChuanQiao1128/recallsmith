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

import {
  RATING_HINT,
  RATING_ITEMS,
  RatingBar,
  ratingA11yLabel,
  TWO_RATING_ITEMS,
} from '../../src/features/gacha/components/RatingBar';

function render(props: { revealed?: boolean; disabled?: boolean; fourButtons?: boolean; keyLine?: boolean }) {
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
    expect(hint?.props.children).toBe('Try to recall the answer, then reveal it.');
  });

  it('asks whether you remembered it after reveal (two buttons), never the pre-reveal sentence', () => {
    const hint = texts(render({ revealed: true, disabled: false })).find((node) => node.props.testID === 'review-rating-hint');
    expect(hint?.props.children).toBe(RATING_HINT.afterRevealTwo);
    expect(hint?.props.children).toBe('Did you remember it?');
    expect(String(hint?.props.children)).not.toMatch(/then reveal it/i);
  });

  it('asks how well it went after reveal with all four buttons', () => {
    const hint = texts(render({ revealed: true, fourButtons: true })).find((node) => node.props.testID === 'review-rating-hint');
    expect(hint?.props.children).toBe(RATING_HINT.afterReveal);
    expect(hint?.props.children).toBe('How well did you recall it?');
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
    const tree = render({ revealed: true, fourButtons: true });
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
      tree = renderer.create(<RatingBar onRate={onRate} revealed fourButtons />);
    });
    const buttons = tree.root.findAll((node) => (node.type as any) === 'Pressable');
    expect(buttons).toHaveLength(4);
    act(() => {
      buttons.forEach((button) => button.props.onPress());
    });
    expect(onRate.mock.calls.map((call) => call[0])).toEqual(['again', 'hard', 'good', 'easy']);
  });
});

// R22 §1.4, §6: new learners rate with two buttons; four is an opt-in setting.
describe('RatingBar two-button default', () => {
  it('renders Forgot and Remembered by default, and nothing from the four-button scale', () => {
    const tree = render({ revealed: true });
    const buttons = tree.root.findAll((node) => (node.type as any) === 'Pressable');
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.props.testID)).toEqual(['review-rating-again', 'review-rating-good']);
    const rendered = texts(tree).map((node) => node.props.children);
    expect(rendered).toContain('Forgot');
    expect(rendered).toContain('Remembered');
    for (const title of ['Again', 'Hard', 'Good', 'Easy']) expect(rendered).not.toContain(title);
    expect(TWO_RATING_ITEMS.map((item) => item.title)).toEqual(['Forgot', 'Remembered']);
  });

  it('maps Forgot to again and Remembered to good through the same onRate contract', () => {
    const onRate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RatingBar onRate={onRate} revealed />);
    });
    const buttons = tree.root.findAll((node) => (node.type as any) === 'Pressable');
    act(() => {
      buttons.forEach((button) => button.props.onPress());
    });
    expect(onRate.mock.calls.map((call) => call[0])).toEqual(['again', 'good']);
  });

  it('restores Again/Hard/Good/Easy when fourButtons is on', () => {
    const buttons = render({ revealed: true, fourButtons: true }).root.findAll((node) => (node.type as any) === 'Pressable');
    expect(buttons.map((b) => b.props.testID)).toEqual([
      'review-rating-again',
      'review-rating-hard',
      'review-rating-good',
      'review-rating-easy',
    ]);
  });

  it('uses the same pre-reveal hint in both modes', () => {
    for (const fourButtons of [false, true]) {
      const hint = texts(render({ revealed: false, fourButtons })).find((node) => node.props.testID === 'review-rating-hint');
      expect(hint?.props.children).toBe('Try to recall the answer, then reveal it.');
    }
  });
});

// 2026-10-14 learning flow (B3): an answer that opens with a highlighted 答 line is judged on that
// line, so the after-reveal question names it. Nothing else about the dock changes.
describe('RatingBar key-line hint', () => {
  const hintOf = (tree: renderer.ReactTestRenderer) =>
    texts(tree).find((node) => node.props.testID === 'review-rating-hint')?.props.children;

  it('asks about the highlighted line after reveal: yes/no for two buttons, how well for four', () => {
    expect(hintOf(render({ revealed: true, keyLine: true }))).toBe('Did you get the highlighted line?');
    expect(RATING_HINT.afterRevealTwoKeyLine).toBe('Did you get the highlighted line?');
    expect(hintOf(render({ revealed: true, keyLine: true, fourButtons: true }))).toBe('How well did you get the highlighted line?');
    expect(RATING_HINT.afterRevealKeyLine).toBe('How well did you get the highlighted line?');
  });

  it('keeps the plain questions without a key line, and the pre-reveal hint either way', () => {
    expect(hintOf(render({ revealed: true }))).toBe('Did you remember it?');
    expect(hintOf(render({ revealed: true, keyLine: false, fourButtons: true }))).toBe('How well did you recall it?');
    for (const keyLine of [false, true]) {
      for (const fourButtons of [false, true]) {
        expect(hintOf(render({ revealed: false, keyLine, fourButtons }))).toBe('Try to recall the answer, then reveal it.');
      }
    }
  });

  it('changes only the hint: the same buttons, labels and ratings', () => {
    for (const fourButtons of [false, true]) {
      const onRate = vi.fn();
      let tree!: renderer.ReactTestRenderer;
      act(() => {
        tree = renderer.create(<RatingBar onRate={onRate} revealed fourButtons={fourButtons} keyLine />);
      });
      const buttons = tree.root.findAll((node) => (node.type as any) === 'Pressable');
      const items = fourButtons ? RATING_ITEMS : TWO_RATING_ITEMS;
      expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(items.map((item) => ratingA11yLabel(item)));
      act(() => {
        buttons.forEach((button) => button.props.onPress());
      });
      expect(onRate.mock.calls.map((call) => call[0])).toEqual(items.map((item) => item.key));
    }
  });
});

// 2026-10-14 learning flow (B2): the end-of-session recall check is gone, and with it the dock that
// sent hard for Remembered. Remembered is good wherever the rating bar shows.
describe('RatingBar has no recall-check dock', () => {
  it('sends good for Remembered and offers no "See it tomorrow" button', () => {
    const onRate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RatingBar onRate={onRate} revealed />);
    });
    const rendered = texts(tree).map((node) => node.props.children);
    expect(rendered).not.toContain('See it tomorrow');
    const remembered = tree.root.find(
      (node) => (node.type as any) === 'Pressable' && node.props.testID === 'review-rating-good',
    );
    expect(remembered.props.accessibilityLabel).toBe('Remembered, normal gap');
    act(() => {
      remembered.props.onPress();
    });
    expect(onRate).toHaveBeenCalledWith('good');
  });
});
