// R22 §5 (S04): the words a learner reads in a session.
//
// The session header said 'Run 0/1 · Mixed' and the first card was badged
// 'Warm-up node' — internal planner words on a first-run surface. P0 copy:
// the subtitle is 'Card X of Y' (the card on screen, 1-based, no mode label)
// and no route title a learner can read contains 'node'.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import { buildSessionProgressVM } from '../../src/features/gacha/session/sessionReviewHelpers';
import { buildChallengeRoute, buildFocusRoute, buildSweepRoute } from '../../src/features/gacha/planner/sessionBuilder';
import { buildHomeVM } from '../../src/features/gacha/selectors/homeSelectors';
import { RoutePreview } from '../../src/features/gacha/components/RoutePreview';
import type { DeckSummary, RoutePreviewNode } from '../../src/features/gacha/contracts';

function vm(sessionDone: number, sessionLimit: number, mode = 'mixed') {
  return buildSessionProgressVM({ sessionDone, sessionLimit, dueTodayCount: 0, mode });
}

function sampleDeck(): DeckSummary {
  return {
    slug: 'csharp',
    title: 'C# Interview',
    locale: 'en-US',
    version: '1',
    deckType: 1,
    totalCards: 50,
    localCards: 50,
    studyCards: 50,
    canStudy: true,
    dueToday: 4,
    plannedToday: 4,
    newToday: 2,
    masteredApprox: 8,
    percent: 0.16,
  };
}

function visibleWords(nodes: RoutePreviewNode[]) {
  return nodes.flatMap((node) => [node.title, node.subtitle]);
}

describe("session subtitle — 'Card X of Y'", () => {
  it('names the card on screen, 1-based, with no mode label', () => {
    expect(vm(0, 5).subtitle).toBe('Card 1 of 5');
    expect(vm(2, 5).subtitle).toBe('Card 3 of 5');
    expect(vm(0, 1).subtitle).toBe('Card 1 of 1');
  });

  it('never runs past the last card once the run is done', () => {
    expect(vm(5, 5).subtitle).toBe('Card 5 of 5');
  });

  it('shows no mode word for any mode', () => {
    for (const mode of ['mixed', 'learn-new', 'review-due', 'sweep']) {
      const subtitle = vm(1, 4, mode).subtitle;
      expect(subtitle).toBe('Card 2 of 4');
      expect(subtitle).not.toMatch(/Run|Mixed|Learn|Review/);
    }
  });

  it('drops the total when the run has no limit', () => {
    expect(vm(3, 0).subtitle).toBe('Card 4');
  });
});

describe("route titles — no 'Warm-up node', no 'node'", () => {
  const routes = [
    buildChallengeRoute({ slug: 'csharp', deckTitle: 'C#', dueCount: 4, newCount: 3, ownedCount: 20 }),
    buildChallengeRoute({ slug: 'csharp', deckTitle: 'C#', dueCount: 0, newCount: 0, ownedCount: 20 }),
    buildSweepRoute({ slug: 'csharp', deckTitle: 'C#', learnedCount: 30, dueCount: 2, newCount: 0 }),
  ];

  it('gives the warm-up card no title', () => {
    for (const route of routes) {
      const warmup = route.nodes.find((node) => node.role === 'warmup');
      expect(warmup).toBeDefined();
      expect(warmup?.title).toBe('');
    }
  });

  it('keeps every learner-readable route word free of "node"', () => {
    for (const route of routes) {
      for (const word of [...visibleWords(route.nodes), route.summary]) {
        expect(word).not.toMatch(/node/i);
        expect(word).not.toMatch(/Warm-up/i);
      }
    }
    for (const word of visibleWords(buildFocusRoute(3))) expect(word).not.toMatch(/node/i);
  });

  it('keeps Home’s route preview free of "node" too', () => {
    const deck = sampleDeck();
    const home = buildHomeVM({ selectedSlug: 'csharp', hasSignedInUser: true, deckSummaries: [deck] });
    expect(home.routePreview.length).toBeGreaterThan(1);
    expect(home.routePreview[0]?.role).toBe('warmup');
    expect(home.routePreview[0]?.title).toBe('');
    for (const word of visibleWords(home.routePreview)) {
      expect(word).not.toMatch(/node/i);
      expect(word).not.toMatch(/Warm-up/i);
    }
  });

  // F02 s-correctness-4: the hero's helper line said 'Clear 1 node to keep momentum. Full run stays
  // capped at 5 nodes.' It is not rendered today (HomeHero was removed), but it is Home copy in the
  // view model and must not carry the planner word either.
  it('keeps Home’s hero copy free of "node", with card counts pluralised', () => {
    const home = buildHomeVM({ selectedSlug: 'csharp', hasSignedInUser: true, deckSummaries: [sampleDeck()] });
    expect(home.hero.helper).toBe('Clear 1 card to keep making progress. A full session stays capped at 5 cards.');
    for (const word of [home.hero.title, home.hero.subtitle, home.hero.helper, home.hero.headline, home.hero.subline]) {
      expect(word).not.toMatch(/node/i);
    }
  });
});

describe('RoutePreview', () => {
  it('renders no empty title line and no Warm-up label', () => {
    const nodes: RoutePreviewNode[] = [
      { id: 'warmup-0', role: 'warmup', title: '', subtitle: 'An easy first card.' },
      { id: 'boss-1', role: 'boss', title: 'Final check', subtitle: 'A closing test.' },
    ];
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RoutePreview nodes={nodes} />);
    });
    const texts = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => node.props.children);
    expect(texts).not.toContain('');
    expect(texts).not.toContain('Warm-up');
    expect(texts).toContain('Final check');
    expect(texts.join(' ')).not.toMatch(/node/i);
  });

  // F03 supervisor item: the card still renders in tests, so its heading, subtitle and role badges use
  // session words (R24B-00 §1), not the game words.
  it('uses session words for its heading, subtitle and role badges', () => {
    const nodes: RoutePreviewNode[] = [
      { id: 'warmup-0', role: 'warmup', title: '', subtitle: 'An easy first card.' },
      { id: 'elite-1', role: 'elite', title: 'Harder recall', subtitle: 'A sharper check.' },
      { id: 'boss-2', role: 'boss', title: 'Final check', subtitle: 'A closing test.' },
    ];
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RoutePreview nodes={nodes} />);
    });
    const texts = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => [].concat(node.props.children).join(''));
    expect(texts).toContain('Session preview');
    expect(texts).toContain('Today should feel like one short session, not a long to-do list.');
    expect(texts.filter((text) => text === 'Harder recall')).toHaveLength(2);
    expect(texts.filter((text) => text === 'Final check')).toHaveLength(2);
    expect(texts.join(' ')).not.toMatch(/\b(elite|boss|route|run)\b/i);
  });
});
