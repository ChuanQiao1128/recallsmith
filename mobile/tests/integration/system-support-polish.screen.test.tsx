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

import { ErrorNetworkScreen } from '../../src/screens/ErrorNetworkScreen';
import { ErrorGenericScreen } from '../../src/screens/ErrorGenericScreen';
import { OfflineBannerScreen } from '../../src/screens/OfflineBannerScreen';
import { ToastHostScreen } from '../../src/screens/ToastHostScreen';
import { CoachOverlayScreen } from '../../src/screens/CoachOverlayScreen';
import { DebugMenuScreen } from '../../src/screens/DebugMenuScreen';

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

describe('system support polish screens', () => {
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

  it('keeps network/offline/error surfaces calm and recovery-oriented', async () => {
    const navigate = vi.fn();

    let networkTree!: renderer.ReactTestRenderer;
    await act(async () => {
      networkTree = renderer.create(<ErrorNetworkScreen navigation={{ navigate } as any} route={{ key: 'network', name: 'ErrorNetwork' } as any} />);
    });
    const networkBlob = textBlob(networkTree);
    expect(networkBlob).toContain('Connection lost, but your route is still safe');
    expect(networkBlob).toContain('Best next move');
    expect(networkBlob).toContain('Offline banner');

    let offlineTree!: renderer.ReactTestRenderer;
    await act(async () => {
      offlineTree = renderer.create(<OfflineBannerScreen navigation={{ navigate } as any} route={{ key: 'offline', name: 'OfflineBanner' } as any} />);
    });
    const offlineBlob = textBlob(offlineTree);
    expect(offlineBlob).toContain('Non-blocking offline messaging');
    expect(offlineBlob).toContain('Progress will sync when the connection returns');
    expect(offlineBlob).toContain('The user can keep reading and browsing locally');

    let errorTree!: renderer.ReactTestRenderer;
    await act(async () => {
      errorTree = renderer.create(<ErrorGenericScreen navigation={{ navigate } as any} route={{ key: 'generic', name: 'ErrorGeneric' } as any} />);
    });
    const errorBlob = textBlob(errorTree);
    expect(errorBlob).toContain('Something went wrong, but the route can recover');
    expect(errorBlob).toContain('Recovery options');
    expect(errorBlob).toContain('Debug menu');
  });

  it('keeps toast/coach/debug surfaces in one coherent support lane', async () => {
    const navigate = vi.fn();

    let toastTree!: renderer.ReactTestRenderer;
    await act(async () => {
      toastTree = renderer.create(<ToastHostScreen navigation={{ navigate } as any} route={{ key: 'toast', name: 'ToastHost' } as any} />);
    });
    const toastBlob = textBlob(toastTree);
    expect(toastBlob).toContain('Reusable success, warning, and error messaging');
    expect(toastBlob).toContain('Messaging posture');
    expect(toastBlob).not.toContain('canonical preview page');

    let coachTree!: renderer.ReactTestRenderer;
    await act(async () => {
      coachTree = renderer.create(<CoachOverlayScreen navigation={{ navigate } as any} route={{ key: 'coach', name: 'CoachOverlay' } as any} />);
    });
    const coachBlob = textBlob(coachTree);
    expect(coachBlob).toContain('First-visit teaching flow');
    expect(coachBlob).toContain('Teaching posture');
    expect(coachBlob).not.toContain('previews the actual teaching sequence');

    let debugTree!: renderer.ReactTestRenderer;
    await act(async () => {
      debugTree = renderer.create(<DebugMenuScreen navigation={{ navigate } as any} route={{ key: 'debug', name: 'DebugMenu' } as any} />);
    });
    const debugBlob = textBlob(debugTree);
    expect(debugBlob).toContain('Scenario switching and QA shortcuts');
    expect(debugBlob).toContain('Scenarios');

    act(() => {
      findPressableByText(debugTree, 'Open error shell').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('ErrorGeneric');
  });
});
