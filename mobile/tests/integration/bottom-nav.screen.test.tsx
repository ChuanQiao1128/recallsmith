import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import BottomTabBar from '../../src/components/BottomTabBar';

function findPressableByLabel(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('BottomTabBar', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('renders all five primary tabs', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BottomTabBar active="home" navigate={vi.fn()} />);
    });

    const textBlob = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => String(node.props.children))
      .join(' ');

    expect(textBlob).toContain('Home');
    expect(textBlob).toContain('Draw');
    expect(textBlob).toContain('Review');
    expect(textBlob).toContain('Library');
    expect(textBlob).toContain('Me');
  });

  it('routes review tab presses to Challenge', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BottomTabBar active="library" navigate={navigate} />);
    });

    act(() => {
      findPressableByLabel(tree, 'Review').props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('Challenge');
  });

  it('routes me tab presses to More', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BottomTabBar active="home" navigate={navigate} />);
    });

    act(() => {
      findPressableByLabel(tree, 'Me').props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('More');
  });
});
