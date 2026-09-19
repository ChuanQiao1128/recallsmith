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

import { MoreScreen } from '../../src/screens/MoreScreen';
import { ProfileScreen } from '../../src/screens/ProfileScreen';
import { AchievementsScreen } from '../../src/screens/AchievementsScreen';
import { HelpFAQScreen } from '../../src/screens/HelpFAQScreen';
import { SettingsMainScreen } from '../../src/screens/SettingsMainScreen';
import { SettingsAudienceScreen } from '../../src/screens/SettingsAudienceScreen';
import { SettingsNotificationsScreen } from '../../src/screens/SettingsNotificationsScreen';
import { SettingsPoolsScreen } from '../../src/screens/SettingsPoolsScreen';
import { SettingsAppearanceScreen } from '../../src/screens/SettingsAppearanceScreen';

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

describe('me final flow', () => {
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

  it('uses profile-and-support product language on the me landing flow', async () => {
    const navigate = vi.fn();
    let moreTree!: renderer.ReactTestRenderer;
    await act(async () => {
      moreTree = renderer.create(<MoreScreen navigation={{ navigate } as any} route={{ key: 'more', name: 'More' } as any} />);
    });

    const moreBlob = textBlob(moreTree);
    expect(moreBlob).toContain('Your profile and support');
    expect(moreBlob).toContain('Profile');
    expect(moreBlob).toContain('Settings');
    expect(moreBlob).toContain('Help');
    expect(moreBlob).not.toContain('Developer tools');
    expect(moreBlob).not.toContain('Profile, settings, support, and QA');
    expect(moreBlob).not.toContain('Phase C');
    expect(moreBlob).not.toContain('QA lane');

    act(() => {
      findPressableByText(moreTree, 'Help').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('HelpFAQ');

    let profileTree!: renderer.ReactTestRenderer;
    await act(async () => {
      profileTree = renderer.create(<ProfileScreen navigation={{ navigate } as any} route={{ key: 'profile', name: 'Profile' } as any} />);
    });
    const profileBlob = textBlob(profileTree);
    expect(profileBlob).toContain('Your study profile');
    expect(profileBlob).toContain('Current setup');
    expect(profileBlob).not.toContain('Learner #local');
    expect(profileBlob).toContain('Momentum this week');
    expect(profileBlob).not.toContain('Next best return point');
    expect(profileBlob).not.toContain('premium learner card');

    let achievementsTree!: renderer.ReactTestRenderer;
    await act(async () => {
      achievementsTree = renderer.create(<AchievementsScreen navigation={{ navigate } as any} route={{ key: 'achievements', name: 'Achievements' } as any} />);
    });
    const achievementsBlob = textBlob(achievementsTree);
    expect(achievementsBlob).toContain('Wins and milestones');
    expect(achievementsBlob).toContain('Unlocked milestones');
    expect(achievementsBlob).not.toContain('feels more ceremonial');

    let faqTree!: renderer.ReactTestRenderer;
    await act(async () => {
      faqTree = renderer.create(<HelpFAQScreen navigation={{ navigate } as any} route={{ key: 'faq', name: 'HelpFAQ' } as any} />);
    });
    const faqBlob = textBlob(faqTree);
    expect(faqBlob).toContain('Help and answers');
    expect(faqBlob).toContain('Top questions');
    expect(faqBlob).not.toContain('cosmic support treatment');
  });

  it('keeps settings pages productized and clearly partitioned', async () => {
    const navigate = vi.fn();

    let settingsMainTree!: renderer.ReactTestRenderer;
    await act(async () => {
      settingsMainTree = renderer.create(<SettingsMainScreen navigation={{ navigate } as any} route={{ key: 'settings-main', name: 'SettingsMain' } as any} />);
    });
    const mainBlob = textBlob(settingsMainTree);
    expect(mainBlob).toContain('Preferences and account');
    expect(mainBlob).toContain('Content preferences');
    expect(mainBlob).toContain('Notifications & reminders');
    expect(mainBlob).toContain('Pools and availability');
    expect(mainBlob).toContain('Theme and reading density');
    expect(mainBlob).toContain('Daily rhythm');
    expect(mainBlob).toContain('Study rules');
    expect(mainBlob).not.toContain('print hierarchy');

    let audienceTree!: renderer.ReactTestRenderer;
    await act(async () => {
      audienceTree = renderer.create(<SettingsAudienceScreen navigation={{ navigate } as any} route={{ key: 'settings-audience', name: 'SettingsAudience' } as any} />);
    });
    const audienceBlob = textBlob(audienceTree);
    expect(audienceBlob).toContain('Content preference');
    expect(audienceBlob).toContain('Due review stays the same');
    expect(audienceBlob).toContain('Recommendation surfaces');
    expect(audienceBlob).not.toContain('dedicated page');

    let notificationsTree!: renderer.ReactTestRenderer;
    await act(async () => {
      notificationsTree = renderer.create(<SettingsNotificationsScreen navigation={{ navigate } as any} route={{ key: 'settings-notifications', name: 'SettingsNotifications' } as any} />);
    });
    const notificationsBlob = textBlob(notificationsTree);
    expect(notificationsBlob).toContain('Reminders and quiet hours');
    expect(notificationsBlob).toContain('Reminder plan');
    expect(notificationsBlob).toContain('Morning nudge');
    expect(notificationsBlob).toContain('Evening rescue');
    expect(notificationsBlob).not.toContain('real page');

    let poolsTree!: renderer.ReactTestRenderer;
    await act(async () => {
      poolsTree = renderer.create(<SettingsPoolsScreen navigation={{ navigate } as any} route={{ key: 'settings-pools', name: 'SettingsPools' } as any} />);
    });
    const poolsBlob = textBlob(poolsTree);
    expect(poolsBlob).toContain('Pools and availability');
    expect(poolsBlob).toContain('Currently active');
    expect(poolsBlob).not.toContain('concrete page');

    let appearanceTree!: renderer.ReactTestRenderer;
    await act(async () => {
      appearanceTree = renderer.create(<SettingsAppearanceScreen navigation={{ navigate } as any} route={{ key: 'settings-appearance', name: 'SettingsAppearance' } as any} />);
    });
    const appearanceBlob = textBlob(appearanceTree);
    expect(appearanceBlob).toContain('Theme and reading density');
    expect(appearanceBlob).toContain('Motion and ceremony');
    expect(appearanceBlob).not.toContain('real design tokens');
  });

  it('preserves the me-route navigation chain across the key actions', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<SettingsMainScreen navigation={{ navigate } as any} route={{ key: 'settings-main', name: 'SettingsMain' } as any} />);
    });

    act(() => {
      findPressableByText(tree, 'Notifications & reminders').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('SettingsNotifications');

    act(() => {
      findPressableByText(tree, 'Content preferences').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('SettingsAudience');

    act(() => {
      findPressableByText(tree, 'Pools and availability').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('SettingsPools');

    act(() => {
      findPressableByText(tree, 'Theme and reading density').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('SettingsAppearance');
  });
});
