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

import { CardDetailScreen } from '../../src/screens/CardDetailScreen';
import { PlanTodayScreen } from '../../src/screens/PlanTodayScreen';
import { FreePullGrantScreen } from '../../src/screens/FreePullGrantScreen';
import { DormantNudgeScreen } from '../../src/screens/DormantNudgeScreen';
import { MilestoneDetailScreen } from '../../src/screens/MilestoneDetailScreen';

function collectText(node: renderer.ReactTestInstance): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') {
      parts.push(child);
      continue;
    }
    parts.push(collectText(child));
  }
  return parts.join(' ');
}

function textBlob(tree: renderer.ReactTestRenderer): string {
  return collectText(tree.root).replace(/\s+/g, ' ').trim();
}

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('phase B deeper routes', () => {
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

  it('returns from card detail to library', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<CardDetailScreen navigation={{ navigate } as any} route={{ key: 'card', name: 'CardDetail', params: { cardId: 'card-1' } } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Back to library').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Library');
  });

  it('starts a level from plan today', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlanTodayScreen navigation={{ navigate } as any} route={{ key: 'plan-today', name: 'PlanToday' } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Start session').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Level', { slug: 'csharp', source: 'daily-dose' });
  });

  it('opens draw from free pull grant', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<FreePullGrantScreen navigation={{ navigate } as any} route={{ key: 'grant', name: 'FreePullGrant', params: { count: 3, source: 'streak' } } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Open draw').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
  });

  it('opens fresh start from dormant nudge', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DormantNudgeScreen navigation={{ navigate } as any} route={{ key: 'dormant', name: 'DormantNudge' } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Fresh start').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('FreshStartLanding');
  });

  it('renders milestone-specific detail instead of one hardcoded badge body', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<MilestoneDetailScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'detail', name: 'MilestoneDetail', params: { milestoneId: 'junior-master' } } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Junior Master');
    expect(blob).toContain('Hall badge + route prestige');
    expect(blob).not.toContain('Bronze Collect');
  });
});
