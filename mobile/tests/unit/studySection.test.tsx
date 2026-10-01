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

import { StudySection, STUDY_COPY } from '../../src/features/gacha/settings/study/StudySection';

function render(fourButtons: boolean, onToggleFourButtons = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<StudySection prefs={{ fourButtons }} onToggleFourButtons={onToggleFourButtons} />);
  });
  return { tree, onToggleFourButtons };
}

const toggleOf = (tree: renderer.ReactTestRenderer) =>
  tree.root.find((node) => (node.type as any) === 'Pressable' && node.props?.testID === 'settings-four-buttons-toggle');

describe('StudySection', () => {
  it('renders the four-button setting as a switch with its checked state', () => {
    const { tree } = render(false);
    const toggle = toggleOf(tree);
    expect(STUDY_COPY.fourButtonsLabel).toBe('Show all four rating buttons');
    expect(toggle.props.accessibilityRole).toBe('switch');
    expect(toggle.props.accessibilityLabel).toBe(STUDY_COPY.fourButtonsLabel);
    expect(toggle.props.accessibilityState).toEqual({ checked: false });
    const texts = tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => node.props.children);
    expect(texts).toContain(STUDY_COPY.title);
    expect(texts).toContain('Off');
    expect(toggleOf(render(true).tree).props.accessibilityState).toEqual({ checked: true });
  });

  it('calls onToggleFourButtons with the flipped value', () => {
    const off = render(false);
    act(() => toggleOf(off.tree).props.onPress());
    expect(off.onToggleFourButtons).toHaveBeenCalledWith(true);
    const on = render(true);
    act(() => toggleOf(on.tree).props.onPress());
    expect(on.onToggleFourButtons).toHaveBeenCalledWith(false);
  });
});
