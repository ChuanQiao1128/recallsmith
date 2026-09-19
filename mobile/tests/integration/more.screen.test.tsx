import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Me tab used to render design-spec prose ("Treat this tab as your
 * support rail"), a "Support areas: 3" stat and a "Developer tools" section
 * to every user, while Help shipped a 3-entry mock and Profile showed
 * "Learner #local". These tests pin the real replacement: streak +
 * collection numbers from the trackers, five real rows, byline + version,
 * and the 8 user-language FAQs.
 */

let streakSnapshotFixture = {
  currentDailyStreak: 0,
  longestDailyStreak: 0,
  weekCompletedDays: 0,
  totalQualifiedSessions: 0,
  lastQualifiedDateKey: null as string | null,
  currentWeekKey: null as string | null,
};
let drawStateFixture: Record<string, string[]> = {
  csharp: ['c-001', 'c-002', 'c-003'],
  'aws-saa-c03': ['a-001', 'a-002'],
};
let audienceFixture: 'junior' | 'both' | 'all' = 'both';
const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn(async () => undefined) }));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
    Linking: { openURL: openUrlMock },
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

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => streakSnapshotFixture),
}));

vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  listDrawStateSlugs: vi.fn(async () => Object.keys(drawStateFixture)),
  loadDrawState: vi.fn(async (slug: string) => ({ owned: drawStateFixture[slug] ?? [], pity: null })),
}));

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: vi.fn(async () => audienceFixture),
}));

import appJson from '../../app.json';
import { MoreScreen, MORE_LINKS, MORE_BYLINE } from '../../src/screens/MoreScreen';
import { ProfileScreen } from '../../src/screens/ProfileScreen';
import { HelpFAQScreen } from '../../src/screens/HelpFAQScreen';
import { FAQ_LIST } from '../../src/content/faq';

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

function exactTexts(tree: renderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const c = node.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderMore(navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <MoreScreen navigation={{ navigate } as any} route={{ key: 'more', name: 'More' } as any} />,
    );
  });
  await flush();
  return tree;
}

async function renderProfile(navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <ProfileScreen navigation={{ navigate } as any} route={{ key: 'profile', name: 'Profile' } as any} />,
    );
  });
  await flush();
  return tree;
}

async function renderHelp(navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <HelpFAQScreen navigation={{ navigate } as any} route={{ key: 'faq', name: 'HelpFAQ' } as any} />,
    );
  });
  await flush();
  return tree;
}

describe('Me tab · MoreScreen + Profile + Help real copy', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    streakSnapshotFixture = {
      currentDailyStreak: 7,
      longestDailyStreak: 9,
      weekCompletedDays: 3,
      totalQualifiedSessions: 21,
      lastQualifiedDateKey: '2026-08-19',
      currentWeekKey: '2026-W34',
    };
    drawStateFixture = {
      csharp: ['c-001', 'c-002', 'c-003'],
      'aws-saa-c03': ['a-001', 'a-002'],
    };
    audienceFixture = 'both';
    openUrlMock.mockClear();
  });

  it('renders the day streak and collection count the trackers actually hold', async () => {
    const tree = await renderMore();
    const texts = exactTexts(tree);
    expect(texts).toContain('7');
    expect(texts).toContain('5');
    const blob = textBlob(tree);
    expect(blob).toContain('Day streak');
    expect(blob).toContain('Cards collected');
  });

  it('reports a fresh install as zero, never a dash left behind', async () => {
    streakSnapshotFixture = {
      currentDailyStreak: 0,
      longestDailyStreak: 0,
      weekCompletedDays: 0,
      totalQualifiedSessions: 0,
      lastQualifiedDateKey: null,
      currentWeekKey: null,
    };
    drawStateFixture = {};
    const tree = await renderMore();
    expect(exactTexts(tree)).toContain('0');
    expect(textBlob(tree)).not.toContain('—');
  });

  it('rows navigate to the real screens', async () => {
    const navigate = vi.fn();
    const tree = await renderMore(navigate);
    act(() => {
      tree.root.findByProps({ testID: 'more-row-profile' }).props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Profile');
    act(() => {
      tree.root.findByProps({ testID: 'more-row-settings' }).props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Settings');
    expect(navigate).not.toHaveBeenCalledWith('SettingsMain');
    act(() => {
      tree.root.findByProps({ testID: 'more-row-help' }).props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('HelpFAQ');
  });

  it('privacy and support rows open the policy pages', async () => {
    const tree = await renderMore();
    act(() => {
      tree.root.findByProps({ testID: 'more-row-privacy' }).props.onPress();
    });
    expect(openUrlMock).toHaveBeenCalledWith(MORE_LINKS.privacy);
    act(() => {
      tree.root.findByProps({ testID: 'more-row-support' }).props.onPress();
    });
    expect(openUrlMock).toHaveBeenCalledWith(MORE_LINKS.support);
    expect(MORE_LINKS.privacy).toMatch(/^https:\/\//);
    expect(MORE_LINKS.support).toMatch(/^https:\/\//);
  });

  it('shows the byline and the version from app.json', async () => {
    const tree = await renderMore();
    const blob = textBlob(tree);
    expect(blob).toContain(MORE_BYLINE);
    expect(blob).toContain('Made by one developer in Auckland');
    expect(blob).toContain(`Version ${appJson.expo.version}`);
  });

  it('has no design-spec or dev leftovers on More', async () => {
    const tree = await renderMore();
    const blob = textBlob(tree);
    for (const leftover of [
      'support rail',
      'Developer tools',
      'Debug menu',
      'Dev tools',
      'Support areas',
      'QA shortcuts',
      'QA lane',
      'What you can manage',
    ]) {
      expect(blob).not.toContain(leftover);
    }
    for (const label of ['Profile', 'Settings', 'Help']) {
      const matches = tree.root.findAll(
        (node) =>
          (node.type as any) === 'Pressable' &&
          node.findAll(
            (child) => (child.type as any) === 'Text' && child.props.children === label,
          ).length > 0,
      );
      expect(matches).toHaveLength(1);
    }
  });

  it('Profile keeps its real data and drops the placeholders', async () => {
    const navigate = vi.fn();
    const tree = await renderProfile(navigate);
    const blob = textBlob(tree);
    for (const leftover of [
      'Learner #local',
      'Study identity',
      'Next best return point',
      'dead-end',
      'account linking',
    ]) {
      expect(blob).not.toContain(leftover);
    }
    expect(blob).toContain('Current setup');
    expect(blob).toContain('Momentum this week');
    const editRow = tree.root.find(
      (node) =>
        (node.type as any) === 'Pressable' &&
        node.findAll((child) => (child.type as any) === 'Text' && child.props.children === 'Edit profile')
          .length > 0,
    );
    act(() => {
      editRow.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('EditProfile');
  });

  it('Help renders the real user-language FAQ', async () => {
    const tree = await renderHelp();
    const blob = textBlob(tree);
    expect(FAQ_LIST.length).toBeGreaterThanOrEqual(6);
    expect(FAQ_LIST.length).toBeLessThanOrEqual(8);
    for (const entry of FAQ_LIST) {
      expect(blob).toContain(entry.q);
    }
    expect(blob).toContain('AI assistance');
    expect(blob).toContain('iOS only');
    expect(blob).toContain('Why is Draw locked?');
    expect(blob).not.toContain('support companion');
    expect(blob).not.toContain('route pressure');
    expect(blob).not.toContain('Fresh Start');
  });
});
