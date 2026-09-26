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

import { MoreScreen } from '../../src/screens/MoreScreen';
import { ProfileScreen } from '../../src/screens/ProfileScreen';
import { HelpFAQScreen } from '../../src/screens/HelpFAQScreen';
import { DebugMenuScreen } from '../../src/screens/DebugMenuScreen';

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('phase C completed surfaces', () => {
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

  it('opens profile from more', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<MoreScreen navigation={{ navigate } as any} route={{ key: 'more', name: 'More' } as any} />);
    });
    act(() => {
      findPressableByText(tree, 'Profile').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Profile');
  });

  it('no longer opens achievements from profile', async () => {
    // Was "opens achievements from profile", pinning a CTA into a screen
    // whose badge list is hardcoded. Profile is two taps from the Me tab, so
    // that CTA was the shortest route from a real user to fabricated data.
    // The screen and its route stay; the advertisement is gone.
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ProfileScreen navigation={{ navigate } as any} route={{ key: 'profile', name: 'Profile' } as any} />);
    });
    expect(tree.root.findAll(
      (node) =>
        (node.type as any) === 'Pressable' &&
        node.findAll((child) => (child.type as any) === 'Text' && child.props.children === 'Achievements').length > 0,
    )).toHaveLength(0);
    // The retired Edit profile CTA must not reappear either.
    expect(tree.root.findAll(
      (node) =>
        (node.type as any) === 'Pressable' &&
        node.findAll((child) => (child.type as any) === 'Text' && child.props.children === 'Edit profile').length > 0,
    )).toHaveLength(0);
    // The primary action is still reachable -- this is not passing because the
    // screen stopped rendering buttons. It now opens Settings instead of the
    // placeholder Edit Profile screen.
    act(() => {
      findPressableByText(tree, 'Study settings').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Settings');
  });

  it('renders faq content', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HelpFAQScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'faq', name: 'HelpFAQ' } as any} />);
    });
    const textBlob = tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    }).join('\n');
    expect(textBlob).toContain('Why is Draw locked?');
  });

  it('debug menu no longer links to the retired error and offline shells', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DebugMenuScreen navigation={{ navigate } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />);
    });
    for (const label of ['Open error shell', 'Offline banner']) {
      expect(tree.root.findAll(
        (node) =>
          (node.type as any) === 'Pressable' &&
          node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
      )).toHaveLength(0);
    }
  });
});
