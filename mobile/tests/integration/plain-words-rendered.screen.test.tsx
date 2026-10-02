import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// R24B W02 / r24bx F02 h-tests-1: the Library no-draws banner and the Card detail locked-card
// button are rendered here, so the wording is checked on the branch and the prop that ships
// (visible Text and VoiceOver label), not only as a literal somewhere in the .tsx source.

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

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
    // CardDetail pulls in CodeBlock, which reads Platform at module load.
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
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

const DECK = {
  Slug: 'aws',
  Title: 'AWS',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 2,
  Cards: [
    { StableUid: 'one', OrderInDeck: 1, Difficulty: 2, Question: 'Q one' },
    { StableUid: 'two', OrderInDeck: 2, Difficulty: 1, Question: 'Q two' },
  ],
};

let ownedFixture: Set<string> | null = null;

vi.mock('../../src/content/activeDeck', () => ({ loadActiveDeckSlug: vi.fn(async () => 'aws') }));
vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async () => DECK),
  invalidateDeckCache: () => {},
}));
vi.mock('../../src/review/storage', () => ({ loadDeckProgress: vi.fn(async () => []) }));
vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({
  resolveEffectiveOwned: vi.fn(async () => ownedFixture),
}));

import { LibraryHeader } from '../../src/features/gacha/library/LibraryHeader';
import { CardDetailScreen } from '../../src/screens/CardDetailScreen';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');

function textsUnder(node: renderer.ReactTestInstance): string[] {
  return node
    .findAll((n) => (n.type as any) === 'Text')
    .map((n) => {
      const children = n.props.children;
      return Array.isArray(children) ? children.join('') : String(children ?? '');
    });
}

function renderLibraryHeader(extra: { ownedCount?: number; openFirstPackHasPulls?: boolean; onOpenFirstPack?: () => void }) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <LibraryHeader
        title="AWS"
        ownedCount={extra.ownedCount ?? 0}
        totalCount={10}
        deckOptions={[]}
        selectedDeckSlug="aws"
        filters={[]}
        filter="all"
        filterOpen={false}
        onSelectDeck={() => {}}
        onToggleFilterOpen={() => {}}
        onSelectFilter={() => {}}
        topics={[]}
        topicFilter={null}
        onSelectTopic={() => {}}
        onOpenFirstPack={extra.onOpenFirstPack}
        openFirstPackHasPulls={extra.openFirstPackHasPulls}
      />,
    );
  });
  return tree;
}

describe('Library no-draws banner, rendered (R24B W02)', () => {
  it('tells a learner with no draws to earn draws in a session, in the title and the VoiceOver label', () => {
    const tree = renderLibraryHeader({ openFirstPackHasPulls: false, onOpenFirstPack: vi.fn() });
    const banner = byTestID(tree, 'library-open-first-pack-cta');
    expect(banner).toHaveLength(1);
    expect(banner[0].props.accessibilityLabel).toBe('Earn draws in a session to open your first pack');
    const texts = textsUnder(banner[0]);
    expect(texts).toContain('Earn draws in a session, then open your first pack');
    expect(texts.join('\n')).not.toMatch(/pull/i);
  });

  it('tells a learner who already has draws to open the first pack, without the earn line', () => {
    const tree = renderLibraryHeader({ openFirstPackHasPulls: true, onOpenFirstPack: vi.fn() });
    const banner = byTestID(tree, 'library-open-first-pack-cta');
    expect(banner).toHaveLength(1);
    expect(banner[0].props.accessibilityLabel).toBe('Open your first pack to start collecting');
    const texts = textsUnder(banner[0]);
    expect(texts).toContain('Open your first pack to start collecting');
    expect(texts.join('\n')).not.toMatch(/Earn draws/);
  });

  it('hides the banner once the learner owns a card', () => {
    const tree = renderLibraryHeader({ ownedCount: 1, onOpenFirstPack: vi.fn() });
    expect(byTestID(tree, 'library-open-first-pack-cta')).toHaveLength(0);
  });
});

async function renderCardDetail(cardId: string) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <CardDetailScreen
        navigation={{ navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any}
        route={{ key: 'k', name: 'CardDetail', params: { cardId } } as any}
      />,
    );
  });
  await flush();
  return tree;
}

describe('Card detail locked-card button, rendered (R24B W02)', () => {
  it('labels the locked-card button Open reward pack, in the text and the VoiceOver label', async () => {
    ownedFixture = new Set(['two']); // 'one' is not owned → locked
    const tree = await renderCardDetail('one');
    const cta = byTestID(tree, 'card-detail-locked-cta');
    expect(cta).toHaveLength(1);
    expect(cta[0].props.accessibilityLabel).toBe('Open reward pack');
    expect(textsUnder(cta[0])).toEqual(['Open reward pack']);
  });

  it('shows no locked-card button on an owned card', async () => {
    ownedFixture = new Set(['one', 'two']);
    const tree = await renderCardDetail('one');
    expect(byTestID(tree, 'card-detail-locked-cta')).toHaveLength(0);
  });
});
