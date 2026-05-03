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

import { WeekSummaryScreen } from '../../src/screens/WeekSummaryScreen';
import { PoolLaunchScreen } from '../../src/screens/PoolLaunchScreen';
import { FreshStartLandingScreen } from '../../src/screens/FreshStartLandingScreen';

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('phase A support screens', () => {
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

  it('opens plan overview from week summary', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeekSummaryScreen navigation={{ navigate } as any} route={{ key: 'week', name: 'WeekSummary' } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Open week plan').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('PlanOverview');
  });

  it('opens aws draw from pool launch', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PoolLaunchScreen navigation={{ navigate } as any} route={{ key: 'pool', name: 'PoolLaunch' } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Open AWS draw').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Draw', { slug: 'aws' });
  });

  it('opens fresh start confirm from fresh start landing', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<FreshStartLandingScreen navigation={{ navigate } as any} route={{ key: 'fresh', name: 'FreshStartLanding' } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Review reset options').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('FreshStartConfirm');
  });
});
