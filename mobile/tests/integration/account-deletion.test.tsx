import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncStore } = vi.hoisted(() => ({ asyncStore: new Map<string, string>() }));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    TextInput: ({ children, ...props }: any) => React.createElement('TextInput', props, children),
    StyleSheet: { create: (styles: any) => styles },
    Platform: { OS: 'ios' },
  };
});

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  // getFreshAccessToken (via freshToken.ts) re-reads the session before the
  // server delete; return a token so it resolves to a fresh access token
  // instead of tripping the session-expired path.
  fetchAuthSession: vi.fn(async () => ({
    tokens: { accessToken: 'fresh-access', idToken: 'fresh-id' },
  })),
  getCurrentUser: vi.fn(),
  deleteUser: vi.fn(async () => {}),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  autoSignIn: vi.fn(),
}));

// The real server-delete is exercised in tests/unit/deleteServerAccount.test.ts.
// Here we mock the call but keep the real AccountDeletionError class so
// `err instanceof AccountDeletionError` and the friendly copy stay authentic.
vi.mock('../../src/auth/deleteServerAccount', async (importActual) => {
  const actual = await importActual<typeof import('../../src/auth/deleteServerAccount')>();
  return {
    ...actual,
    deleteServerAccountData: vi.fn(async () => 'deleted' as const),
  };
});

vi.mock('../../src/premium/revenuecat', () => ({
  rcLogout: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (asyncStore.has(k) ? asyncStore.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => {
      asyncStore.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      asyncStore.delete(k);
    }),
    getAllKeys: vi.fn(async () => Array.from(asyncStore.keys())),
    multiRemove: vi.fn(async (ks: string[]) => {
      ks.forEach((k) => asyncStore.delete(k));
    }),
  },
}));

vi.mock('../../src/sync/progressSync', () => ({
  setSyncAccessToken: vi.fn(async () => {}),
  setActiveUserSub: vi.fn(async () => {}),
  forceProgressSync: vi.fn(async () => {}),
  scheduleProgressSync: vi.fn(async () => {}),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteUser, signOut } from 'aws-amplify/auth';
import { setSyncAccessToken } from '../../src/sync/progressSync';
import { useAuthStore } from '../../src/auth/authStore';
import {
  AccountDeletionError,
  deleteServerAccountData,
} from '../../src/auth/deleteServerAccount';
import { rcLogout } from '../../src/premium/revenuecat';
import { AccountSection, ACCOUNT_COPY } from '../../src/features/gacha/settings/account/AccountSection';

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

function findByTestID(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll(
    (node) => typeof node.type === 'string' && (node.props as any)?.testID === testID,
  );
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('account deletion', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.clearAllMocks();
    // clearAllMocks resets call history but not implementations; restore clean
    // defaults for the mocks individual tests override with persistent impls.
    (deleteServerAccountData as any).mockReset();
    (deleteServerAccountData as any).mockResolvedValue('deleted');
    (deleteUser as any).mockReset();
    (deleteUser as any).mockResolvedValue(undefined);
    asyncStore.clear();
    useAuthStore.setState({
      status: 'signed_in',
      userId: 'sub-1',
      userSub: 'sub-1',
      email: 'a@b.c',
      accessToken: null,
      idToken: null,
      lastError: null,
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('deleteAccountNow purges the deleted account partition + device streaks, keeps others, signs out', async () => {
    asyncStore.set('devcards:u:sub-1:deck-progress:csharp-basics', '1');
    asyncStore.set('devcards:u:sub-1:recallsmith:reward-wallet:v1', '1');
    asyncStore.set('devcards:u:sub-1:devcards:draw-state:csharp-basics', '1');
    asyncStore.set('recallsmith:streaks:snapshot:v1', '1');
    asyncStore.set('devcards:u:anon:deck-progress:csharp-basics', '1');
    asyncStore.set('devcards:u:sub-2:deck-progress:csharp-basics', '1');
    asyncStore.set('recallsmith:onboarding:stage', '1');

    await useAuthStore.getState().deleteAccountNow();

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(setSyncAccessToken).toHaveBeenCalledWith(null);

    expect(Array.from(asyncStore.keys()).sort()).toEqual(
      [
        'devcards:u:anon:deck-progress:csharp-basics',
        'devcards:u:sub-2:deck-progress:csharp-basics',
        'recallsmith:onboarding:stage',
      ].sort(),
    );

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().userSub).toBeNull();
  });

  it('keeps the session and surfaces an error when deleteUser rejects', async () => {
    (deleteUser as any).mockRejectedValueOnce(new Error('network down'));

    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow();

    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('signed_in');
    expect(useAuthStore.getState().lastError).not.toBeNull();
  });

  it('calls the server delete before Cognito deleteUser', async () => {
    const order: string[] = [];
    (deleteServerAccountData as any).mockImplementation(async () => {
      order.push('server');
      return 'deleted';
    });
    (deleteUser as any).mockImplementation(async () => {
      order.push('cognito');
    });

    await useAuthStore.getState().deleteAccountNow();

    expect(order).toEqual(['server', 'cognito']);
    // A fresh access token (from getFreshAccessToken) reaches the server delete.
    expect(deleteServerAccountData).toHaveBeenCalledWith('fresh-access');
  });

  it('keeps the session and does not call deleteUser when the server delete fails', async () => {
    (deleteServerAccountData as any).mockRejectedValueOnce(new AccountDeletionError('network'));

    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toBeInstanceOf(
      AccountDeletionError,
    );

    expect(deleteUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(setSyncAccessToken).not.toHaveBeenCalledWith(null);
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('signed_in');
    expect(useAuthStore.getState().lastError).toBe(new AccountDeletionError('network').message);
  });

  it('logs RevenueCat out after deleting the account', async () => {
    await useAuthStore.getState().deleteAccountNow();

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(rcLogout).toHaveBeenCalledTimes(1);
  });

  it('signOutNow logs RevenueCat out', async () => {
    await useAuthStore.getState().signOutNow();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(rcLogout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('shows the App Store subscription notice and a retry after a failed delete', async () => {
    (deleteServerAccountData as any).mockRejectedValue(new AccountDeletionError('network'));

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <AccountSection
          signedIn
          email="a@b.c"
          resetting={false}
          onSignIn={vi.fn()}
          onSignOut={vi.fn()}
          onResetReviewSchedule={vi.fn()}
          primaryCtaTestID="screen-settings-primary-cta"
        />,
      );
    });

    act(() => {
      findByTestID(tree, 'settings-delete-account-open')[0].props.onPress();
    });
    act(() => {
      findByTestID(tree, 'settings-delete-account-input')[0].props.onChangeText('DELETE');
    });
    await act(async () => {
      findByTestID(tree, 'settings-delete-account-confirm')[0].props.onPress();
      await flushMicrotasks();
    });

    // The account is still signed in; deletion was not carried out.
    expect(deleteUser).not.toHaveBeenCalled();
    expect(findByTestID(tree, 'settings-delete-account-subscription-notice').length).toBe(1);
    expect(textBlob(tree)).toContain(ACCOUNT_COPY.subscriptionNotice);
    expect(textBlob(tree)).toContain(new AccountDeletionError('network').message);

    const retry = findByTestID(tree, 'settings-delete-account-retry');
    expect(retry.length).toBe(1);
    expect(collectText(retry[0])).toContain(ACCOUNT_COPY.retry);
  });

  it('runs the typed-confirmation flow to a deleted notice', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <AccountSection
          signedIn
          email="a@b.c"
          resetting={false}
          onSignIn={vi.fn()}
          onSignOut={vi.fn()}
          onResetReviewSchedule={vi.fn()}
          primaryCtaTestID="screen-settings-primary-cta"
        />,
      );
    });

    act(() => {
      findByTestID(tree, 'settings-delete-account-open')[0].props.onPress();
    });

    expect(findByTestID(tree, 'settings-delete-account-input').length).toBe(1);

    act(() => {
      findByTestID(tree, 'settings-delete-account-input')[0].props.onChangeText('delete');
    });
    act(() => {
      findByTestID(tree, 'settings-delete-account-confirm')[0].props.onPress();
    });
    expect(deleteUser).not.toHaveBeenCalled();

    act(() => {
      findByTestID(tree, 'settings-delete-account-input')[0].props.onChangeText('DELETE');
    });
    await act(async () => {
      findByTestID(tree, 'settings-delete-account-confirm')[0].props.onPress();
      await flushMicrotasks();
    });

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(textBlob(tree)).toContain(ACCOUNT_COPY.deletedNotice);
  });

  it('hides the delete row entirely when signed out', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <AccountSection
          signedIn={false}
          email={null}
          resetting={false}
          onSignIn={vi.fn()}
          onSignOut={vi.fn()}
          onResetReviewSchedule={vi.fn()}
          primaryCtaTestID="screen-settings-primary-cta"
        />,
      );
    });

    expect(findByTestID(tree, 'settings-delete-account-open').length).toBe(0);
    expect(textBlob(tree)).not.toContain(ACCOUNT_COPY.deleteTitle);
  });

  it('keeps a single primary-cta anchor while the confirm panel is open', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <AccountSection
          signedIn
          email="a@b.c"
          resetting={false}
          onSignIn={vi.fn()}
          onSignOut={vi.fn()}
          onResetReviewSchedule={vi.fn()}
          primaryCtaTestID="screen-settings-primary-cta"
        />,
      );
    });

    act(() => {
      findByTestID(tree, 'settings-delete-account-open')[0].props.onPress();
    });

    expect(findByTestID(tree, 'screen-settings-primary-cta').length).toBe(1);
  });
});
