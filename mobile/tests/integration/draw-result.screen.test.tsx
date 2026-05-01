import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Modal: ({ children, visible }: any) => (visible ? React.createElement('Modal', null, children) : null),
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
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

import { DrawResultScreen } from '../../src/screens/DrawResultScreen';
import { MOCK_DRAW_RESULTS } from '../../src/mock/draw';

function findPressablesByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

function collectText(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
    const c = node.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  }).join('\n');
}

describe('DrawResultScreen', () => {
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

  it('opens card detail modal from a draw result card', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'draw-result', name: 'DrawResult', params: { slug: 'csharp', drawResult: MOCK_DRAW_RESULTS } } as any} />);
    });

    act(() => {
      findPressablesByText(tree, MOCK_DRAW_RESULTS.cards[0].question)[0].props.onPress();
    });

    const textBlob = collectText(tree);

    expect(textBlob).toContain('Close detail');
    expect(textBlob).toContain(MOCK_DRAW_RESULTS.cards[0].question);
  });

  it('uses study-focused result actions instead of Enter level', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'draw-result', name: 'DrawResult', params: { slug: 'csharp', drawResult: MOCK_DRAW_RESULTS } } as any} />);
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Start studying drawn cards');
    expect(textBlob).toContain('View library first');
    expect(textBlob).toContain('Back to Home');
    expect(textBlob).not.toContain('Enter level');
    expect(textBlob).not.toContain('Store for later');
  });

  it('uses the reward draw naming system consistently on the result page', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawResultScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'draw-result', name: 'DrawResult', params: { slug: 'csharp', drawResult: MOCK_DRAW_RESULTS } } as any} />);
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Reward draw result');
    expect(textBlob).toContain('drawn cards');
    expect(textBlob).toContain('seed #');
    expect(textBlob).not.toContain('COLLECTIBLE REVEAL');
    expect(textBlob).not.toContain('BOSS PULL');
  });
});
