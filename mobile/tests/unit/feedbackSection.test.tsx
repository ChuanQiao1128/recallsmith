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

import { FeedbackSection, FEEDBACK_COPY } from '../../src/features/gacha/settings/feedback/FeedbackSection';

function render(prefs: { soundEffects: boolean; haptics: boolean }, onToggle = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<FeedbackSection prefs={prefs} onToggle={onToggle} />);
  });
  return { tree, onToggle };
}

function findByTestID(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.props?.testID === testID);
}

describe('FeedbackSection', () => {
  it('renders both toggles as switches with their checked state', () => {
    const { tree } = render({ soundEffects: true, haptics: false });

    const sound = findByTestID(tree, 'settings-sound-effects-toggle');
    const haptics = findByTestID(tree, 'settings-haptics-toggle');

    expect(sound.props.accessibilityRole).toBe('switch');
    expect(haptics.props.accessibilityRole).toBe('switch');
    expect(sound.props.accessibilityState).toEqual({ checked: true });
    expect(haptics.props.accessibilityState).toEqual({ checked: false });
    expect(sound.props.accessibilityLabel).toBe(FEEDBACK_COPY.soundLabel);
    expect(haptics.props.accessibilityLabel).toBe(FEEDBACK_COPY.hapticsLabel);

    // The visible On/Off pill matches the checked state.
    const textBlob = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => {
        const c = node.props.children;
        return Array.isArray(c) ? c.join('') : String(c ?? '');
      });
    expect(textBlob).toContain(FEEDBACK_COPY.title);
    expect(textBlob).toContain('On');
    expect(textBlob).toContain('Off');
  });

  it('calls onToggle with the flipped value', () => {
    const { tree, onToggle } = render({ soundEffects: true, haptics: true });

    act(() => {
      findByTestID(tree, 'settings-sound-effects-toggle').props.onPress();
    });
    expect(onToggle).toHaveBeenCalledWith('soundEffects', false);

    act(() => {
      findByTestID(tree, 'settings-haptics-toggle').props.onPress();
    });
    expect(onToggle).toHaveBeenLastCalledWith('haptics', false);
  });
});
