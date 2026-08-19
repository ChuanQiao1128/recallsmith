import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

import { LibraryCardTile } from '../../src/features/gacha/library/LibraryCardTile';
import type { LibraryCardRow } from '../../src/features/gacha/library/libraryMapper';

/**
 * The tile is the one place where getting "missing" wrong is a content leak in
 * one direction and a lie in the other, so it gets its own test rather than
 * riding along inside a screen render.
 *
 * Until the gate existed, the tile asked `status === 'new'` -- which was right
 * only because ungated the two questions had the same answer. Gated they come
 * apart: 'new' now means drawn-but-unstudied, a card the user pulled and is
 * entitled to read.
 */
const baseRow: LibraryCardRow = {
  stableUid: 'card-1',
  orderInDeck: 7,
  question: 'What does the volatile keyword guarantee?',
  difficulty: 2,
  rarity: 'RAR',
  icon: '🧠',
  status: 'new',
  statusLabel: 'New',
  badgeTone: 'new',
  isMissing: false,
  isDueToday: false,
  isUpdated: false,
};

function renderTile(row: LibraryCardRow) {
  let tree: renderer.ReactTestRenderer | null = null;
  // Without act the tree has not committed yet and toJSON() answers null --
  // which would make every "does not contain" assertion below pass for free.
  act(() => {
    tree = renderer.create(
      <LibraryCardTile item={row} numColumns={2} highlighted={false} deckSlug="csharp" onPress={() => {}} />,
    );
  });
  return JSON.stringify(tree!.toJSON());
}

describe('LibraryCardTile — silhouette vs revealed', () => {
  it('reveals the question of an owned card that has not been studied yet', () => {
    const json = renderTile(baseRow);

    expect(json).toContain('What does the volatile keyword guarantee?');
    expect(json).toContain('🧠');
    // Rarity stars are the reward for having pulled the card; an owned card
    // shows them even before it is studied.
    expect(json).toContain('★');
  });

  it('keeps a card outside the collection behind the ? placeholder', () => {
    const json = renderTile({ ...baseRow, status: 'missing', statusLabel: 'Missing', badgeTone: 'missing', isMissing: true });

    expect(json).not.toContain('What does the volatile keyword guarantee?');
    expect(json).toContain('?');
    // Peeking at the rarity tier from the locked grid would spoil the pull.
    expect(json).not.toContain('★');
  });

  it('still hides the question when the caller is ungated and the card is unstudied', () => {
    // The ungated shape: status 'new', label 'Missing', isMissing true from the
    // legacy proxy. This is what every screen still produces today, and it must
    // render exactly as it shipped.
    const json = renderTile({ ...baseRow, statusLabel: 'Missing', isMissing: true });

    expect(json).not.toContain('What does the volatile keyword guarantee?');
    expect(json).toContain('?');
  });
});
