import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
    KeyboardAvoidingView: ({ children, ...props }: any) => React.createElement('KeyboardAvoidingView', props, children),
    TextInput: ({ children, ...props }: any) => React.createElement('TextInput', props, children),
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Alert: { alert: vi.fn() },
    Platform: { OS: 'ios' },
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {} },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      loading: false,
      status: 'signed_out',
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      confirmSignUpCode: vi.fn(),
      resendConfirmCode: vi.fn(),
    }),
}));

import SignInScreen from '../../src/screens/SignInScreen';
import SignUpScreen from '../../src/screens/SignUpScreen';
import ConfirmSignUpScreen from '../../src/screens/ConfirmSignUpScreen';

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

describe('auth polish screens', () => {
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

  it('keeps sign-in productized around sync and recovery instead of generic auth copy', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SignInScreen navigation={{ goBack: vi.fn(), canGoBack: () => true, reset: vi.fn(), navigate: vi.fn() } as any} route={{ key: 'signin', name: 'SignIn' } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Welcome back');
    expect(blob).toContain('Sign in to restore your study progress, sync, and account recovery.');
    expect(blob).toContain('Use the verified email tied to your study history.');
    expect(blob).toContain('Create an account');
    expect(blob).not.toContain('Sign in to sync your progress.');
  });

  it('keeps sign-up focused on protecting sync and future account recovery', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SignUpScreen navigation={{ goBack: vi.fn(), replace: vi.fn() } as any} route={{ key: 'signup', name: 'SignUp' } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Create your account');
    expect(blob).toContain('Verify email to protect sync and future account recovery.');
    expect(blob).toContain('We’ll send a verification code before cloud sync turns on.');
    expect(blob).toContain('Use an email you can access again later if you ever need to recover your account.');
  });

  it('keeps email-confirmation copy calm and trustworthy', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ConfirmSignUpScreen navigation={{ goBack: vi.fn(), replace: vi.fn() } as any} route={{ key: 'confirm', name: 'ConfirmSignUp', params: { email: 'person@example.com' } } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Verify your email');
    expect(blob).toContain('Use the latest code to finish protecting sync and recovery.');
    expect(blob).toContain('Only the latest code works. If you requested several, use the newest email.');
    expect(blob).not.toContain('Use the latest code you received.');
  });
});
