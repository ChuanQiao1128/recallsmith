import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
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
    Alert: { alert: vi.fn() },
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
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

vi.mock('../../src/auth/authStore', () => ({
  useAuthStore: (selector: any) => selector({ init: vi.fn(async () => {}) }),
  useAuthUser: () => ({ status: 'signed_out', isSignedIn: false, email: null, loading: false }),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => false,
}));

vi.mock('../../src/premium/revenuecat', () => ({
  rcGetCustomerInfoSafe: vi.fn(async () => null),
  isPremiumActive: vi.fn(() => false),
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    { slug: 'csharp', title: 'C# Interview', deckType: 1, availability: 'live' },
  ]),
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    DeckType: 1,
    Cards: [{ StableUid: '1', OrderInDeck: 1, Question: 'Q1', Difficulty: 1 }],
  })),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => true),
}));

vi.mock('../../src/content/premiumDeckApi', () => ({
  fetchPremiumDeckUrl: vi.fn(async () => null),
}));

import { DeckScreen } from '../../src/screens/DeckScreen';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DeckScreen v7 gate', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('does not render mode selector or library card grid', async () => {
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(
        <DeckScreen
          navigation={{ navigate: vi.fn(), goBack: vi.fn() } as any}
          route={{ key: 'deck', name: 'Deck', params: { slug: 'csharp' } } as any}
        />,
      );
    });
    await flush();

    const modeSelector = tree.root.findAll((node) => node.props?.testID === 'mode-selector');
    const grid = tree.root.findAll((node) => node.props?.testID === 'library-card-grid');

    expect(modeSelector).toHaveLength(0);
    expect(grid).toHaveLength(0);
  });
});
