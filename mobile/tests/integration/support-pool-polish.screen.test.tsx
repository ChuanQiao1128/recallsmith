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

import { PoolOverviewScreen } from '../../src/screens/PoolOverviewScreen';
import { MoreScreen } from '../../src/screens/MoreScreen';
import { SettingsMainScreen } from '../../src/screens/SettingsMainScreen';

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

describe('support and pool polish screens', () => {
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

  it('keeps pool overview tied back into the library loop', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PoolOverviewScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'pool', name: 'PoolOverview', params: { poolId: 'csharp' } } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Best next move');
    expect(blob).toContain('Back to library');
  });

  it('keeps me/settings framed as support rails, not second home surfaces', async () => {
    let moreTree!: renderer.ReactTestRenderer;
    await act(async () => {
      moreTree = renderer.create(<MoreScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'more', name: 'More' } as any} />);
    });
    const moreBlob = textBlob(moreTree);
    expect(moreBlob).toContain('support rail');

    let settingsTree!: renderer.ReactTestRenderer;
    await act(async () => {
      settingsTree = renderer.create(<SettingsMainScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'settings', name: 'SettingsMain' } as any} />);
    });
    const settingsBlob = textBlob(settingsTree);
    expect(settingsBlob).toContain('support the learner quietly in the background');
  });
});
