import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
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

import { WelcomeScreen } from '../../src/screens/WelcomeScreen';

const ONBOARDING_STAGE_KEY = 'recallsmith:onboarding:stage:v1';

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0);
}

describe('welcome sign-in link', () => {
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

  it('offers returning users a sign-in link on Welcome', async () => {
    const navigate = vi.fn();
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WelcomeScreen navigation={{ navigate, replace } as any} route={{ key: 'welcome', name: 'Welcome' } as any} />);
    });

    await act(async () => {
      findPressableByText(tree, 'I already have an account').props.onPress();
      await Promise.resolve();
    });

    // Opens SignIn without completing onboarding: the user returns to Welcome
    // and taps Continue to finish setup.
    expect(navigate).toHaveBeenCalledWith('SignIn');
    expect(replace).not.toHaveBeenCalled();
    expect(store.get(ONBOARDING_STAGE_KEY)).toBeUndefined();
  });

  it('still advances new users to the audience survey', async () => {
    const navigate = vi.fn();
    const replace = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WelcomeScreen navigation={{ navigate, replace } as any} route={{ key: 'welcome', name: 'Welcome' } as any} />);
    });

    await act(async () => {
      findPressableByText(tree, 'Continue').props.onPress();
      await Promise.resolve();
    });

    expect(replace).toHaveBeenCalledWith('AudienceSurvey');
  });
});
