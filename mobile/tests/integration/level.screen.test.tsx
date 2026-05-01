import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    Modal: ({ children, visible }: any) => (visible ? React.createElement('Modal', null, children) : null),
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children) };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

import { LevelScreen } from '../../src/screens/LevelScreen';

function findPressablesByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('LevelScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('moves from intro through q/a/irl and settles after the final rating', async () => {
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LevelScreen navigation={{ replace, navigate: vi.fn() } as any} route={{ key: 'level', name: 'Level', params: { slug: 'csharp', source: 'draw', cardIds: ['draw-1'] } } as any} />);
    });

    act(() => {
      findPressablesByText(tree, 'Start level')[0].props.onPress();
    });

    act(() => {
      findPressablesByText(tree, 'See answer')[0].props.onPress();
    });

    act(() => {
      findPressablesByText(tree, 'Real-world check')[0].props.onPress();
    });

    act(() => {
      findPressablesByText(tree, 'Good')[0].props.onPress();
    });

    expect(replace).toHaveBeenCalledWith(
      'Settlement',
      expect.objectContaining({ slug: 'csharp', sessionDone: 1 }),
    );
  });
});
