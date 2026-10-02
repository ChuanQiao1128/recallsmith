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

let activeDeckFixture: string | null = 'aws-saa-c03';
vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => activeDeckFixture),
}));

// Decks whose content is on the device (F01: the domain row only opens an installed deck).
let installedDecksFixture: string[] = ['aws-saa-c03', 'csharp'];
vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async (slug: string) => (installedDecksFixture.includes(slug) ? { Slug: slug } : null)),
}));
vi.mock('../../src/content/starterOffline', () => ({
  listInstalledDeckEntries: vi.fn(async () => [...installedDecksFixture].sort().map((slug) => ({ slug }))),
}));

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: vi.fn(async () => audienceFixture),
}));

import appJson from '../../app.json';
import { MoreScreen, MORE_LINKS, MORE_BYLINE } from '../../src/screens/MoreScreen';
import { ProfileScreen } from '../../src/screens/ProfileScreen';
import { HelpFAQScreen } from '../../src/screens/HelpFAQScreen';
import { FAQ_DISCLAIMER, FAQ_LIST } from '../../src/content/faq';

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
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
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
    activeDeckFixture = 'aws-saa-c03';
    installedDecksFixture = ['aws-saa-c03', 'csharp'];
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

  it('the Progress by domain row opens the active deck', async () => {
    const navigate = vi.fn();
    const tree = await renderMore(navigate);
    const row = tree.root.findByProps({ testID: 'more-row-domains' });
    expect(exactTexts(tree)).toContain('Progress by domain');
    await act(async () => {
      row.props.onPress();
    });
    await flush();
    expect(navigate).toHaveBeenCalledWith('DomainProgress', { slug: 'aws-saa-c03' });
  });

  it('the Progress by domain row skips an active deck that is not installed for the first installed deck', async () => {
    const navigate = vi.fn();
    activeDeckFixture = 'gone-deck';
    installedDecksFixture = ['csharp', 'claude-ccdv-f'];
    const tree = await renderMore(navigate);
    await act(async () => {
      tree.root.findByProps({ testID: 'more-row-domains' }).props.onPress();
    });
    await flush();
    expect(navigate).toHaveBeenCalledWith('DomainProgress', { slug: 'claude-ccdv-f' });
    expect(navigate).not.toHaveBeenCalledWith('DomainProgress', { slug: 'gone-deck' });
  });

  it('the Progress by domain row uses the first installed deck when no active deck is stored', async () => {
    const navigate = vi.fn();
    activeDeckFixture = null;
    const tree = await renderMore(navigate);
    await act(async () => {
      tree.root.findByProps({ testID: 'more-row-domains' }).props.onPress();
    });
    await flush();
    expect(navigate).toHaveBeenCalledWith('DomainProgress', { slug: 'aws-saa-c03' });
  });

  it('hides the Progress by domain row when no deck is installed', async () => {
    activeDeckFixture = 'aws-saa-c03';
    installedDecksFixture = [];
    const tree = await renderMore();
    expect(tree.root.findAll((node) => node.props?.testID === 'more-row-domains')).toHaveLength(0);
    expect(exactTexts(tree)).not.toContain('Progress by domain');
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
    // R24B §1: the Help row names its topics in plain words.
    expect(blob).toContain('Draws, rare cards, offline, devices');
    expect(blob).not.toMatch(/Pulls|pity|Android/);
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
    expect(blob).toContain('Progress this week');
    expect(blob).not.toContain('Momentum');
    const editRow = tree.root.find(
      (node) =>
        (node.type as any) === 'Pressable' &&
        node.findAll((child) => (child.type as any) === 'Text' && child.props.children === 'Study settings')
          .length > 0,
    );
    act(() => {
      editRow.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Settings');
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
    // R24B §4: every answer states what the app really does, in plain words.
    expect(blob).toContain('earn a draw');
    expect(blob).toContain('never sold');
    expect(blob).toContain('a rare card is guaranteed');
    expect(blob).toContain('The first cards of each deck are in the app, so your first lesson works offline');
    expect(blob).toContain('official documentation');
    // 2.0: no record supports a developer spot-check; checks are automated + AI review passes.
    expect(blob).toContain(
      'Cards are drafted with AI assistance from official documentation and checked by automated checks and AI review passes. If a card looks wrong, sign in and use Report a problem.',
    );
    expect(blob).not.toMatch(/spot-check/i);
    // Draws never repeat a card; say so without promising "only missing cards".
    expect(blob).toContain('no repeat draws: a card you have drawn never comes up again');
    expect(blob).not.toMatch(/never (get )?a duplicate|only cards missing from your collection/i);
    expect(blob).toContain('Report a card');
    expect(blob).not.toMatch(/\b(pulls?|pity|wallet|reserve|run|runs|readiness)\b/i);
    expect(blob).not.toMatch(/no account needed|checked by me|Android|thousands of cards/i);
    const answers = FAQ_LIST.map((entry) => `${entry.q} ${entry.a}`).join('\n');
    expect(answers).not.toMatch(/exam simulator|pass probability|readiness|score/i);
    expect(blob).not.toMatch(/verified by (Amazon|Microsoft|Anthropic)/i);
    // R24B §2: both disclaimer lines render as the screen's footer.
    expect(FAQ_DISCLAIMER).toEqual([
      'Not official exam material and not an exam simulator.',
      'AWS is a trademark of Amazon.com, Inc. Claude and Anthropic are trademarks of Anthropic, PBC. .NET and C# are trademarks of Microsoft Corporation. DeveloperCards is not affiliated with, sponsored by, or endorsed by Amazon, Anthropic or Microsoft.',
    ]);
    const disclaimer = tree.root.findAll(
      (node) => (node.type as any) === 'Text' && node.props.testID === 'help-faq-disclaimer',
    );
    expect(disclaimer.map((node) => collectText(node))).toEqual([...FAQ_DISCLAIMER]);
    expect(blob).not.toContain('support companion');
    expect(blob).not.toContain('route pressure');
    expect(blob).not.toContain('Fresh Start');
  });
});
