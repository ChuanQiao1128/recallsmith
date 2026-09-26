import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Me tab shipped to the App Store rendering src/mock/user.ts to every
 * real user: a permanent streak of 4, a week streak of 2, and entry points
 * into three more screens whose contents are hardcoded too.
 *
 * These tests are about the boundary: what the Me chain is allowed to claim
 * about a user, and which mock-backed screens it is allowed to advertise.
 */

let streakSnapshotFixture = {
  currentDailyStreak: 0,
  longestDailyStreak: 0,
  weekCompletedDays: 0,
  totalQualifiedSessions: 0,
  lastQualifiedDateKey: null as string | null,
  currentWeekKey: null as string | null,
};
let audienceFixture: 'junior' | 'both' | 'all' = 'both';

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

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: vi.fn(async () => audienceFixture),
}));

import { MoreScreen } from '../../src/screens/MoreScreen';
import { ProfileScreen } from '../../src/screens/ProfileScreen';

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

async function renderProfile(navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <ProfileScreen navigation={{ navigate } as any} route={{ key: 'profile', name: 'Profile' } as any} />,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
}

async function renderMore(navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <MoreScreen navigation={{ navigate } as any} route={{ key: 'more', name: 'More' } as any} />,
    );
  });
  return tree;
}

describe('Me tab · real data', () => {
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
    audienceFixture = 'junior';
  });

  it('renders the streak the tracker actually holds', async () => {
    const tree = await renderProfile();

    // Exact text nodes. A blob substring check passes for free here --
    // "3 of 7 days completed this week" contains both digits no matter what
    // the headline stats say.
    const texts = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => {
        const c = node.props.children;
        return Array.isArray(c) ? c.join('') : String(c ?? '');
      });

    expect(texts).toContain('7');
    expect(texts).toContain('3');
    // src/mock/user.ts's constants, which every shipped build showed.
    expect(texts).not.toContain('4');
    expect(texts).not.toContain('2');
    expect(textBlob(tree)).toContain('21 sessions have counted toward a streak');
  });

  it('reports a brand-new user as zero rather than as somebody else', async () => {
    streakSnapshotFixture = {
      currentDailyStreak: 0,
      longestDailyStreak: 0,
      weekCompletedDays: 0,
      totalQualifiedSessions: 0,
      lastQualifiedDateKey: null,
      currentWeekKey: null,
    };

    const tree = await renderProfile();
    const stats = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => {
        const c = node.props.children;
        return Array.isArray(c) ? c.join('') : String(c ?? '');
      });

    // The mock's 4 and 2 are exactly what a fresh install used to show.
    expect(stats).not.toContain('4');
    expect(stats).not.toContain('2');
    expect(stats).toContain('0');
  });

  it('shows the stored audience preference, not the mock default', async () => {
    audienceFixture = 'all';
    const tree = await renderProfile();
    // Profile shows the one shared audience label, not the raw storage key:
    // 'all' → "Stretch". The mock default 'both' would render "Balanced".
    const texts = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => {
        const c = node.props.children;
        return Array.isArray(c) ? c.join('') : String(c ?? '');
      });
    expect(texts).toContain('Stretch');
    expect(texts).not.toContain('Balanced');
  });

  it('no longer advertises the hardcoded Achievements and Milestone hall screens', async () => {
    const navigate = vi.fn();
    const tree = await renderProfile(navigate);
    const blob = textBlob(tree);

    expect(blob).not.toContain('Achievements');
    expect(blob).not.toContain('Milestone hall');

    const pressables = tree.root.findAll((node) => (node.type as any) === 'Pressable');
    for (const pressable of pressables) {
      act(() => {
        pressable.props.onPress?.();
      });
    }
    expect(navigate).not.toHaveBeenCalledWith('Achievements');
    expect(navigate).not.toHaveBeenCalledWith('MilestoneHall');
  });

  it('drops the Achievements row and the dev-tools stat from the More menu', async () => {
    const tree = await renderMore();
    const blob = textBlob(tree);

    expect(blob).toContain('Profile');
    expect(blob).toContain('Help');
    expect(blob).not.toContain('Achievements');
    // "Dev tools 1" was rendered as a headline statistic to end users.
    expect(blob).not.toContain('Dev tools');
  });

  it('sends the More menu at the settings screen that can actually change settings', async () => {
    const navigate = vi.fn();
    const tree = await renderMore(navigate);

    const settingsPressable = tree.root.find(
      (node) =>
        (node.type as any) === 'Pressable' &&
        node.findAll((child) => (child.type as any) === 'Text' && child.props.children === 'Settings')
          .length > 0,
    );
    act(() => {
      settingsPressable.props.onPress();
    });

    // SettingsMain renders src/mock/settings.ts: a snapshot that neither
    // reflects nor changes anything. 'Settings' is the tree the Home gear
    // opens, and the only one wired to real preferences.
    expect(navigate).toHaveBeenCalledWith('Settings');
    expect(navigate).not.toHaveBeenCalledWith('SettingsMain');
  });
});
