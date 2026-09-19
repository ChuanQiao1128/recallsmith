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

import { HelpFAQScreen } from '../../src/screens/HelpFAQScreen';
import { AboutScreen } from '../../src/screens/AboutScreen';
import { ErrorGenericScreen } from '../../src/screens/ErrorGenericScreen';
import { ErrorNetworkScreen } from '../../src/screens/ErrorNetworkScreen';
import { OfflineBannerScreen } from '../../src/screens/OfflineBannerScreen';
import { ToastHostScreen } from '../../src/screens/ToastHostScreen';

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

describe('support family final polish', () => {
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

  it('keeps help/about framed as calm support and product identity surfaces', async () => {
    let faqTree!: renderer.ReactTestRenderer;
    await act(async () => {
      faqTree = renderer.create(<HelpFAQScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'faq', name: 'HelpFAQ' } as any} />);
    });
    const faqBlob = textBlob(faqTree);
    expect(faqBlob).not.toContain('support companion');

    let aboutTree!: renderer.ReactTestRenderer;
    await act(async () => {
      aboutTree = renderer.create(<AboutScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'about', name: 'About' } as any} />);
    });
    const aboutBlob = textBlob(aboutTree);
    expect(aboutBlob).toContain('lightweight product identity page');
    expect(aboutBlob).toContain('DeveloperCards mobile v6 candidate build');
  });

  it('keeps error/offline/toast surfaces aligned around short recovery loops', async () => {
    let genericTree!: renderer.ReactTestRenderer;
    await act(async () => {
      genericTree = renderer.create(<ErrorGenericScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'generic', name: 'ErrorGeneric' } as any} />);
    });
    const genericBlob = textBlob(genericTree);
    expect(genericBlob).toContain('If this keeps happening');

    let networkTree!: renderer.ReactTestRenderer;
    await act(async () => {
      networkTree = renderer.create(<ErrorNetworkScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'network', name: 'ErrorNetwork' } as any} />);
    });
    const networkBlob = textBlob(networkTree);
    expect(networkBlob).toContain('Connection lost, but your route is still safe');

    let offlineTree!: renderer.ReactTestRenderer;
    await act(async () => {
      offlineTree = renderer.create(<OfflineBannerScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'offline', name: 'OfflineBanner' } as any} />);
    });
    const offlineBlob = textBlob(offlineTree);
    expect(offlineBlob).toContain('When to escalate');

    let toastTree!: renderer.ReactTestRenderer;
    await act(async () => {
      toastTree = renderer.create(<ToastHostScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'toast', name: 'ToastHost' } as any} />);
    });
    const toastBlob = textBlob(toastTree);
    expect(toastBlob).toContain('Debug menu');
  });
});
