import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

import { SessionSummaryScreen } from '../../src/screens/SessionSummaryScreen';

function getTextContent(node: any): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (node?.props?.children) return getTextContent(node.props.children);
  return '';
}

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && getTextContent(child) === label).length > 0,
  );
}

describe('SessionSummaryScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('applies the reward to the wallet once and shows wallet-aware copy', async () => {
    const navigation = {
      navigate: vi.fn(),
    } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={navigation}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              sessionId: 'sess-1',
              slug: 'csharp',
              deckTitle: 'C# Interview',
              sessionDone: 4,
              sessionLimit: 4,
              minimumGoal: 1,
              dueCount: 3,
              streakEarned: true,
            },
          } as any}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const texts = tree.root.findAll((node) => (node.type as any) === 'Text').map(getTextContent).join('\n');
    expect(texts).toContain('+2 free pulls');
    expect(texts).toContain('2 ready to use');
    expect(texts).toContain('Daily streak');
    expect(texts).toContain('First day complete');

    await act(async () => {
      tree.update(
        <SessionSummaryScreen
          navigation={navigation}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              sessionId: 'sess-1',
              slug: 'csharp',
              deckTitle: 'C# Interview',
              sessionDone: 4,
              sessionLimit: 4,
              minimumGoal: 1,
              dueCount: 3,
              streakEarned: true,
            },
          } as any}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const walletRaw = store.get('recallsmith:reward-wallet:v1');
    expect(walletRaw).toBeTruthy();
    expect(JSON.parse(walletRaw!)).toEqual({ availablePulls: 2, reservePulls: 0 });

    act(() => {
      findPressableByText(tree, 'Open draw').props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
  });
});
