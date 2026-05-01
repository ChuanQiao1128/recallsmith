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

import { DailyDoseScreen } from '../../src/screens/DailyDoseScreen';
import { SettlementScreen } from '../../src/screens/SettlementScreen';

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0);
}

describe('phase A daily dose and settlement screens', () => {
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

  it('starts the level flow from the daily dose screen', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DailyDoseScreen navigation={{ navigate } as any} route={{ key: 'dose', name: 'DailyDose', params: { slug: 'csharp' } } as any} />);
    });

    act(() => {
      findPressableByText(tree, 'Start daily dose').props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('Level', expect.objectContaining({ slug: 'csharp', source: 'daily-dose' }));
  });

  it('routes settlement into mastery celebration', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SettlementScreen navigation={{ navigate } as any} route={{ key: 'settlement', name: 'Settlement', params: { slug: 'csharp', deckTitle: 'C# Interview', sessionDone: 4, rewardPulls: 2, masteredCount: 1 } } as any} />);
    });

    act(() => {
      findPressableByText(tree, 'Celebrate mastery').props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('MasteredCelebration', { slug: 'csharp', deckTitle: 'C# Interview', masteredCount: 1 });
  });

  it('offers a direct reward-draw handoff from settlement when pulls were earned', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SettlementScreen navigation={{ navigate } as any} route={{ key: 'settlement', name: 'Settlement', params: { slug: 'csharp', deckTitle: 'C# Interview', sessionDone: 4, rewardPulls: 2, masteredCount: 1 } } as any} />);
    });

    act(() => {
      findPressableByText(tree, 'Open reward draw').props.onPress();
    });

    expect(navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
  });
});
