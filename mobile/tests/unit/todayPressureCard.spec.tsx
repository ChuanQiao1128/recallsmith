import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { TodayCounts } from '../../src/features/gacha/contracts';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
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

async function render(c: TodayCounts) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<TodayPressureCard counts={c} selectedDeckTitle="Claude Developer Foundations (CCDV-F)" />);
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
  it('reads Due · New · Learned · Owned for the selected deck', async () => {
    // The owner's screen: 441-card deck, 11 fresh cards, 5 due in another deck.
    const tree = await render(counts({ selectedNew: 11, selectedOwned: 11, totalDueAllDecks: 5 }));

    expect(tileValues(tree)).toEqual({ Due: '0', New: '11', Learned: '0', Owned: '11' });
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
    expect(tileValues(oneOwned)).toEqual({ Due: '0', New: '0', Learned: '0', Owned: '1' });
  });
});
