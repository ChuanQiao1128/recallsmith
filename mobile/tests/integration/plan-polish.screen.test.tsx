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

describe('plan polish screens', () => {
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

  it('keeps week planner framed as a pacing decision, not a dashboard summary', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WeekPlannerPromptScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'week-prompt', name: 'WeekPlannerPrompt' } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Set this week’s study pace');
    expect(blob).toContain('Current goal');
    expect(blob).toContain('suggested');
    expect(blob).not.toContain('another heavy dashboard');
  });

  it('keeps month rewind framed as a retrospective instead of system-layer language', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<MonthRewindScreen navigation={{ navigate: vi.fn() } as any} route={{ key: 'month-rewind', name: 'MonthRewind' } as any} />);
    });
    const blob = textBlob(tree);
    expect(blob).toContain('Monthly high points');
    expect(blob).toContain('calm retrospective');
    expect(blob).not.toContain('B-system retrospective layer');
  });
});
