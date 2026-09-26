import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({
  store: {
    loading: false,
    status: 'anonymous' as string,
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    confirmSignUpCode: vi.fn(),
    resendConfirmCode: vi.fn(),
    requestPasswordReset: vi.fn(),
    confirmPasswordReset: vi.fn(),
    init: vi.fn(async () => {}),
  },
}));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
    KeyboardAvoidingView: ({ children, ...props }: any) =>
      React.createElement('KeyboardAvoidingView', props, children),
    TextInput: ({ children, ...props }: any) => React.createElement('TextInput', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Alert: { alert: vi.fn() },
    Platform: { OS: 'ios' },
    StyleSheet: { create: (styles: any) => styles, absoluteFill: {} },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

vi.mock('../../src/auth/authStore', () => {
  const useAuthStore: any = (selector: any) => selector(store);
  useAuthStore.getState = () => store;
  return { useAuthStore };
});

import { Alert } from 'react-native';
import SignInScreen from '../../src/screens/SignInScreen';
import SignUpScreen from '../../src/screens/SignUpScreen';
import ConfirmSignUpScreen from '../../src/screens/ConfirmSignUpScreen';
import ForgotPasswordScreen from '../../src/screens/ForgotPasswordScreen';
import { AuthFlowError } from '../../src/auth/authErrors';

const mockAlert = vi.mocked(Alert.alert);

function makeNav() {
  return {
    navigate: vi.fn(),
    replace: vi.fn(),
    goBack: vi.fn(),
    popTo: vi.fn(),
    reset: vi.fn(),
    canGoBack: vi.fn(() => true),
    getState: vi.fn(() => ({ routes: [{ name: 'Home' }, { name: 'SignIn' }] })),
  };
}

function byTestID(tree: renderer.ReactTestRenderer, id: string) {
  return tree.root.findByProps({ testID: id });
}

function byPlaceholder(tree: renderer.ReactTestRenderer, placeholder: string) {
  return tree.root.findAllByProps({ placeholder })[0];
}

function collectText(node: renderer.ReactTestInstance): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') parts.push(child);
    else parts.push(collectText(child));
  }
  return parts.join('');
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('auth recovery screens', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    store.loading = false;
    store.status = 'anonymous';
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('sign-in shows a Forgot password link that opens ForgotPassword with the typed email', async () => {
    const navigation = makeNav();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SignInScreen navigation={navigation as any} route={{ key: 'signin', name: 'SignIn', params: {} } as any} />,
      );
    });

    await act(async () => {
      byPlaceholder(tree, 'you@example.com').props.onChangeText('Me@Example.com');
    });
    await act(async () => {
      byTestID(tree, 'signin-forgot-password').props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith('ForgotPassword', { email: 'me@example.com' });
  });

  it('an unconfirmed sign-in resends the code and opens ConfirmSignUp', async () => {
    store.signInWithEmail.mockRejectedValue(new AuthFlowError('NEEDS_CONFIRMATION', 'verify first'));
    store.resendConfirmCode.mockResolvedValue(undefined);

    const navigation = makeNav();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SignInScreen navigation={navigation as any} route={{ key: 'signin', name: 'SignIn', params: {} } as any} />,
      );
    });

    await act(async () => {
      byPlaceholder(tree, 'you@example.com').props.onChangeText('user@example.com');
    });
    await act(async () => {
      byPlaceholder(tree, 'Your password').props.onChangeText('whatever');
    });
    await act(async () => {
      byPlaceholder(tree, 'Your password').props.onSubmitEditing();
    });
    await flush();

    expect(store.resendConfirmCode).toHaveBeenCalledWith('user@example.com');
    expect(navigation.navigate).toHaveBeenCalledWith('ConfirmSignUp', { email: 'user@example.com' });
  });

  it('sign-up with an existing unconfirmed email resends the code and opens ConfirmSignUp', async () => {
    store.signUpWithEmail.mockRejectedValue(new AuthFlowError('USERNAME_EXISTS', 'already exists'));
    store.resendConfirmCode.mockResolvedValue(undefined);

    const navigation = makeNav();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SignUpScreen navigation={navigation as any} route={{ key: 'signup', name: 'SignUp' } as any} />,
      );
    });

    await act(async () => {
      byPlaceholder(tree, 'you@example.com').props.onChangeText('user@example.com');
    });
    await act(async () => {
      byPlaceholder(tree, 'Create a password').props.onChangeText('Abcdef1!');
    });
    await act(async () => {
      byPlaceholder(tree, 'Create a password').props.onSubmitEditing();
    });
    await flush();

    expect(store.resendConfirmCode).toHaveBeenCalledWith('user@example.com');
    expect(navigation.replace).toHaveBeenCalledWith('ConfirmSignUp', { email: 'user@example.com' });
  });

  it('forgot password sends a code, then sets the new password and returns to sign-in', async () => {
    store.requestPasswordReset.mockResolvedValue(undefined);
    store.confirmPasswordReset.mockResolvedValue(undefined);

    const navigation = makeNav();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ForgotPasswordScreen
          navigation={navigation as any}
          route={{ key: 'forgot', name: 'ForgotPassword', params: { email: 'user@example.com' } } as any}
        />,
      );
    });

    await act(async () => {
      byTestID(tree, 'forgot-send-code').props.onPress();
    });
    await flush();
    expect(store.requestPasswordReset).toHaveBeenCalledWith('user@example.com');

    await act(async () => {
      byTestID(tree, 'forgot-code-input').props.onChangeText('123456');
    });
    await act(async () => {
      byTestID(tree, 'forgot-new-password-input').props.onChangeText('Abcdef1!');
    });
    await act(async () => {
      byTestID(tree, 'forgot-confirm').props.onPress();
    });
    await flush();

    expect(store.confirmPasswordReset).toHaveBeenCalledWith('user@example.com', '123456', 'Abcdef1!');
    expect(navigation.popTo).toHaveBeenCalledWith('SignIn', { email: 'user@example.com' });
  });

  it('sign-up shows the live password checklist', async () => {
    const navigation = makeNav();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SignUpScreen navigation={navigation as any} route={{ key: 'signup', name: 'SignUp' } as any} />,
      );
    });

    // Empty password: every rule shows the unmet bullet.
    for (const id of ['length', 'upper', 'lower', 'number', 'symbol']) {
      expect(collectText(byTestID(tree, `signup-password-rule-${id}`))).toContain('•');
    }

    await act(async () => {
      byPlaceholder(tree, 'Create a password').props.onChangeText('Abcdef1!');
    });

    // A fully valid password checks every rule.
    for (const id of ['length', 'upper', 'lower', 'number', 'symbol']) {
      expect(collectText(byTestID(tree, `signup-password-rule-${id}`))).toContain('✓');
    }
  });

  it('auth inputs carry iOS AutoFill hints', async () => {
    const navigation = makeNav();

    let signIn!: renderer.ReactTestRenderer;
    await act(async () => {
      signIn = renderer.create(
        <SignInScreen navigation={navigation as any} route={{ key: 'signin', name: 'SignIn', params: {} } as any} />,
      );
    });
    expect(byPlaceholder(signIn, 'you@example.com').props.textContentType).toBe('username');
    expect(byPlaceholder(signIn, 'you@example.com').props.autoComplete).toBe('email');
    expect(byPlaceholder(signIn, 'Your password').props.textContentType).toBe('password');
    expect(byPlaceholder(signIn, 'Your password').props.autoComplete).toBe('current-password');

    let signUp!: renderer.ReactTestRenderer;
    await act(async () => {
      signUp = renderer.create(
        <SignUpScreen navigation={navigation as any} route={{ key: 'signup', name: 'SignUp' } as any} />,
      );
    });
    expect(byPlaceholder(signUp, 'you@example.com').props.textContentType).toBe('username');
    expect(byPlaceholder(signUp, 'Create a password').props.textContentType).toBe('newPassword');
    expect(byPlaceholder(signUp, 'Create a password').props.autoComplete).toBe('new-password');

    let confirm!: renderer.ReactTestRenderer;
    await act(async () => {
      confirm = renderer.create(
        <ConfirmSignUpScreen
          navigation={navigation as any}
          route={{ key: 'confirm', name: 'ConfirmSignUp', params: { email: 'user@example.com' } } as any}
        />,
      );
    });
    const codeInput = byPlaceholder(confirm, '123456');
    expect(codeInput.props.textContentType).toBe('oneTimeCode');
    expect(codeInput.props.autoComplete).toBe('one-time-code');

    expect(mockAlert).not.toHaveBeenCalled();
  });
});
