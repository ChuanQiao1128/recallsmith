import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodayCounts } from '../../src/features/gacha/contracts';

const viewport = vi.hoisted(() => ({ width: 390, fontScale: 1 }));
beforeEach(() => { viewport.width = 390; viewport.fontScale = 1; });

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    useWindowDimensions: () => ({ width: viewport.width, height: 844, scale: 3, fontScale: viewport.fontScale }),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import TodayPressureCard from '../../src/features/gacha/components/TodayPressureCard';

function counts(overrides: Partial<TodayCounts> = {}): TodayCounts {
  return {
    totalDueAllDecks: 0,
    selectedDue: 0,
    selectedNew: 0,
    selectedMastered: 0,
    selectedOwned: 0,
    normalCount: 0,
    eliteCount: 0,
    bossCount: 0,
    ...overrides,
  };
}

async function render(c: TodayCounts, compact = false) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<TodayPressureCard counts={c} selectedDeckTitle="Claude Developer Foundations (CCDV-F)" compact={compact} />);
  });
  return tree;
}

function tileValues(tree: renderer.ReactTestRenderer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ['normal', 'elite', 'boss', 'total']) {
    const tile = tree.root.findByProps({ testID: `home-today-count-${id}` });
    const texts = tile.findAll((node) => (node.type as any) === 'Text').map((node) => String(node.props.children));
    out[texts[1]] = texts[0];
  }
  return out;
}

describe('TodayPressureCard', () => {
  it.each([true, false])('stacks the values and leaves full labels readable at accessibility sizes, compact=%s', async (compact) => {
    viewport.width = 375;
    viewport.fontScale = 3.2;
    const tree = await render(counts({ selectedDue: 123, selectedNew: 42, selectedMastered: 334, selectedOwned: 441 }), compact);
    const flatten = (style: any): any => Array.isArray(style)
      ? Object.assign({}, ...style.map(flatten)) : style || {};
    expect(tileValues(tree)).toEqual({ Due: '123', New: '42', Learned: '334', Collected: '441' });
    for (const id of ['normal', 'elite', 'boss', 'total']) {
      const tile = tree.root.findByProps({ testID: `home-today-count-${id}` });
      expect(flatten(tile.props.style).flex).toBeUndefined();
      let row = tile.parent!;
      while ((row.type as any) !== 'View') row = row.parent!;
      expect(flatten(row.props.style).flexDirection).toBe('column');
      for (const text of tile.findAll((node) => (node.type as any) === 'Text')) {
        expect(text.props.numberOfLines).toBeUndefined();
        expect(text.props.allowFontScaling).not.toBe(false);
        expect(text.props.maxFontSizeMultiplier).toBeUndefined();
      }
    }
  });

  it.each([{ width: 375, compact: false }, { width: 390, compact: false }, { width: 375, compact: true }])(
    'separates available cards from cumulative totals at $width, compact=$compact', async ({ width, compact }) => {
      viewport.width = width;
      const tree = await render(counts({ selectedDue: 3, selectedNew: 2, selectedMastered: 17, selectedOwned: 20 }), compact);
      expect(tileValues(tree)).toEqual({ Due: '3', New: '2', Learned: '17', Collected: '20' });
      for (const [heading, labels] of [['Ready now', ['Due', 'New']], ['Pack totals', ['Learned', 'Collected']]] as const) {
        const title = tree.root.find((node) => (node.type as any) === 'Text' && node.props.children === heading);
        let group = title.parent!;
        while ((group.type as any) !== 'View') group = group.parent!;
        const groupText = group.findAll((node) => (node.type as any) === 'Text').map((node) => node.props.children);
        for (const label of labels) expect(groupText).toContain(label);
        expect(group.props.style).toMatchObject(!compact && width < 390 ? { width: '100%' } : { flex: 1 });
      }
      expect(tree.root.findByProps({ testID: 'home-today-count-boss' }).props.accessibilityLabel).toContain('all time');
      expect(tree.root.findByProps({ testID: 'home-today-count-total' }).props.accessibilityLabel).toContain('all time');
    },
  );

  it('reads Due · New · Learned · Collected for the selected deck', async () => {
    // The owner's screen: 441-card deck, 11 fresh cards, 5 due in another deck.
    const tree = await render(counts({ selectedNew: 11, selectedOwned: 11, totalDueAllDecks: 5 }));

    expect(tileValues(tree)).toEqual({ Due: '0', New: '11', Learned: '0', Collected: '11' });
    expect(tree.root.findAllByProps({ testID: 'home-today-empty' })).toHaveLength(0);
  });

  it('collapses to the empty line only when the selected deck holds no cards', async () => {
    const empty = await render(counts());
    expect(empty.root.findAllByProps({ testID: 'home-today-count-grid' })).toHaveLength(0);
    expect(empty.root.findAll((node) => (node.type as any) === 'Text' && node.props?.testID === 'home-today-empty')).toHaveLength(1);

    // Another deck's due cards no longer keep this deck's grid open with a
    // "Total" that was not about it.
    const otherDeckBusy = await render(counts({ totalDueAllDecks: 5 }));
    expect(otherDeckBusy.root.findAllByProps({ testID: 'home-today-count-grid' })).toHaveLength(0);

    // One owned card that is neither due nor new nor learned still counts.
    const oneOwned = await render(counts({ selectedOwned: 1 }));
    expect(tileValues(oneOwned)).toEqual({ Due: '0', New: '0', Learned: '0', Collected: '1' });
  });

  it('keeps the grid height on the empty card with an invisible, unlabelled copy of the tiles', async () => {
    // 2026-10-18 owner: swiping between packs on Home must not move anything; the empty card is as
    // tall as the grid, and the copy under the line is hidden from VoiceOver and from probes.
    const empty = await render(counts());
    const spacers = empty.root.findAll(
      (node) => (node.type as any) === 'View' && node.props?.accessibilityElementsHidden === true,
    );
    expect(spacers).toHaveLength(1);
    expect(spacers[0].props.importantForAccessibility).toBe('no-hide-descendants');
    const texts = spacers[0].findAll((node) => (node.type as any) === 'Text').map((node) => String(node.props.children));
    expect(texts).toEqual(['Ready now', '0', 'Due', '0', 'New', 'Pack totals', '0', 'Learned', '0', 'Collected']);
    expect(spacers[0].findAll((node) => node.props?.testID != null)).toHaveLength(0);

    const full = await render(counts({ selectedNew: 2, selectedOwned: 2 }));
    expect(
      full.root.findAll((node) => (node.type as any) === 'View' && node.props?.accessibilityElementsHidden === true),
    ).toHaveLength(0);
  });
});
