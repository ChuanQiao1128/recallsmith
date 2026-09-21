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

import { McqCoachLine } from '../../src/features/gacha/components/McqCoachLine';
import { MCQ_COPY } from '../../src/features/gacha/mcq/mcqConstants';

function render(props: { visible: boolean; onDismiss?: () => void; testID?: string }) {
  const onDismiss = props.onDismiss ?? vi.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<McqCoachLine visible={props.visible} onDismiss={onDismiss} testID={props.testID} />);
  });
  return { tree, onDismiss };
}

function views(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'View');
}

function pressable(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.props.testID === testID);
}

describe('McqCoachLine', () => {
  it('renders nothing when hidden', () => {
    const onDismiss = vi.fn();
    const { tree } = render({ visible: false, onDismiss });
    expect(tree.toJSON()).toBeNull();
    expect(views(tree).some((node) => node.props.testID === 'mcq-coach-line')).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('shows the coach copy and dismisses through the button', () => {
    const { tree, onDismiss } = render({ visible: true });
    const bands = views(tree).filter((node) => node.props.testID === 'mcq-coach-line');
    expect(bands).toHaveLength(1);

    const copy = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .find((node) => node.props.children === MCQ_COPY.coach);
    expect(copy).toBeDefined();
    expect(copy!.props.numberOfLines).toBeUndefined();

    const dismiss = pressable(tree, 'mcq-coach-dismiss');
    expect(dismiss.props.accessibilityRole).toBe('button');
    expect(
      dismiss.findAll((node) => (node.type as any) === 'Text').some((node) => node.props.children === 'Got it'),
    ).toBe(true);

    act(() => {
      dismiss.props.onPress();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // A caller-supplied testID overrides the default.
    const custom = render({ visible: true, testID: 'custom' });
    expect(views(custom.tree).some((node) => node.props.testID === 'custom')).toBe(true);
  });
});
