import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

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
  return {
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

import { SessionSummaryScreen } from '../../src/screens/SessionSummaryScreen';
import * as rewardWallet from '../../src/features/gacha/rewards/rewardWallet';

function getTextContent(node: any): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (node?.props?.children) return getTextContent(node.props.children);
  return '';
}

function findPressableByTestID(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.props?.testID === testID);
}

function flattenStyle(style: any): Record<string, unknown> {
  const list = Array.isArray(style) ? style : [style];
  return list.filter(Boolean).reduce((acc, item) => Object.assign(acc, item), {});
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('SessionSummaryScreen', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  const ONE_NEW_CARD_REWARD = {
    newCardPulls: 1,
    newCardUids: ['u1'],
    dueClearPulls: 0 as const,
    rewardPulls: 1,
    applied: 1,
    dropped: 0,
    walletBefore: { availablePulls: 0, reservePulls: 0 },
    walletAfter: { availablePulls: 1, reservePulls: 0 },
  };

  it('shows the outcome reward copy and never writes the wallet', async () => {
    const navigation = {
      navigate: vi.fn(),
    } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={navigation}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              sessionId: 'sess-1',
              slug: 'csharp',
              deckTitle: 'C# Interview',
              sessionDone: 4,
              sessionLimit: 4,
              minimumGoal: 1,
              dueCount: 3,
              streakEarned: true,
              reward: ONE_NEW_CARD_REWARD,
            },
          } as any}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rootAnchors = tree.root.findAll((node) => node.props?.testID === 'screen-session-summary-root');
    const primaryAnchors = tree.root.findAll((node) => node.props?.testID === 'screen-session-summary-primary-cta');
    const secondaryAnchors = tree.root.findAll(
      (node) => (node.type as any) === 'Pressable' && node.props?.testID === 'screen-session-summary-secondary-cta',
    );
    expect(rootAnchors.length).toBeGreaterThan(0);
    expect(primaryAnchors.length).toBeGreaterThan(0);
    expect(secondaryAnchors.length).toBeGreaterThan(0);

    const primaryText = findPressableByTestID(tree, 'screen-session-summary-primary-cta').find(
      (node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
    );
    const secondaryCta = findPressableByTestID(tree, 'screen-session-summary-secondary-cta');
    const secondaryText = secondaryCta.find(
      (node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
    );
    const primaryTextStyle = flattenStyle(primaryText.props.style);
    const secondaryTextStyle = flattenStyle(secondaryText.props.style);
    const secondaryButtonStyle = flattenStyle(secondaryCta.props.style({ pressed: false }));

    expect(primaryText.props.numberOfLines).toBe(1);
    expect(secondaryText.props.numberOfLines).toBe(1);
    expect(secondaryCta.props.accessibilityRole).toBe('link');
    expect(secondaryButtonStyle.minHeight).toBe(44);
    expect(secondaryButtonStyle.alignSelf).toBe('flex-start');
    expect(secondaryButtonStyle.backgroundColor).toBeUndefined();
    expect(secondaryButtonStyle.borderWidth).toBeUndefined();
    expect(secondaryTextStyle.fontSize).toBeLessThan(primaryTextStyle.fontSize as number);

    const texts = tree.root.findAll((node) => (node.type as any) === 'Text').map(getTextContent).join('\n');
    // economy-v2: the pull is paid at rating; the summary only renders the outcome.
    expect(texts).toContain('+1 pull · 1 new card learned');
    expect(texts).toContain('1 ready to use');
    expect(texts).toContain('Daily streak');
    expect(texts).toContain('First day complete');

    await act(async () => {
      tree.update(
        <SessionSummaryScreen
          navigation={navigation}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              sessionId: 'sess-1',
              slug: 'csharp',
              deckTitle: 'C# Interview',
              sessionDone: 4,
              sessionLimit: 4,
              minimumGoal: 1,
              dueCount: 3,
              streakEarned: true,
              reward: ONE_NEW_CARD_REWARD,
            },
          } as any}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // The summary no longer writes the wallet; the pull was already banked at
    // rating time. Wallet keys are user-scoped; no user is signed in under test,
    // so the scope resolves to "anon".
    expect(store.has('devcards:u:anon:recallsmith:reward-wallet:v1')).toBe(false);

    act(() => {
      findPressableByTestID(tree, 'summary-reward-use-pulls-cta').props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Draw', { slug: 'csharp', rewardPending: true });
  });

  it('names each destination once: the pulls chip, the Home button and the library link', async () => {
    const navigation = { navigate: vi.fn() } as any;
    const FIVE_NEW_CARDS_REWARD = {
      newCardPulls: 5,
      newCardUids: ['u1', 'u2', 'u3', 'u4', 'u5'],
      dueClearPulls: 0 as const,
      rewardPulls: 5,
      applied: 5,
      dropped: 0,
      walletBefore: { availablePulls: 14, reservePulls: 0 },
      walletAfter: { availablePulls: 19, reservePulls: 0 },
    };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={navigation}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              sessionId: 'sess-5',
              slug: 'claude-ccdv-f',
              deckTitle: 'Claude Developer Foundations (CCDV-F)',
              sessionDone: 5,
              sessionLimit: 5,
              minimumGoal: 1,
              dueCount: 0,
              streakEarned: true,
              reward: FIVE_NEW_CARDS_REWARD,
            },
          } as any}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The "+5 pulls" chip used to render three times (hero, reward card top
    // row, reward body); the hero chip is the one that stays, the reward card
    // states the count through its anchor circle and its body sentence.
    const chipNodes = tree.root.findAll(
      (node) => (node.type as any) === 'Text' && getTextContent(node.props.children) === '+5 pulls',
    );
    expect(chipNodes).toHaveLength(1);

    const primaryText = getTextContent(
      findPressableByTestID(tree, 'screen-session-summary-primary-cta').find(
        (node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
      ).props.children,
    );
    const secondaryText = getTextContent(
      findPressableByTestID(tree, 'screen-session-summary-secondary-cta').find(
        (node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
      ).props.children,
    );
    expect(primaryText).toBe('Back to Home');
    expect(secondaryText).toBe('Open library');
    expect(secondaryText).not.toMatch(/back home/i);

    act(() => {
      findPressableByTestID(tree, 'screen-session-summary-secondary-cta').props.onPress();
    });
    expect(navigation.navigate).toHaveBeenLastCalledWith('Library');

    act(() => {
      findPressableByTestID(tree, 'screen-session-summary-primary-cta').props.onPress();
    });
    expect(navigation.navigate).toHaveBeenLastCalledWith('Home');
  });

  it('shows an error branch and retries reward resolution without navigating away', async () => {
    const loadWalletSpy = vi.spyOn(rewardWallet, 'loadRewardWalletState').mockRejectedValueOnce(new Error('network error'));
    const navigation = {
      navigate: vi.fn(),
    } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={navigation}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              sessionId: 'sess-error',
              slug: 'csharp',
              deckTitle: 'C# Interview',
              sessionDone: 1,
              sessionLimit: 4,
              minimumGoal: 1,
              dueCount: 1,
              streakEarned: true,
            },
          } as any}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let texts = tree.root.findAll((node) => (node.type as any) === 'Text').map(getTextContent).join('\n');
    expect(texts).toContain('Unable to refresh reward and streak details right now.');
    expect(texts).toContain('Retry');

    act(() => {
      findPressableByTestID(tree, 'screen-session-summary-primary-cta').props.onPress();
    });
    expect(navigation.navigate).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    texts = tree.root.findAll((node) => (node.type as any) === 'Text').map(getTextContent).join('\n');
    expect(texts).not.toContain('Unable to refresh reward and streak details right now.');
    expect(loadWalletSpy).toHaveBeenCalledTimes(2);
    loadWalletSpy.mockRestore();
  });

  it('keeps the primary CTA disabled while reward resolution is loading', async () => {
    let resolveReward!: (value: Awaited<ReturnType<typeof rewardWallet.loadRewardWalletState>>) => void;
    const pendingReward = new Promise<Awaited<ReturnType<typeof rewardWallet.loadRewardWalletState>>>((resolve) => {
      resolveReward = resolve;
    });
    const loadWalletSpy = vi.spyOn(rewardWallet, 'loadRewardWalletState').mockReturnValueOnce(pendingReward);

    const navigation = {
      navigate: vi.fn(),
    } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={navigation}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              sessionId: 'sess-loading',
              slug: 'csharp',
              deckTitle: 'C# Interview',
              sessionDone: 1,
              sessionLimit: 4,
              minimumGoal: 1,
              dueCount: 2,
              streakEarned: true,
            },
          } as any}
        />,
      );
    });

    let texts = tree.root.findAll((node) => (node.type as any) === 'Text').map(getTextContent).join('\n');
    expect(texts).toContain('Wrapping up reward and streak details...');
    expect(texts).toContain('Updating...');

    const primaryCta = findPressableByTestID(tree, 'screen-session-summary-primary-cta');
    expect(primaryCta.props.disabled).toBe(true);

    act(() => {
      primaryCta.props.onPress();
    });
    expect(navigation.navigate).not.toHaveBeenCalled();

    await act(async () => {
      resolveReward({ availablePulls: 1, reservePulls: 0 });
      await Promise.resolve();
      await Promise.resolve();
    });

    const updatedPrimaryCta = findPressableByTestID(tree, 'screen-session-summary-primary-cta');
    expect(updatedPrimaryCta.props.disabled).toBe(false);

    texts = tree.root.findAll((node) => (node.type as any) === 'Text').map(getTextContent).join('\n');
    expect(texts).not.toContain('Updating...');
    expect(loadWalletSpy).toHaveBeenCalledTimes(1);
    loadWalletSpy.mockRestore();
  });

  it('uses neutral empty-state library copy without session setup language', async () => {
    const navigation = {
      navigate: vi.fn(),
    } as any;

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={navigation}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              slug: 'csharp',
              deckTitle: 'C# Interview',
              sessionDone: 0,
              sessionLimit: 4,
              minimumGoal: 1,
              dueCount: 0,
            },
          } as any}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const texts = tree.root.findAll((node) => (node.type as any) === 'Text').map(getTextContent).join('\n');
    expect(texts).toContain("Browse your library while we wait for tomorrow's run.");
    expect(texts.toLowerCase()).not.toContain('choose cards');
    expect(texts.toLowerCase()).not.toContain('session launch');

    act(() => {
      findPressableByTestID(tree, 'screen-session-summary-primary-cta').props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Library');
  });

  it('shows an extra milestone count when multiple milestones unlock', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    store.set(
      'recallsmith:streaks:snapshot:v1',
      JSON.stringify({
        currentDailyStreak: 2,
        longestDailyStreak: 2,
        weekCompletedDays: 0,
        totalQualifiedSessions: 2,
        lastQualifiedDateKey: formatDateKey(yesterday),
        currentWeekKey: null,
      }),
    );

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{
            key: 'summary',
            name: 'SessionSummary',
            params: {
              sessionId: 'sess-milestone-stack',
              slug: 'csharp',
              deckTitle: 'C# Interview',
              sessionDone: 1,
              sessionLimit: 4,
              minimumGoal: 1,
              dueCount: 1,
              streakEarned: true,
            },
          } as any}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const texts = tree.root.findAll((node) => (node.type as any) === 'Text').map(getTextContent).join('\n');
    expect(texts).toContain('Three clean runs');
    expect(texts).toContain('+1 more milestone unlocked');
  });

  it('renders the tomorrow-load forecast line under the reward card only when the run ended on a milestone', async () => {
    const LINE = 'At this pace, about 12 cards come due tomorrow.';
    const baseParams = {
      sessionId: 'sess-forecast',
      slug: 'csharp',
      deckTitle: 'C# Interview',
      sessionDone: 20,
      sessionLimit: 20,
      minimumGoal: 1,
      dueCount: 0,
      streakEarned: true,
      reward: ONE_NEW_CARD_REWARD,
    };
    const findLine = (tree: renderer.ReactTestRenderer) =>
      tree.root.findAll((node) => (node.type as any) === 'Text' && node.props?.testID === 'session-summary-load-forecast');

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <SessionSummaryScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'summary', name: 'SessionSummary', params: { ...baseParams, loadForecast: LINE } } as any}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const line = findLine(tree);
    expect(line).toHaveLength(1);
    expect(getTextContent(line[0])).toBe(LINE);
    expect(line[0].props.numberOfLines).toBe(2);

    // Order on the page: reward card, then the forecast, then the progress block.
    // Host nodes only: a testID prop also sits on the composite wrappers above each host View.
    const order = tree.root
      .findAll(
        (node) =>
          typeof node.type === 'string' &&
          ['summary-reward-block', 'session-summary-load-forecast', 'summary-progress-block'].includes(node.props?.testID),
      )
      .map((node) => node.props.testID);
    expect(order).toEqual(['summary-reward-block', 'session-summary-load-forecast', 'summary-progress-block']);

    // No param (the run did not end on a milestone): nothing renders.
    let plain!: renderer.ReactTestRenderer;
    await act(async () => {
      plain = renderer.create(
        <SessionSummaryScreen
          navigation={{ navigate: vi.fn() } as any}
          route={{ key: 'summary-2', name: 'SessionSummary', params: baseParams } as any}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(findLine(plain)).toHaveLength(0);
  });
});
