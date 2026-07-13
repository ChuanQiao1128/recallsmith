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

import { SplashScreen } from '../../src/screens/SplashScreen';
import { WelcomeScreen } from '../../src/screens/WelcomeScreen';
import { AudienceSurveyScreen } from '../../src/screens/AudienceSurveyScreen';

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0);
}

describe('phase A onboarding screens', () => {
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

  it('routes splash to welcome for a new user', async () => {
    const replace = vi.fn();
    await act(async () => {
      renderer.create(<SplashScreen navigation={{ replace } as any} route={{ key: 'splash', name: 'Splash' } as any} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(replace).toHaveBeenCalledWith('Welcome');
  });

  it('advances welcome into audience survey and finishes onboarding', async () => {
    const replace = vi.fn();
    let welcomeTree!: renderer.ReactTestRenderer;
    await act(async () => {
      welcomeTree = renderer.create(<WelcomeScreen navigation={{ replace } as any} route={{ key: 'welcome', name: 'Welcome' } as any} />);
    });

    // Welcome v3 is a single page (no more 3-swipe carousel + Next buttons).
    // One tap on the primary CTA completes the welcome stage and replaces
    // into the audience survey. CTA copy was "Continue to audience" —
    // simplified to "Continue" because "audience" was internal jargon
    // that meant nothing to first-time users.
    await act(async () => {
      findPressableByText(welcomeTree, 'Continue').props.onPress();
      await Promise.resolve();
    });
    expect(replace).toHaveBeenCalledWith('AudienceSurvey');

    let surveyTree!: renderer.ReactTestRenderer;
    await act(async () => {
      surveyTree = renderer.create(<AudienceSurveyScreen navigation={{ replace } as any} route={{ key: 'audience', name: 'AudienceSurvey' } as any} />);
    });

    await act(async () => {
      // Audience option labels were rewritten outcome-driven:
      // Junior → "Just starting", Both → "Mix it up", All → "Push me"
      findPressableByText(surveyTree, 'Push me').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findPressableByText(surveyTree, 'Finish setup').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.get('recallsmith:audience-preference:v1')).toBe('all');
    expect(store.get('recallsmith:onboarding:stage:v1')).toBe('done');
    expect(replace).toHaveBeenCalledWith('PermissionPrompt');
  });
});
