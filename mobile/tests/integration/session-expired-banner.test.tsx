import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bannerState } = vi.hoisted(() => ({
  bannerState: { sessionExpired: false } as { sessionExpired: boolean },
}));

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
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) => selector(bannerState),
}));

import {
  SessionExpiredBanner,
  SESSION_EXPIRED_COPY,
} from '../../src/auth/SessionExpiredBanner';

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

describe('SessionExpiredBanner', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    bannerState.sessionExpired = false;
  });

  it('shows the session expired banner and routes to SignIn', async () => {
    bannerState.sessionExpired = true;
    const onSignIn = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SessionExpiredBanner onSignIn={onSignIn} />);
    });

    const banner = findByTestID(tree, 'session-expired-banner');
    expect(banner).toHaveLength(1);
    expect(textBlob(tree)).toContain(SESSION_EXPIRED_COPY);

    act(() => {
      banner[0].props.onPress();
    });
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while the session is valid', async () => {
    bannerState.sessionExpired = false;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SessionExpiredBanner onSignIn={vi.fn()} />);
    });

    expect(findByTestID(tree, 'session-expired-banner')).toHaveLength(0);
    expect(tree.toJSON()).toBeNull();
  });
});
