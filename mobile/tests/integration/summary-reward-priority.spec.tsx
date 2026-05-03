import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('summary reward priority', () => {
  beforeEach(() => {
    store.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('renders reward block above progress block', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              sessionId: 'sess-priority-1',
              slug: 'csharp',
              deckTitle: 'C# Interview',
              sessionDone: 4,
              sessionLimit: 4,
              minimumGoal: 1,
              dueCount: 2,
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

    const all = tree.root.findAll(() => true);
    const rewardIndex = all.findIndex((node) => node.props?.testID === 'summary-reward-block');
    const progressIndex = all.findIndex((node) => node.props?.testID === 'summary-progress-block');

    expect(rewardIndex).toBeGreaterThanOrEqual(0);
    expect(progressIndex).toBeGreaterThanOrEqual(0);
    expect(rewardIndex).toBeLessThan(progressIndex);
  });
});
