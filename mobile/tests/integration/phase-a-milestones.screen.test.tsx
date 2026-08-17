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

import { PermissionPromptScreen } from '../../src/screens/PermissionPromptScreen';
import { PoolPickerScreen } from '../../src/screens/PoolPickerScreen';
import { CollectionMilestoneScreen } from '../../src/screens/CollectionMilestoneScreen';
import { MasteryMilestoneScreen } from '../../src/screens/MasteryMilestoneScreen';

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('phase A milestone and support routes', () => {
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

  it('hands permission prompt into first-draw home', async () => {
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PermissionPromptScreen navigation={{ replace } as any} route={{ key: 'permission', name: 'PermissionPrompt' } as any} />);
    });
    await act(async () => {
      // PermissionPrompt v3 — Allow reminders now triggers the real
      // expo-notifications permission request before navigating, so
      // the press handler is async. We await the microtasks so the
      // navigation.replace gets called inside `act`.
      findPressableByText(tree, 'Allow reminders').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(replace).toHaveBeenCalledWith('Home', { firstDrawCoach: true });
  });

  it('switches pools back into home', async () => {
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PoolPickerScreen navigation={{ replace } as any} route={{ key: 'pool', name: 'PoolPicker', params: { activePoolId: 'csharp' } } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'AWS SAA').props.onPress();
    });
    expect(replace).toHaveBeenCalledWith('Home', { mockState: 'paused' });
  });

  it('returns from collection milestone to settlement', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<CollectionMilestoneScreen navigation={{ navigate } as any} route={{ key: 'collection', name: 'CollectionMilestone', params: { poolId: 'csharp', tier: 'bronze' } } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Back to settlement').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Settlement', expect.objectContaining({ slug: 'csharp' }));
  });

  it('returns from mastery milestone to settlement', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<MasteryMilestoneScreen navigation={{ navigate } as any} route={{ key: 'mastery', name: 'MasteryMilestone', params: { poolId: 'csharp', tier: 'junior' } } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Back to settlement').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Settlement', expect.objectContaining({ slug: 'csharp' }));
  });
});
