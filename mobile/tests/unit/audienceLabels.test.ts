import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// react-native is mocked per file (its Flow-typed entry point cannot be
// parsed by the bundler). AudienceSurveyScreen + ProfileScreen reach for a
// few more primitives than settings-copy.spec.ts, so ScrollView /
// ActivityIndicator are added here.
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

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => ({
    currentDailyStreak: 0,
    longestDailyStreak: 0,
    weekCompletedDays: 0,
    totalQualifiedSessions: 0,
    lastQualifiedDateKey: null,
    currentWeekKey: null,
  })),
}));

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: vi.fn(async () => 'all'),
  setAudiencePreference: vi.fn(async (next: any) => next),
}));

import { AUDIENCE_SURVEY_OPTIONS } from '../../src/screens/AudienceSurveyScreen';
import { CONTENT_COPY } from '../../src/features/gacha/settings/content/ContentSection';
import { AUDIENCE_LABELS, getAudiencePreferenceLabel } from '../../src/features/gacha/audience/audienceRules';
import { ProfileScreen } from '../../src/screens/ProfileScreen';

const KEYS = ['junior', 'both', 'all'] as const;

describe('one audience vocabulary', () => {
  beforeEach(() => {
    store.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('uses one label for each audience preference everywhere', () => {
    for (const key of KEYS) {
      const expected = AUDIENCE_LABELS[key];
      const surveyOption = AUDIENCE_SURVEY_OPTIONS.find((o) => o.key === key);
      const chip = CONTENT_COPY.chips.find((c) => c.key === key);
      expect(surveyOption?.label).toBe(expected);
      expect(chip?.label).toBe(expected);
      expect(getAudiencePreferenceLabel(key)).toBe(expected);
    }
  });

  it('shows the audience label, not the raw key, on Profile', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        React.createElement(ProfileScreen as any, {
          navigation: { navigate: vi.fn() } as any,
          route: { key: 'profile', name: 'Profile' } as any,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const texts = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => {
        const c = node.props.children;
        return Array.isArray(c) ? c.join('') : String(c ?? '');
      });

    expect(texts).toContain('Stretch');
    expect(texts).not.toContain('all');
  });
});
