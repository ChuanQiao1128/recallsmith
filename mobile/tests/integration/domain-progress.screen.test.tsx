import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, style, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
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

const fixtures = vi.hoisted(() => ({
  deck: null as any,
  deckError: null as Error | null,
  progress: [] as any[],
  owned: new Set<string>(),
  book: { v: 1, entries: {} } as any,
}));

vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async (slug: string) => {
    if (fixtures.deckError) throw fixtures.deckError;
    return fixtures.deck && fixtures.deck.Slug === slug ? fixtures.deck : null;
  }),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => fixtures.progress),
}));

vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({
  resolveEffectiveOwned: vi.fn(async () => fixtures.owned),
}));

vi.mock('../../src/features/gacha/mistakes/mistakeBook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/gacha/mistakes/mistakeBook')>();
  return { ...actual, loadMistakeBook: vi.fn(async () => fixtures.book) };
});

import {
  DOMAIN_PROGRESS_ERROR_TEXT,
  DOMAIN_PROGRESS_FOOTER,
  DOMAIN_PROGRESS_TITLE,
  DomainProgressScreen,
  PRACTICE_DISABLED_TEXT,
} from '../../src/screens/DomainProgressScreen';
import type { CardExport, DeckExport } from '../../src/types/deckExport';
import type { CardProgress } from '../../src/review/model';
import type { MistakeEntry } from '../../src/features/gacha/mistakes/mistakeBook';

const DAY = 86_400_000;
const NOW = Date.now();

let order = 0;
function card(uid: string, topic: string | null): CardExport {
  order += 1;
  return { StableUid: uid, OrderInDeck: order, Difficulty: 1, Question: `Q ${uid}`, Topic: topic };
}

function deck(slug: string, cards: CardExport[]): DeckExport {
  return {
    Slug: slug,
    Title: 'AWS SAA',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    IsFreeStarter: true,
    TotalCards: cards.length,
    FreeCardCount: cards.length,
    Cards: cards,
  };
}

function learned(uid: string, stage: number, reviewedDaysAgo: number, dueInDays: number): CardProgress {
  return {
    stableUid: uid,
    stage,
    lastReviewedAt: NOW - reviewedDaysAgo * DAY,
    nextReviewAt: NOW + dueInDays * DAY,
  };
}

function mistake(deckSlug: string, uid: string): MistakeEntry {
  return {
    deckSlug,
    stableUid: uid,
    topic: null,
    wrongCount: 1,
    firstWrongAt: NOW - DAY,
    lastWrongAt: NOW - DAY,
    lastOutcome: 'again',
    correctStreak: 0,
    resolvedAt: null,
  };
}

function seedBook(entries: MistakeEntry[]) {
  const record: Record<string, MistakeEntry> = {};
  for (const e of entries) record[`${e.deckSlug}::${e.stableUid}`] = e;
  fixtures.book = { v: 1, entries: record };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');

function textOf(node: renderer.ReactTestInstance): string {
  return node
    .findAll((n) => (n.type as any) === 'Text')
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    })
    .join('\n');
}

function allText(tree: renderer.ReactTestRenderer): string {
  return textOf(tree.root);
}

async function renderScreen(slug = 'aws-saa-c03', navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  const focusListeners: Array<() => void> = [];
  const unsubscribe = vi.fn();
  const navigation = {
    navigate,
    goBack: vi.fn(),
    addListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'focus') focusListeners.push(listener);
      return unsubscribe;
    }),
  };
  await act(async () => {
    tree = renderer.create(
      <DomainProgressScreen
        navigation={navigation as any}
        route={{ key: 'dp', name: 'DomainProgress', params: { slug } } as any}
      />,
    );
  });
  await flush();
  const focus = async () => {
    await act(async () => {
      for (const listener of focusListeners) listener();
    });
    await flush();
  };
  return { tree, navigate, focus, unsubscribe, focusListeners };
}

describe('DomainProgressScreen', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    order = 0;
    fixtures.deckError = null;
    // d1: s1..s4 (1.x), d2: r1..r2 (2.x), plus one untagged card.
    fixtures.deck = deck('aws-saa-c03', [
      card('s1', '1.1 Secure access'),
      card('s2', '1.2 Secure workloads'),
      card('s3', 'D1 services'),
      card('s4', '1.3 Data security controls'),
      card('r1', '2.1 Loosely coupled architectures'),
      card('r2', '2.2 HA and fault tolerance'),
      card('x1', null),
    ]);
    fixtures.progress = [
      learned('s1', 1, 1, 5),
      learned('s2', 5, 2, 20), // mastered
      learned('s3', 2, 4, -1), // due
      { stableUid: 's4', stage: 0, nextReviewAt: 0 },
    ];
    fixtures.owned = new Set(['s1', 's2', 's3', 's4', 'r1']);
    seedBook([mistake('aws-saa-c03', 's1'), mistake('aws-saa-c03', 's2'), mistake('csharp-basics', 's3')]);
  });

  it('renders the title and per-domain counts, weight line, bar and chips', async () => {
    const { tree } = await renderScreen();
    const text = allText(tree);
    expect(text).toContain(DOMAIN_PROGRESS_TITLE);
    expect(DOMAIN_PROGRESS_TITLE).toBe('Progress by domain');

    const d1 = byTestID(tree, 'domain-row-d1')[0];
    expect(textOf(d1)).toContain('Design Secure Architectures');
    expect(textOf(byTestID(tree, 'domain-weight-d1')[0])).toBe('30% of the exam');
    expect(textOf(byTestID(tree, 'domain-counts-d1')[0])).toBe('3 of 4 learned · 1 mastered');
    expect(textOf(byTestID(tree, 'domain-due-d1')[0])).toBe('1 due');
    expect(textOf(byTestID(tree, 'domain-mistakes-d1')[0])).toBe('2 mistakes');
    expect(byTestID(tree, 'domain-bar-d1')).toHaveLength(1);

    expect(textOf(byTestID(tree, 'domain-counts-d2')[0])).toBe('0 of 2 learned · 0 mastered');
    expect(byTestID(tree, 'domain-due-d2')).toHaveLength(0);
    expect(byTestID(tree, 'domain-mistakes-d2')).toHaveLength(0);

    // The untagged card is grouped under "Other", which has no exam weight.
    expect(textOf(byTestID(tree, 'domain-row-other')[0])).toContain('Other');
    expect(byTestID(tree, 'domain-weight-other')).toHaveLength(0);
  });

  it('never prints a percentage about the learner', async () => {
    const { tree } = await renderScreen();
    const lines = allText(tree)
      .split('\n')
      .filter((line) => line.includes('%'));
    // Only the exam's own weights carry a % sign.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^\d+(\.\d+)?% of the exam$/);
  });

  it('Practice starts a focus session with the right cards in order', async () => {
    const { tree, navigate } = await renderScreen();
    const practice = byTestID(tree, 'domain-practice-d1')[0];
    expect(practice.props.disabled).toBeFalsy();
    expect(textOf(practice)).toBe('Practice');
    await act(async () => {
      practice.props.onPress();
    });
    // Mistakes first (s1 stage 1 before s2 stage 5), then the due card s3; s4 was never learned.
    expect(navigate).toHaveBeenCalledWith('SessionCard', { slug: 'aws-saa-c03', focusUids: ['s1', 's2', 's3'] });
  });

  it('disables Practice when no owned, learned card of the domain qualifies', async () => {
    const { tree, navigate } = await renderScreen();
    const practice = byTestID(tree, 'domain-practice-d2')[0];
    expect(practice.props.disabled).toBe(true);
    expect(practice.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(textOf(byTestID(tree, 'domain-practice-note-d2')[0])).toBe(PRACTICE_DISABLED_TEXT);
    expect(PRACTICE_DISABLED_TEXT).toBe('Learn a card in this domain first');
    await act(async () => {
      practice.props.onPress?.();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(byTestID(tree, 'domain-practice-note-d1')).toHaveLength(0);
  });

  it('shows the footer line exactly', async () => {
    const { tree } = await renderScreen();
    expect(DOMAIN_PROGRESS_FOOTER).toBe(
      'Cards you have studied, not an exam score. DeveloperCards is not an exam simulator.',
    );
    expect(textOf(byTestID(tree, 'domain-progress-footer')[0])).toBe(DOMAIN_PROGRESS_FOOTER);
  });

  it('shows an empty state when the deck is not on the device', async () => {
    const { tree } = await renderScreen('missing-deck');
    expect(byTestID(tree, 'domain-progress-empty')).toHaveLength(1);
    expect(byTestID(tree, 'domain-row-d1')).toHaveLength(0);
  });

  it('reloads the counts on every focus and unsubscribes on unmount', async () => {
    const { tree, focus, unsubscribe, focusListeners } = await renderScreen();
    expect(focusListeners).toHaveLength(1);
    expect(textOf(byTestID(tree, 'domain-counts-d2')[0])).toBe('0 of 2 learned · 0 mastered');

    // A Practice session learned r1; coming back refreshes the row.
    fixtures.progress = [...fixtures.progress, learned('r1', 1, 0, 1)];
    await focus();
    expect(textOf(byTestID(tree, 'domain-counts-d2')[0])).toBe('1 of 2 learned · 0 mastered');

    expect(unsubscribe).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the rows on screen when a reload on focus fails, with an inline error and retry', async () => {
    const { tree, focus } = await renderScreen();
    expect(byTestID(tree, 'domain-row-d1')).toHaveLength(1);

    fixtures.deckError = new Error('storage read failed');
    await focus();
    expect(byTestID(tree, 'domain-row-d1')).toHaveLength(1);
    expect(textOf(byTestID(tree, 'domain-counts-d1')[0])).toBe('3 of 4 learned · 1 mastered');
    expect(byTestID(tree, 'domain-progress-empty')).toHaveLength(0);
    expect(textOf(byTestID(tree, 'domain-progress-error')[0])).toContain(DOMAIN_PROGRESS_ERROR_TEXT);

    fixtures.deckError = null;
    fixtures.progress = [...fixtures.progress, learned('r1', 1, 0, 1)];
    await act(async () => {
      byTestID(tree, 'domain-progress-retry')[0].props.onPress();
    });
    await flush();
    expect(byTestID(tree, 'domain-progress-error')).toHaveLength(0);
    expect(textOf(byTestID(tree, 'domain-counts-d2')[0])).toBe('1 of 2 learned · 0 mastered');
  });

  it('shows an error with retry, not the deck-missing empty state, when the first load fails', async () => {
    fixtures.deckError = new Error('storage read failed');
    const { tree } = await renderScreen();
    expect(byTestID(tree, 'domain-progress-empty')).toHaveLength(0);
    expect(byTestID(tree, 'domain-progress-loading')).toHaveLength(0);
    expect(textOf(byTestID(tree, 'domain-progress-error')[0])).toContain(DOMAIN_PROGRESS_ERROR_TEXT);

    fixtures.deckError = null;
    await act(async () => {
      byTestID(tree, 'domain-progress-retry')[0].props.onPress();
    });
    await flush();
    expect(byTestID(tree, 'domain-progress-error')).toHaveLength(0);
    expect(byTestID(tree, 'domain-row-d1')).toHaveLength(1);
  });
});
