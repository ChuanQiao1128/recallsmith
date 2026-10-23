import React, { useState } from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryFilter, LibraryFilterChip, LibraryTopicChip } from '../../src/features/gacha/library/libraryMapper';

vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'TextInput',
  StyleSheet: { create: (styles: any) => styles },
}));

import { LibraryHeader } from '../../src/features/gacha/library/LibraryHeader';

const filters: LibraryFilterChip[] = [
  { key: 'owned', label: 'My cards', count: 6 }, { key: 'all', label: 'All cards', count: 10 },
  { key: 'new', label: 'New', count: 2 }, { key: 'learning', label: 'Learning', count: 3 },
  { key: 'mastered', label: 'Mastered', count: 1 }, { key: 'rare', label: 'Rare', count: 2 },
  { key: 'legendary', label: 'Legendary', count: 1 },
];
const topics: LibraryTopicChip[] = [{ key: 'all', label: 'All topics', count: 10 }, { key: 'iam', label: 'Identity & access', count: 4 }];

function Harness({ initialFilter = 'owned', initialTopic = null, selectedDeckSlug = 'aws', deckTopics = topics }: {
  initialFilter?: LibraryFilter; initialTopic?: string | null; selectedDeckSlug?: string; deckTopics?: LibraryTopicChip[];
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [topic, setTopic] = useState(initialTopic);
  const [open, setOpen] = useState(false);
  return <LibraryHeader title="Cards" ownedCount={6} totalCount={10} filters={filters} filter={filter}
    filterOpen={open} onToggleFilterOpen={() => setOpen(!open)}
    onSelectFilter={(value) => { setFilter(value); setOpen(false); }}
    topics={deckTopics} topicFilter={topic} onSelectTopic={(key) => setTopic(key === 'all' ? null : key)}
    selectedDeckSlug={selectedDeckSlug} deckOptions={[{ slug: 'aws', title: 'AWS' }, { slug: 'csharp', title: 'C#' }]}
    onSelectDeck={() => {}} />;
}

function mount(element = <Harness />) {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(element); });
  return tree;
}
function one(tree: renderer.ReactTestRenderer, id: string) {
  return tree.root.find((node) => typeof node.type === 'string' && node.props.testID === id);
}
function count(tree: renderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((node) => typeof node.type === 'string' && node.props.testID === id).length;
}
function press(tree: renderer.ReactTestRenderer, id: string) { act(() => { one(tree, id).props.onPress(); }); }

describe('Library topic and advanced filter disclosure', () => {
  it('keeps search and common filters visible, and reveals topics and rarity together', () => {
    const tree = mount();
    expect(one(tree, 'library-search')).toBeTruthy();
    for (const key of ['owned', 'all', 'new', 'learning', 'mastered']) expect(one(tree, `library-filter-chip-${key}`)).toBeTruthy();
    expect(count(tree, 'library-topic-chips')).toBe(0);
    expect(count(tree, 'library-sheet-filter-rare')).toBe(0);
    expect(one(tree, 'library-filter-summary').props.accessibilityState.expanded).toBe(false);
    press(tree, 'library-filter-summary');
    expect(one(tree, 'library-filter-summary').props.accessibilityState.expanded).toBe(true);
    expect(one(tree, 'library-topic-chip-iam')).toBeTruthy();
    expect(one(tree, 'library-sheet-filter-rare')).toBeTruthy();
    expect(one(tree, 'library-sheet-filter-legendary')).toBeTruthy();
    expect(count(tree, 'library-sheet-filter-owned')).toBe(0);
  });

  it('shows and clears a collapsed topic without resetting a common filter', () => {
    const tree = mount(<Harness initialFilter="learning" />);
    press(tree, 'library-filter-summary');
    press(tree, 'library-topic-chip-iam');
    press(tree, 'library-filter-summary');
    expect(one(tree, 'library-clear-topic').props.accessibilityLabel).toContain('Identity & access');
    expect(one(tree, 'library-filter-chip-learning').props.accessibilityState.selected).toBe(true);
    press(tree, 'library-clear-topic');
    expect(count(tree, 'library-active-filters')).toBe(0);
    expect(one(tree, 'library-filter-chip-learning').props.accessibilityState.selected).toBe(true);
  });

  it('keeps both active criteria visible and clears rarity to All cards while preserving the topic', () => {
    const tree = mount(<Harness initialFilter="rare" initialTopic="iam" />);
    expect(one(tree, 'library-clear-topic')).toBeTruthy();
    expect(one(tree, 'library-clear-rarity').props.accessibilityLabel).toContain('Rare');
    press(tree, 'library-clear-rarity');
    expect(one(tree, 'library-filter-chip-all').props.accessibilityState.selected).toBe(true);
    expect(one(tree, 'library-clear-topic')).toBeTruthy();
    expect(count(tree, 'library-clear-rarity')).toBe(0);
  });

  it('retains rarity selection through collapse and only shows topic criteria valid for the current deck', () => {
    const tree = mount(<Harness initialTopic="iam" />);
    press(tree, 'library-filter-summary');
    press(tree, 'library-sheet-filter-legendary');
    expect(one(tree, 'library-clear-rarity').props.accessibilityLabel).toContain('Legendary');
    expect(count(tree, 'library-filter-sheet')).toBe(0);
    act(() => { tree.update(<Harness initialTopic="iam" selectedDeckSlug="csharp" deckTopics={[]} />); });
    expect(one(tree, 'library-deck-csharp').props.accessibilityState.selected).toBe(true);
    expect(count(tree, 'library-clear-topic')).toBe(0);
    expect(one(tree, 'library-clear-rarity')).toBeTruthy();
  });
});
