import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const recordFunnelEventMock = vi.fn();
vi.mock('../../src/telemetry/funnel', () => ({
  recordFunnelEvent: (...args: unknown[]) => recordFunnelEventMock(...args),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SplashScreen } from '../../src/screens/SplashScreen';
import { WelcomeScreen } from '../../src/screens/WelcomeScreen';
import { AudienceSurveyScreen } from '../../src/screens/AudienceSurveyScreen';

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0);
}

describe('phase A onboarding screens', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.clear();
    recordFunnelEventMock.mockClear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('routes splash to welcome for a new user', async () => {
    const replace = vi.fn();
    await act(async () => {
      renderer.create(<SplashScreen navigation={{ replace } as any} route={{ key: 'splash', name: 'Splash' } as any} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(replace).toHaveBeenCalledWith('Welcome');
  });

  async function renderWelcomeThenGoal(replace: ReturnType<typeof vi.fn>) {
    let welcomeTree!: renderer.ReactTestRenderer;
    await act(async () => {
      welcomeTree = renderer.create(<WelcomeScreen navigation={{ replace } as any} route={{ key: 'welcome', name: 'Welcome' } as any} />);
    });

    // Welcome v3 is a single page: one tap on the primary CTA completes the
    // welcome stage and replaces into the goal step (route 'AudienceSurvey').
    await act(async () => {
      findPressableByText(welcomeTree, 'Continue').props.onPress();
      await Promise.resolve();
    });
    expect(replace).toHaveBeenCalledWith('AudienceSurvey');

    let goalTree!: renderer.ReactTestRenderer;
    await act(async () => {
      goalTree = renderer.create(<AudienceSurveyScreen navigation={{ replace } as any} route={{ key: 'audience', name: 'AudienceSurvey' } as any} />);
    });
    return goalTree;
  }

  async function press(tree: renderer.ReactTestRenderer, label: string) {
    await act(async () => {
      findPressableByText(tree, label).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function textBlob(tree: renderer.ReactTestRenderer): string {
    return tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => {
        const c = node.props.children;
        return Array.isArray(c) ? c.join('') : String(c ?? '');
      })
      .join('\n');
  }

  function goal(): { deckSlug: string; examDate: string | null } {
    return JSON.parse(store.get('recallsmith:study-goal:v1') ?? 'null');
  }

  it('asks what the learner wants to learn, not a content lane', async () => {
    const tree = await renderWelcomeThenGoal(vi.fn());
    const blob = textBlob(tree);
    expect(blob).toContain('What do you want to learn?');
    expect(blob).not.toContain('Which lane should new content favor?');
    expect(blob).not.toContain('Stretch');

    // AWS first and pre-selected (highlighted).
    const radios = tree.root.findAll((node) => (node.type as any) === 'Pressable' && node.props.accessibilityRole === 'radio');
    expect(radios.map((r) => r.props.testID)).toEqual(['goal-choice-aws-saa-c03', 'goal-choice-claude-ccdv-f', 'goal-choice-csharp-basics']);
    expect(radios[0].props.accessibilityState.selected).toBe(true);
  });

  it("finishes with 'just learning' by default: no exam date, deck saved and active", async () => {
    const replace = vi.fn();
    const tree = await renderWelcomeThenGoal(replace);

    await press(tree, 'Continue');
    const blob = textBlob(tree);
    expect(blob).toContain("No date — I'm just learning");
    const noDate = tree.root.find((node) => (node.type as any) === 'Pressable' && node.props.testID === 'exam-date-none');
    expect(noDate.props.accessibilityState.selected).toBe(true);

    await press(tree, 'Finish setup');

    expect(goal()).toEqual({ deckSlug: 'aws-saa-c03', examDate: null });
    expect(store.get('active-deck-slug')).toBe('aws-saa-c03');
    // Onboarding no longer asks the lane: nothing written, Settings default stays Balanced.
    expect(store.get('recallsmith:audience-preference:v1')).toBeUndefined();
    // R22 §4: the goal step opens the starter lesson; the first pack and the reminder prompt wait
    // for the lesson to complete, so the prompt is not armed here and Home gets no first-draw coach.
    expect(store.get('recallsmith:onboarding:stage:v1')).toBe('starter');
    expect(replace).toHaveBeenCalledWith('Home');
    expect(replace).not.toHaveBeenCalledWith('Home', { firstDrawCoach: true });
    expect(store.get('notifications:permission-prompt:pending:v1')).toBeUndefined();
  });

  it('tells the learner when Finish setup could not save, and lets them retry', async () => {
    const replace = vi.fn();
    const tree = await renderWelcomeThenGoal(replace);
    replace.mockClear();
    await press(tree, 'Continue');

    // The stage write fails once (storage trouble): no navigation, a short retry message, and the
    // button is usable again. The rejection is handled (an unhandled one fails this run).
    vi.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key: string, value: string) => {
      store.set(key, value);
    });
    vi.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key: string, value: string) => {
      store.set(key, value);
    });
    vi.mocked(AsyncStorage.setItem).mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    await press(tree, 'Finish setup');

    expect(replace).not.toHaveBeenCalled();
    expect(recordFunnelEventMock).not.toHaveBeenCalled();
    expect(store.get('recallsmith:onboarding:stage:v1')).toBe('audience');
    const error = tree.root.findAll((node) => (node.type as any) === 'Text' && node.props.testID === 'goal-finish-error');
    expect(error).toHaveLength(1);
    expect(String(error[0].props.children)).toBe("Couldn't save your choice. Please try again.");
    expect(findPressableByText(tree, 'Finish setup').props.disabled).toBe(false);

    // Retry with storage working: saved, stage 'starter', Home opens and the message is gone.
    await press(tree, 'Finish setup');
    expect(store.get('recallsmith:onboarding:stage:v1')).toBe('starter');
    expect(replace).toHaveBeenCalledWith('Home');
    expect(recordFunnelEventMock).toHaveBeenCalledTimes(1);
    expect(recordFunnelEventMock).toHaveBeenCalledWith('goal_chosen', 'aws-saa-c03');
    expect(tree.root.findAll((node) => (node.type as any) === 'Text' && node.props.testID === 'goal-finish-error')).toHaveLength(0);
  });

  it('routes splash to Home for a learner in the starter lesson, and an existing user too', async () => {
    for (const stage of ['starter', 'done']) {
      store.set('recallsmith:onboarding:stage:v1', stage);
      const replace = vi.fn();
      await act(async () => {
        renderer.create(<SplashScreen navigation={{ replace } as any} route={{ key: 'splash', name: 'Splash' } as any} />);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(replace).toHaveBeenCalledWith('Home');
    }
  });

  it('saves the chosen deck and a preset exam date, adjusted by the week steppers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 15, 0, 0));
    try {
      const replace = vi.fn();
      const tree = await renderWelcomeThenGoal(replace);

      await press(tree, '.NET interview questions');
      await press(tree, 'Continue');
      await press(tree, 'In 1 month');
      expect(textBlob(tree)).toContain('Mon, Nov 2, 2026');

      await press(tree, '+1 week');
      await press(tree, '+1 week');
      await press(tree, '−1 week');
      expect(textBlob(tree)).toContain('Mon, Nov 9, 2026');

      await press(tree, 'Finish setup');

      expect(goal()).toEqual({ deckSlug: 'csharp-basics', examDate: '2026-11-09' });
      // R24 M01: finishing the goal step is the anonymous funnel's goal_chosen, with the deck only.
      expect(recordFunnelEventMock).toHaveBeenCalledTimes(1);
      expect(recordFunnelEventMock).toHaveBeenCalledWith('goal_chosen', 'csharp-basics');
      expect(store.get('active-deck-slug')).toBe('csharp-basics');
      expect(store.get('recallsmith:onboarding:stage:v1')).toBe('starter');
      expect(replace).toHaveBeenCalledWith('Home');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a learner pick a date and then go back to no date', async () => {
    const tree = await renderWelcomeThenGoal(vi.fn());
    await press(tree, 'Claude Developer (CCDV-F)');
    await press(tree, 'Continue');
    await press(tree, 'In 2 weeks');
    await press(tree, "No date — I'm just learning");
    await press(tree, 'Finish setup');
    expect(goal()).toEqual({ deckSlug: 'claude-ccdv-f', examDate: null });
    expect(store.get('active-deck-slug')).toBe('claude-ccdv-f');
  });

  it('goes back from the date step to the goal choices', async () => {
    const tree = await renderWelcomeThenGoal(vi.fn());
    await press(tree, 'Continue');
    await press(tree, 'Back');
    expect(textBlob(tree)).toContain('What do you want to learn?');
  });
});
