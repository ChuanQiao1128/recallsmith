import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    // CardDetail now pulls in CodeBlock (via the shared CardAnswerSections),
    // which reads Platform at module load.
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (styles: any) => styles },
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

// CardDetail resolves a card through these guarded loaders. Mock them so the
// lookup settles deterministically (no installed deck → not-found), which still
// offers the "Back to library" button this test exercises. Without the mocks
// the real modules resolve on a macrotask the microtask flush never reaches.
vi.mock('../../src/content/activeDeck', () => ({ loadActiveDeckSlug: vi.fn(async () => null) }));
vi.mock('../../src/content/deckCache', () => ({ getCachedDeck: vi.fn(async () => null), invalidateDeckCache: () => {} }));
vi.mock('../../src/content/deckRepository', () => ({ listManifestDecks: vi.fn(async () => []) }));
vi.mock('../../src/review/storage', () => ({ loadDeckProgress: vi.fn(async () => []) }));
vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({ resolveEffectiveOwned: vi.fn(async () => null) }));

import { CardDetailScreen } from '../../src/screens/CardDetailScreen';

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('phase B deeper routes', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('returns from card detail to library', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<CardDetailScreen navigation={{ navigate } as any} route={{ key: 'card', name: 'CardDetail', params: { cardId: 'card-1' } } as any} />);
    });
    // Let the cross-deck lookup settle: with no deck installed the card is not
    // found, and the not-found state offers the same "Back to library" button.
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    act(() => {
      findPressableByText(tree, 'Back to library').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Library');
  });
});
