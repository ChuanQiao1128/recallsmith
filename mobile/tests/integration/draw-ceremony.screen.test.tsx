import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
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

import { DrawCeremonyScreen } from '../../src/screens/DrawCeremonyScreen';
import { MOCK_DRAW_RESULTS } from '../../src/mock/draw';

function collectText(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
    const c = node.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  }).join('\n');
}

describe('DrawCeremonyScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('uses reward-draw naming consistently during ceremony', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DrawCeremonyScreen navigation={{ replace: vi.fn() } as any} route={{ key: 'draw-ceremony', name: 'DrawCeremony', params: { slug: 'csharp', drawResult: MOCK_DRAW_RESULTS } } as any} />);
    });

    const textBlob = collectText(tree);
    expect(textBlob).toContain('Reward draw ceremony');
    expect(textBlob).toContain('Reward draw results lock in immediately after the ceremony, then hand off into the result spread.');
    expect(textBlob).toContain('Featured reward window');
    expect(textBlob).toContain('seed #');
    expect(textBlob).not.toContain('collectible reveal');
  });
});
