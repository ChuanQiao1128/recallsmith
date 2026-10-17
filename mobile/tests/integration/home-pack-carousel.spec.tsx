// 2026-10-18 home carousel: Home's cover is a horizontal swipe carousel, one page per visible pack in
// DECK_ORDER. A swipe, a dot, a peek or a VoiceOver pack action only selects a pack; installed packs
// become the app-wide active deck, exactly as a pack-tile tap did. The cover keeps every install,
// navigation and paywall path. The starter-lesson lock lives in home-starter-lesson.spec.tsx.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let walletFixture = { availablePulls: 0, reservePulls: 0 };
let activeSlugFixture: string | null = 'aws-saa-fundamentals';
let deckSummariesFixture: any[] = [];
let updatesFixture: Record<string, any> = {};
let reduceMotionFixture = false;

const navigateMock = vi.fn();
const setActiveDeckSlugMock = vi.fn(async (_slug: string) => {});
const scrollToMock = vi.fn();
const announceMock = vi.fn();
const sendAccessibilityEventMock = vi.fn();
const loopStartMock = vi.fn();

vi.mock('react-native', () => {
  const React = require('react');
  class AnimatedValue {
    value: number;
    constructor(value: number) {
      this.value = value;
    }
    setValue(value: number) {
      this.value = value;
    }
    interpolate() {
      return 0;
    }
  }
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    AccessibilityInfo: {
      isReduceMotionEnabled: vi.fn(async () => reduceMotionFixture),
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
      announceForAccessibility: (text: string) => announceMock(text),
      sendAccessibilityEvent: (node: unknown, event: string) => sendAccessibilityEventMock(node, event),
    },
    Animated: {
      View: ({ children, ...props }: any) => React.createElement('AnimatedView', props, children),
      Value: AnimatedValue,
      timing: vi.fn(() => ({})),
      sequence: vi.fn(() => ({})),
      loop: vi.fn(() => ({ start: () => loopStartMock(), stop: vi.fn() })),
    },
    Easing: { inOut: (easing: unknown) => easing, ease: () => 0 },
    Alert: { alert: vi.fn() },
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: any) => {
    React.useEffect(() => callback(), [callback]);
  },
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => activeSlugFixture),
  setActiveDeckSlug: vi.fn(async (slug: string) => setActiveDeckSlugMock(slug)),
}));

vi.mock('../../src/features/gacha/home/deckActionResolver', () => ({
  loadHomeDeckSummaries: vi.fn(async () => makeHomeSummary()),
  autoApplyFreeDeckUpdates: vi.fn(() => []),
  resolveDeckAction: vi.fn(async () => ({ kind: 'open', slug: 'aws-saa-fundamentals' })),
  executeDeckAction: vi.fn(async () => ({ activeSlug: 'aws-saa-fundamentals' })),
}));

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      status: 'signed_out',
      accessToken: '',
      init: vi.fn(async () => {}),
      userSub: null,
    }),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/home/homeRemote', () => ({
  fetchServerPremium: vi.fn(async () => false),
}));

vi.mock('../../src/features/gacha/rewards/economyFloor', () => ({
  prepareHomeDeckWallets: vi.fn(async ({ deckSummaries }: { deckSummaries: Array<{ slug: string }> }) => {
    const out: Record<string, typeof walletFixture> = {};
    for (const s of deckSummaries) out[s.slug] = walletFixture;
    return out;
  }),
}));

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => ({
    currentDailyStreak: 2,
    longestDailyStreak: 2,
    weekCompletedDays: 2,
    totalQualifiedSessions: 3,
    lastQualifiedDateKey: '2026-01-01',
    currentWeekKey: '2026-W01',
  })),
}));

vi.mock('../../src/sync/progressSync', () => ({
  forceProgressSync: vi.fn(async () => {}),
}));

vi.mock('../../src/features/goal/studyGoal', async (importActual) => ({
  ...(await importActual<typeof import('../../src/features/goal/studyGoal')>()),
  getStudyGoal: vi.fn(async () => null),
}));

import { Alert } from 'react-native';
import { HomeScreen } from '../../src/screens/HomeScreen';
import TodayPressureCard from '../../src/features/gacha/components/TodayPressureCard';
import { HOME_PACK_PAGE_WIDTH } from '../../src/features/gacha/home/HomePackCarousel';
import {
  executeDeckAction,
  loadHomeDeckSummaries,
  resolveDeckAction,
} from '../../src/features/gacha/home/deckActionResolver';
import { DECK_ORDER } from '../../src/content/hiddenDecks';

function makeHomeSummary() {
  const now = Date.now();
  return {
    deckSummaries: deckSummariesFixture,
    updates: updatesFixture,
    allUpcoming30: Array.from({ length: 30 }, (_, i) => ({
      dateKey: new Date(now + i * 86_400_000).toISOString(),
      count: 0,
    })),
    asOfISO: new Date(now).toISOString(),
  };
}

function deck(slug: string, title: string, over: Record<string, unknown> = {}) {
  return {
    slug,
    title,
    locale: 'en-US',
    version: '1',
    deckType: 1,
    totalCards: 10,
    localCards: 10,
    studyCards: 10,
    canStudy: true,
    dueToday: 0,
    plannedToday: 0,
    newToday: 0,
    masteredApprox: 5,
    percent: 0.5,
    ...over,
  };
}

// The three packs the app shows, in DECK_ORDER.
const BASICS = () => deck('aws-saa-fundamentals', 'AWS Fundamentals', { dueToday: 1, plannedToday: 1, newToday: 1 });
const SAA = () => deck('aws-saa-c03', 'AWS Solutions Architect Associate', { dueToday: 4, plannedToday: 4 });
const CLAUDE = () => deck('claude-ccdv-f', 'Claude Developer Foundations (CCDV-F)');

// Host nodes only: a mocked component and the host element it renders share props.
function hostNodes(tree: renderer.ReactTestRenderer, predicate: (node: renderer.ReactTestInstance) => boolean) {
  return tree.root.findAll((node) => typeof node.type === 'string' && predicate(node));
}

function featured(tree: renderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: 'home-featured-pack' });
}

// The fallback cover title of the current page (the RN facade has no Image).
function featuredTitle(tree: renderer.ReactTestRenderer): string {
  return featured(tree)
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => String(node.props.children ?? ''))
    .join('');
}

function pageSlugs(tree: renderer.ReactTestRenderer): string[] {
  return hostNodes(tree, (node) => String(node.props?.testID ?? '').startsWith('home-pack-page-')).map((node) =>
    String(node.props.testID).slice('home-pack-page-'.length),
  );
}

function dots(tree: renderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: 'home-pack-visual' }).findAll(
    (node) =>
      (node.type as any) === 'Pressable'
      && typeof node.props.accessibilityLabel === 'string'
      && node.props.accessibilityLabel.includes(' pack — '),
  );
}

function dot(tree: renderer.ReactTestRenderer, shortTitle: string) {
  const match = dots(tree).find((node) => node.props.accessibilityLabel.startsWith(`${shortTitle} pack — `));
  if (!match) throw new Error(`no dot for ${shortTitle}`);
  return match;
}

function textOf(tree: renderer.ReactTestRenderer, testID: string): string | null {
  const nodes = hostNodes(tree, (node) => node.props?.testID === testID);
  return nodes.length ? String(nodes[0].props.children) : null;
}

function todayDeckTitle(tree: renderer.ReactTestRenderer): string | null {
  return tree.root.findByType(TodayPressureCard).props.selectedDeckTitle;
}

function primaryCtaLabel(tree: renderer.ReactTestRenderer): string {
  const cta = hostNodes(tree, (node) => node.props?.testID === 'home-primary-cta')[0];
  return String(cta.find((node) => (node.type as any) === 'Text').props.children);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Host refs resolve to these stand-ins, so the carousel's scrollTo and focus calls are observable.
function createNodeMock(element: React.ReactElement<any>) {
  if (element.type === 'ScrollView') return { scrollTo: scrollToMock, testID: element.props?.testID };
  return { testID: element.props?.testID };
}

async function renderHome() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <HomeScreen navigation={{ navigate: navigateMock } as any} route={{ key: 'home', name: 'Home' } as any} />,
      { createNodeMock },
    );
  });
  await flush();
  await flush();
  return tree;
}

async function swipeEnd(tree: renderer.ReactTestRenderer, offsetX: number) {
  await act(async () => {
    tree.root.findByProps({ testID: 'home-pack-carousel' }).props.onMomentumScrollEnd({
      nativeEvent: { contentOffset: { x: offsetX, y: 0 } },
    });
    await Promise.resolve();
  });
}

async function press(node: renderer.ReactTestInstance) {
  await act(async () => {
    node.props.onPress();
    await Promise.resolve();
  });
}

describe('HomeScreen cover carousel', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    walletFixture = { availablePulls: 0, reservePulls: 0 };
    activeSlugFixture = 'aws-saa-fundamentals';
    deckSummariesFixture = [BASICS(), SAA(), CLAUDE()];
    updatesFixture = {};
    reduceMotionFixture = false;
    navigateMock.mockReset();
    setActiveDeckSlugMock.mockClear();
    scrollToMock.mockClear();
    announceMock.mockClear();
    sendAccessibilityEventMock.mockClear();
    loopStartMock.mockClear();
    (Alert.alert as any).mockClear();
    vi.mocked(resolveDeckAction).mockClear();
    vi.mocked(executeDeckAction).mockClear();
    vi.mocked(loadHomeDeckSummaries).mockClear();
  });

  it('selects the pack a swipe lands on, makes it the active deck and rebuilds Home without reloading', async () => {
    const tree = await renderHome();
    scrollToMock.mockClear();
    expect(featuredTitle(tree)).toBe('AWS Fundamentals');
    expect(textOf(tree, 'home-pack-caption')).toBe('AWS Basics');
    const loadsBefore = vi.mocked(loadHomeDeckSummaries).mock.calls.length;
    setActiveDeckSlugMock.mockClear();

    await swipeEnd(tree, HOME_PACK_PAGE_WIDTH);

    expect(setActiveDeckSlugMock.mock.calls).toEqual([['aws-saa-c03']]);
    expect(featuredTitle(tree)).toBe('AWS Solutions Architect Associate');
    expect(textOf(tree, 'home-pack-caption')).toBe('AWS SAA-C03');
    expect(todayDeckTitle(tree)).toBe('AWS Solutions Architect Associate');
    expect(primaryCtaLabel(tree)).toBe('Clear due reviews');
    expect(vi.mocked(loadHomeDeckSummaries).mock.calls.length).toBe(loadsBefore);
    expect(announceMock).toHaveBeenCalledWith('AWS SAA-C03 selected');
    // The scroll view is already there: no programmatic scroll on top of the swipe.
    expect(scrollToMock).not.toHaveBeenCalled();

    // The same resting place again (iOS also ends a programmatic scroll this way): nothing new.
    await swipeEnd(tree, HOME_PACK_PAGE_WIDTH + 3);
    expect(setActiveDeckSlugMock).toHaveBeenCalledTimes(1);

    // A drag released while still moving waits for the momentum end ...
    await act(async () => {
      tree.root.findByProps({ testID: 'home-pack-carousel' }).props.onScrollEndDrag({
        nativeEvent: { contentOffset: { x: 2 * HOME_PACK_PAGE_WIDTH - 30, y: 0 }, velocity: { x: 0.8, y: 0 } },
      });
    });
    expect(setActiveDeckSlugMock).toHaveBeenCalledTimes(1);
    // ... and one released at rest settles on the nearest page at once.
    await act(async () => {
      tree.root.findByProps({ testID: 'home-pack-carousel' }).props.onScrollEndDrag({
        nativeEvent: { contentOffset: { x: 2 * HOME_PACK_PAGE_WIDTH - 30, y: 0 }, velocity: { x: 0, y: 0 } },
      });
    });
    expect(setActiveDeckSlugMock).toHaveBeenLastCalledWith('claude-ccdv-f');
    expect(featuredTitle(tree)).toBe('Claude Developer Foundations (CCDV-F)');

    // A swipe never installs, navigates or opens the paywall.
    expect(navigateMock).not.toHaveBeenCalled();
    expect(resolveDeckAction).not.toHaveBeenCalled();
    expect(executeDeckAction).not.toHaveBeenCalled();
  });

  it('lays the pages and dots out in DECK_ORDER and stops at both ends', async () => {
    // Out of order on arrival; the active deck (SAA-C03) is the second page in DECK_ORDER.
    deckSummariesFixture = [SAA(), CLAUDE(), BASICS()];
    activeSlugFixture = 'aws-saa-c03';
    const tree = await renderHome();

    expect(pageSlugs(tree)).toEqual([...DECK_ORDER]);
    expect(dots(tree).map((node) => node.props.accessibilityLabel)).toEqual([
      'AWS Basics pack — 1 due',
      'AWS SAA-C03 pack — 4 due',
      'Claude CCDV-F pack — Ready',
    ]);
    const carousel = tree.root.findByProps({ testID: 'home-pack-carousel' });
    expect(carousel.props.horizontal).toBe(true);
    expect(carousel.props.snapToInterval).toBe(HOME_PACK_PAGE_WIDTH);
    expect(carousel.props.scrollEnabled).toBe(true);
    // Opens on the active deck's page, the second.
    expect(carousel.props.contentOffset).toEqual({ x: HOME_PACK_PAGE_WIDTH, y: 0 });
    expect(scrollToMock).not.toHaveBeenCalled();
    expect(featuredTitle(tree)).toBe('AWS Solutions Architect Associate');

    // Past the last page: the last page, no wrap to the first.
    await swipeEnd(tree, 10 * HOME_PACK_PAGE_WIDTH);
    expect(setActiveDeckSlugMock).toHaveBeenLastCalledWith('claude-ccdv-f');
    // Before the first: the first.
    await swipeEnd(tree, -HOME_PACK_PAGE_WIDTH);
    expect(setActiveDeckSlugMock).toHaveBeenLastCalledWith('aws-saa-fundamentals');
  });

  it('hides the peeking pages from VoiceOver and keeps one cover, with the update chip outside it', async () => {
    updatesFixture = {
      'aws-saa-c03': {
        slug: 'aws-saa-c03',
        installedVersion: '1',
        remoteVersion: '2',
        hasUpdate: true,
        remoteUrl: 'https://example.test/aws-saa-c03.json',
        remoteSha256: null,
      },
    };
    deckSummariesFixture = [BASICS(), { ...SAA(), totalCards: 12 }, CLAUDE()];
    const tree = await renderHome();

    const pages = hostNodes(tree, (node) => String(node.props?.testID ?? '').startsWith('home-pack-page-'));
    const current = pages.filter((node) => !node.props.accessibilityElementsHidden);
    expect(current.map((node) => node.props.testID)).toEqual(['home-pack-page-aws-saa-fundamentals']);
    expect(current[0].props.importantForAccessibility).toBe('auto');
    for (const peek of pages.filter((node) => node.props.accessibilityElementsHidden)) {
      expect(peek.props.importantForAccessibility).toBe('no-hide-descendants');
      const pressables = peek.findAll((node) => (node.type as any) === 'Pressable');
      expect(pressables).toHaveLength(1);
      expect(pressables[0].props.accessible).toBe(false);
      expect(pressables[0].props.accessibilityLabel).toBeUndefined();
      expect(pressables[0].props.testID).toBeUndefined();
    }

    // Exactly one cover, on the current page.
    expect(hostNodes(tree, (node) => node.props?.testID === 'home-featured-pack')).toHaveLength(1);
    expect(current[0].findAll((node) => node.props?.testID === 'home-featured-pack').length).toBeGreaterThan(0);

    // The peeking SAA-C03 page shows its update chip, outside any cover.
    const saaPage = pages.find((node) => node.props.testID === 'home-pack-page-aws-saa-c03')!;
    const chip = saaPage.find((node) => (node.type as any) === 'View' && node.props?.testID === 'home-pack-update-chip-aws-saa-c03');
    expect(String(chip.find((node) => (node.type as any) === 'Text').props.children)).toBe('Update · +2 cards');

    // A tap on a peeking pack selects it (and only selects it): the cover moves there.
    const peekPress = saaPage.find((node) => (node.type as any) === 'Pressable');
    await press(peekPress);
    expect(setActiveDeckSlugMock).toHaveBeenLastCalledWith('aws-saa-c03');
    expect(featuredTitle(tree)).toBe('AWS Solutions Architect Associate');
    expect(featuredTitle(tree)).not.toContain('Update');
    expect(navigateMock).not.toHaveBeenCalled();
    expect(resolveDeckAction).not.toHaveBeenCalled();
  });

  it('offers VoiceOver Next pack and Previous pack actions on the cover', async () => {
    const tree = await renderHome();
    scrollToMock.mockClear();
    expect(featured(tree).props.accessibilityRole).toBe('button');
    expect(featured(tree).props.accessibilityActions).toEqual([{ name: 'nextPack', label: 'Next pack' }]);
    expect(featured(tree).props.accessibilityValue).toEqual({ text: 'AWS Basics, 1 of 3' });
    setActiveDeckSlugMock.mockClear();

    await act(async () => {
      featured(tree).props.onAccessibilityAction({ nativeEvent: { actionName: 'nextPack' } });
      await Promise.resolve();
    });
    expect(setActiveDeckSlugMock.mock.calls).toEqual([['aws-saa-c03']]);
    expect(featuredTitle(tree)).toBe('AWS Solutions Architect Associate');
    expect(featured(tree).props.accessibilityValue).toEqual({ text: 'AWS SAA-C03, 2 of 3' });
    expect(featured(tree).props.accessibilityActions).toEqual([
      { name: 'nextPack', label: 'Next pack' },
      { name: 'previousPack', label: 'Previous pack' },
    ]);
    expect(announceMock).toHaveBeenCalledWith('AWS SAA-C03 selected');
    // The carousel scrolls to the new cover, and VoiceOver focus follows it there.
    expect(scrollToMock).toHaveBeenLastCalledWith({ x: HOME_PACK_PAGE_WIDTH, y: 0, animated: true });
    expect(sendAccessibilityEventMock).toHaveBeenCalledWith({ testID: 'home-featured-pack' }, 'focus');

    await act(async () => {
      featured(tree).props.onAccessibilityAction({ nativeEvent: { actionName: 'nextPack' } });
      await Promise.resolve();
    });
    expect(featuredTitle(tree)).toBe('Claude Developer Foundations (CCDV-F)');
    expect(featured(tree).props.accessibilityActions).toEqual([{ name: 'previousPack', label: 'Previous pack' }]);

    await act(async () => {
      featured(tree).props.onAccessibilityAction({ nativeEvent: { actionName: 'previousPack' } });
      await Promise.resolve();
    });
    expect(setActiveDeckSlugMock).toHaveBeenLastCalledWith('aws-saa-c03');
    expect(featuredTitle(tree)).toBe('AWS Solutions Architect Associate');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('makes each dot a button named like the old pack tile, and a dot always selects', async () => {
    const tree = await renderHome();
    scrollToMock.mockClear();
    const all = dots(tree);
    expect(all.map((node) => node.props.accessibilityRole)).toEqual(['button', 'button', 'button']);
    expect(all.map((node) => node.props.accessibilityState)).toEqual([
      { selected: true },
      { selected: false },
      { selected: false },
    ]);
    expect(all.map((node) => node.props.accessibilityHint)).toEqual(['Pack 1 of 3', 'Pack 2 of 3', 'Pack 3 of 3']);

    // The current pack's dot still selects (and persists) it; nothing changed, so nothing is announced.
    setActiveDeckSlugMock.mockClear();
    await press(dot(tree, 'AWS Basics'));
    expect(setActiveDeckSlugMock.mock.calls).toEqual([['aws-saa-fundamentals']]);
    expect(announceMock).not.toHaveBeenCalled();
    expect(scrollToMock).not.toHaveBeenCalled();

    await press(dot(tree, 'Claude CCDV-F'));
    expect(setActiveDeckSlugMock).toHaveBeenLastCalledWith('claude-ccdv-f');
    expect(featuredTitle(tree)).toBe('Claude Developer Foundations (CCDV-F)');
    expect(dot(tree, 'Claude CCDV-F').props.accessibilityState).toEqual({ selected: true });
    expect(scrollToMock).toHaveBeenLastCalledWith({ x: 2 * HOME_PACK_PAGE_WIDTH, y: 0, animated: true });
    expect(announceMock).toHaveBeenCalledWith('Claude CCDV-F selected');
  });

  it('treats the momentum end of its own animated scroll as no selection', async () => {
    const tree = await renderHome();
    await press(dot(tree, 'Claude CCDV-F'));
    expect(scrollToMock).toHaveBeenLastCalledWith({ x: 2 * HOME_PACK_PAGE_WIDTH, y: 0, animated: true });
    setActiveDeckSlugMock.mockClear();

    // A stop reported on the way (the animation was cut short) selects nothing ...
    await swipeEnd(tree, 0.9 * HOME_PACK_PAGE_WIDTH);
    // ... and neither does the end of the scroll it was making.
    await swipeEnd(tree, 2 * HOME_PACK_PAGE_WIDTH);
    expect(setActiveDeckSlugMock).not.toHaveBeenCalled();
    expect(featuredTitle(tree)).toBe('Claude Developer Foundations (CCDV-F)');

    // The learner's own swipe afterwards selects as usual.
    await act(async () => {
      tree.root.findByProps({ testID: 'home-pack-carousel' }).props.onScrollBeginDrag();
    });
    await swipeEnd(tree, 0);
    expect(setActiveDeckSlugMock.mock.calls).toEqual([['aws-saa-fundamentals']]);
  });

  it.each([
    [
      'an uninstalled free pack',
      { canStudy: false, localCards: 0, studyCards: 0, masteredApprox: 0, percent: 0 },
      'Install',
    ],
    [
      'a locked premium pack',
      { canStudy: false, localCards: 0, studyCards: 0, masteredApprox: 0, percent: 0, deckType: 2, tier: 'premium' },
      'Locked',
    ],
  ])('selects %s on Home only: no active deck, install, navigation or paywall', async (_label, over, status) => {
    deckSummariesFixture = [BASICS(), SAA(), { ...CLAUDE(), ...over }];
    updatesFixture = {
      'claude-ccdv-f': {
        slug: 'claude-ccdv-f',
        installedVersion: null,
        remoteVersion: '1',
        hasUpdate: true,
        remoteUrl: 'https://example.test/claude-ccdv-f.json',
        remoteSha256: null,
      },
    };
    const tree = await renderHome();
    expect(dot(tree, 'Claude CCDV-F').props.accessibilityLabel).toBe(`Claude CCDV-F pack — ${status}`);
    setActiveDeckSlugMock.mockClear();

    await swipeEnd(tree, 2 * HOME_PACK_PAGE_WIDTH);

    // Shown on Home (cover, caption, Today card, primary button) ...
    expect(featuredTitle(tree)).toBe('Claude Developer Foundations (CCDV-F)');
    expect(textOf(tree, 'home-pack-caption')).toBe('Claude CCDV-F');
    expect(todayDeckTitle(tree)).toBe('Claude Developer Foundations (CCDV-F)');
    expect(primaryCtaLabel(tree)).toBe('Open library');
    // ... but not made the app-wide active deck, not installed, and no screen opened.
    expect(setActiveDeckSlugMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(resolveDeckAction).not.toHaveBeenCalled();
    expect(executeDeckAction).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();

    // The dot does the same.
    await press(dot(tree, 'AWS Basics'));
    expect(setActiveDeckSlugMock.mock.calls).toEqual([['aws-saa-fundamentals']]);
    await press(dot(tree, 'Claude CCDV-F'));
    expect(setActiveDeckSlugMock.mock.calls).toEqual([['aws-saa-fundamentals']]);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(resolveDeckAction).not.toHaveBeenCalled();

    // The cover is still the way in: a tap resolves the pack (install, or the paywall).
    await press(featured(tree));
    expect(resolveDeckAction).toHaveBeenCalledTimes(1);
  });

  it.each([
    [true, false],
    [false, true],
  ])('with Reduce Motion %s, moves the carousel with animated=%s and floats the cover only with motion', async (reduce, animated) => {
    reduceMotionFixture = reduce;
    const tree = await renderHome();
    scrollToMock.mockClear();

    await press(dot(tree, 'AWS SAA-C03'));

    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith({ x: HOME_PACK_PAGE_WIDTH, y: 0, animated });
    if (reduce) expect(loopStartMock).not.toHaveBeenCalled();
    else expect(loopStartMock).toHaveBeenCalled();
  });

  it('counts only the selected pack in the hero headline and the header line', async () => {
    const tree = await renderHome();
    // AWS Basics has 1 due; SAA-C03 has 4; the three packs together have 5.
    expect(textOf(tree, 'home-hero-title')).toBe('1 card waiting');
    expect(textOf(tree, 'home-header-subtitle')).toBe('1 card waiting today');

    await swipeEnd(tree, HOME_PACK_PAGE_WIDTH);
    expect(textOf(tree, 'home-hero-title')).toBe('4 cards waiting');
    expect(textOf(tree, 'home-header-subtitle')).toBe('4 cards waiting today');

    // Nothing due on Claude CCDV-F: no "cards waiting" over its Open library.
    await swipeEnd(tree, 2 * HOME_PACK_PAGE_WIDTH);
    expect(textOf(tree, 'home-hero-title')).toBe('You are clear for now');
    expect(textOf(tree, 'home-header-subtitle')).toBe('Caught up');
    expect(primaryCtaLabel(tree)).toBe('Open library');
  });
});
