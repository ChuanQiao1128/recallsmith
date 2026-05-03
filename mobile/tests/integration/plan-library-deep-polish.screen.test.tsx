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

import { WeekPlannerPromptScreen } from '../../src/screens/WeekPlannerPromptScreen';
import { MonthRewindScreen } from '../../src/screens/MonthRewindScreen';
import { AudienceFilterScreen } from '../../src/screens/AudienceFilterScreen';
import { TagExplorerScreen } from '../../src/screens/TagExplorerScreen';
import { CardDetailScreen } from '../../src/screens/CardDetailScreen';

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

describe('plan and library polish screens', () => {
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

  it('keeps week planner and month rewind framed as planning support, not internal system language', async () => {
    let weekTree!: renderer.ReactTestRenderer;
    await act(async () => {
      weekTree = renderer.create(<WeekPlannerPromptScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'week', name: 'WeekPlannerPrompt' } as any} />);
    });
    const weekBlob = textBlob(weekTree);
    expect(weekBlob).toContain('Set this week’s study pace');
    expect(weekBlob).toContain('Current goal');
    expect(weekBlob).toContain('Back to week plan');

    let monthTree!: renderer.ReactTestRenderer;
    await act(async () => {
      monthTree = renderer.create(<MonthRewindScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'month', name: 'MonthRewind' } as any} />);
    });
    const monthBlob = textBlob(monthTree);
    expect(monthBlob).toContain('Monthly high points');
    expect(monthBlob).toContain('calm retrospective');
    expect(monthBlob).toContain('Back to plan');
    expect(monthBlob).not.toContain('B-system retrospective layer');
  });

  it('keeps deep library pages feeling like a connected browsing chain', async () => {
    let audienceTree!: renderer.ReactTestRenderer;
    await act(async () => {
      audienceTree = renderer.create(<AudienceFilterScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'audience', name: 'AudienceFilter' } as any} />);
    });
    const audienceBlob = textBlob(audienceTree);
    expect(audienceBlob).toContain('Back to tag coverage');
    expect(audienceBlob).toContain('owned cards feel most relevant');

    let tagTree!: renderer.ReactTestRenderer;
    await act(async () => {
      tagTree = renderer.create(<TagExplorerScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'tag', name: 'TagExplorer', params: { poolId: 'csharp' } } as any} />);
    });
    const tagBlob = textBlob(tagTree);
    expect(tagBlob).toContain('Back to pool progress');
    expect(tagBlob).toContain('representative card');

    let detailTree!: renderer.ReactTestRenderer;
    await act(async () => {
      detailTree = renderer.create(<CardDetailScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'detail', name: 'CardDetail', params: { cardId: 'card-1' } } as any} />);
    });
    const detailBlob = textBlob(detailTree);
    expect(detailBlob).toContain('Why this card matters');
    expect(detailBlob).toContain('Back to tag coverage');
  });
});
