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

describe('SessionSummaryScreen picks line', () => {
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

  const ONE_NEW_CARD_REWARD = {
    newCardPulls: 1,
    newCardUids: ['u1'],
    dueClearPulls: 0 as const,
    rewardPulls: 1,
    applied: 1,
    dropped: 0,
    walletBefore: { availablePulls: 0, reservePulls: 0 },
    walletAfter: { availablePulls: 1, reservePulls: 0 },
  };

  const LINE = 'At this pace, about 12 cards come due tomorrow.';
  const baseParams = {
    sessionId: 'sess-forecast',
    slug: 'csharp',
    deckTitle: 'C# Interview',
    sessionDone: 20,
    sessionLimit: 20,
    minimumGoal: 1,
    dueCount: 0,
    streakEarned: true,
    reward: ONE_NEW_CARD_REWARD,
  };

  const findPicks = (tree: renderer.ReactTestRenderer) =>
    tree.root.findAll((node) => (node.type as any) === 'Text' && node.props?.testID === 'session-summary-picks');

  async function mount(params: Record<string, unknown>) {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'summary', name: 'SessionSummary', params } as any}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return tree;
  }

  it('renders the picks line under the forecast line', async () => {
    const tree = await mount({ ...baseParams, loadForecast: LINE, picks: { landed: 3, answered: 5 } });

    const picks = findPicks(tree);
    expect(picks).toHaveLength(1);
    expect(getTextContent(picks[0])).toBe('3 of 5 picks landed');
    expect(picks[0].props.numberOfLines).toBe(2);

    const order = tree.root
      .findAll(
        (node) =>
          typeof node.type === 'string' &&
          ['summary-reward-block', 'session-summary-load-forecast', 'session-summary-picks', 'summary-progress-block'].includes(
            node.props?.testID,
          ),
      )
      .map((node) => node.props.testID);
    expect(order).toEqual([
      'summary-reward-block',
      'session-summary-load-forecast',
      'session-summary-picks',
      'summary-progress-block',
    ]);
  });

  it('spells out the ten-minute return when no pick landed', async () => {
    const tree = await mount({ ...baseParams, picks: { landed: 0, answered: 5 } });
    const picks = findPicks(tree);
    expect(picks).toHaveLength(1);
    expect(getTextContent(picks[0])).toBe("0 of 5 picks landed — they're all back in 10 minutes");
  });

  it('renders no picks line for a Q/A run', async () => {
    const tree = await mount(baseParams);
    expect(findPicks(tree)).toHaveLength(0);
  });
});
