import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const viewport = vi.hoisted(() => ({ width: 375, height: 667, fontScale: 1 }));
vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    TextInput: (props: any) => React.createElement('TextInput', props),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, style, ...props }: any) => React.createElement('Pressable', {
      ...props, style: typeof style === 'function' ? style({ pressed: false }) : style,
    }, children),
    StyleSheet: { create: (styles: any) => styles },
    useWindowDimensions: () => viewport,
  };
});

import { LibraryHeader } from '../../src/features/gacha/library/LibraryHeader';

function flatten(style: any): any {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {};
}

function host(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.find((node) => typeof node.type === 'string' && node.props.testID === testID);
}

const actions = {
  sweep: vi.fn(), deck: vi.fn(), filter: vi.fn(), toggle: vi.fn(), topic: vi.fn(),
};

async function renderHeader(filterOpen = true, ownedCount = 15) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<LibraryHeader
      title="AWS Architect Basics"
      ownedCount={ownedCount}
      totalCount={334}
      deckOptions={[
        { slug: 'aws', title: 'AWS Architect Basics' },
        { slug: 'claude', title: 'Claude Developer Foundations (CCDV-F)' },
      ]}
      selectedDeckSlug="aws"
      filters={[
        { key: 'all', label: 'All cards', count: 334 },
        { key: 'owned', label: 'My cards', count: ownedCount },
        { key: 'rare', label: 'Rare', count: 12 },
        { key: 'legendary', label: 'Legendary', count: 3 },
      ]}
      filter="owned"
      filterOpen={filterOpen}
      onSelectDeck={actions.deck}
      onToggleFilterOpen={actions.toggle}
      onSelectFilter={actions.filter}
      topics={[{ key: 'all', label: 'All topics', count: 334 }, { key: 'architecture', label: 'Design resilient architectures', count: 123 }]}
      topicFilter={null}
      onSelectTopic={actions.topic}
      onStartSweep={actions.sweep}
      sweepCount={15}
      onOpenDomains={() => {}}
      onOpenFirstPack={() => {}}
    />);
  });
  return tree;
}

beforeEach(() => {
  viewport.fontScale = 1;
  Object.values(actions).forEach((action) => action.mockReset());
});

describe('Library header Dynamic Type on a small phone', () => {
  it('preserves the standard horizontal header and scrollable chip rails', async () => {
    const tree = await renderHeader();
    expect(flatten(host(tree, 'library-header-top-bar').props.style).flexDirection).toBe('row');
    expect(host(tree, 'library-title').props.numberOfLines).toBe(2);
    expect(flatten(host(tree, 'library-progress-ring').props.style)).toMatchObject({ width: 54, height: 54 });
    for (const id of ['library-deck-switcher', 'library-filter-chips', 'library-topic-chips']) {
      const rail = host(tree, id);
      expect(rail.type).toBe('ScrollView');
      expect(rail.props.horizontal).toBe(true);
    }
  });

  it('gives titles, counters and filter actions room to wrap at maximum accessibility sizes', async () => {
    viewport.fontScale = 3.2;
    const tree = await renderHeader();
    expect(flatten(host(tree, 'library-header-top-bar').props.style).flexDirection).toBe('column');
    expect(host(tree, 'library-title').props.numberOfLines).toBeUndefined();
    expect(host(tree, 'library-collection-bar').props.children).toBe('15/334');
    expect(host(tree, 'library-collection-bar').props.numberOfLines).toBeUndefined();
    expect(flatten(host(tree, 'library-progress-ring').props.style)).toMatchObject({ width: 54 * 3.2, height: 54 * 3.2 });
    for (const id of ['library-deck-switcher', 'library-filter-chips', 'library-topic-chips']) {
      const rail = host(tree, id);
      expect(rail.type).toBe('View');
      expect(flatten(rail.props.style).flexWrap).toBe('wrap');
    }
    for (const id of ['library-deck-aws', 'library-filter-chip-owned', 'library-topic-chip-architecture', 'library-filter-summary']) {
      const chip = host(tree, id);
      expect(flatten(chip.props.style).maxWidth).toBe('100%');
      expect(chip.find((node) => (node.type as any) === 'Text').props.numberOfLines).toBeUndefined();
    }
    const sweep = host(tree, 'library-sweep-cta');
    expect(sweep.find((node) => (node.type as any) === 'Text').props.numberOfLines).toBeUndefined();
    expect(flatten(sweep.props.style).height).toBeUndefined();
    for (const text of tree.root.findAll((node) => (node.type as any) === 'Text')) {
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    }

    await act(async () => {
      sweep.props.onPress();
      host(tree, 'library-deck-claude').props.onPress();
      host(tree, 'library-filter-chip-all').props.onPress();
      host(tree, 'library-filter-summary').props.onPress();
      host(tree, 'library-topic-chip-architecture').props.onPress();
    });
    expect(actions.sweep).toHaveBeenCalledOnce();
    expect(actions.deck).toHaveBeenCalledWith('claude');
    expect(actions.filter).toHaveBeenCalledWith('all');
    expect(actions.toggle).toHaveBeenCalledOnce();
    expect(actions.topic).toHaveBeenCalledWith('architecture');
  });

  it('lets the first-pack instruction use its full height instead of a two-line slot', async () => {
    viewport.fontScale = 3.2;
    const tree = await renderHeader(false, 0);
    const banner = host(tree, 'library-open-first-pack-cta');
    const title = banner.find((node) => (node.type as any) === 'Text' && String(node.props.children).startsWith('Earn draws'));
    expect(title.props.numberOfLines).toBeUndefined();
    expect(flatten(title.props.style).lineHeight).toBeUndefined();
    expect(flatten(banner.props.style).height).toBeUndefined();
  });
});
