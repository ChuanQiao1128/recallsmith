import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let viewportWidth = 390;

const loadActiveDeckSlugMock = vi.fn<() => Promise<string | null>>();
const listManifestDecksMock = vi.fn();
const resolveDeckBySlugMock = vi.fn();
const checkManifestForUpdatesMock = vi.fn();
const installDeckFromUrlMock = vi.fn();
// Hoisted on purpose. DeckScreen feeds authStore.init into a useCallback that
// useFocusEffect depends on, so a mock that minted a fresh vi.fn() per render
// gave the effect a new identity every pass and spun an infinite
// render/refresh loop (the run OOM'd instead of failing). A stable identity is
// part of the contract this mock has to honour.
const authInitMock = vi.fn(async () => {});

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
    useWindowDimensions: () => ({ width: viewportWidth, height: 844 }),
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
  useAuthStore: (selector: any) => selector({ init: authInitMock }),
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
  loadActiveDeckSlug: () => loadActiveDeckSlugMock(),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: () => listManifestDecksMock(),
  resolveDeckBySlug: (...args: any[]) => resolveDeckBySlugMock(...args),
  checkManifestForUpdates: () => checkManifestForUpdatesMock(),
  installDeckFromUrl: (...args: any[]) => installDeckFromUrlMock(...args),
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

async function renderDeck(routeParams?: { slug?: string }) {
  const navigate = vi.fn();
  const goBack = vi.fn();
  let tree!: renderer.ReactTestRenderer;

  await act(async () => {
    tree = renderer.create(
      <DeckScreen
        navigation={{ navigate, goBack } as any}
        route={{ key: 'deck', name: 'Deck', params: routeParams } as any}
      />,
    );
  });
  await flush();

  return { tree, navigate, goBack };
}

describe('DeckScreen v7 gate', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    viewportWidth = 390;

    loadActiveDeckSlugMock.mockReset();
    listManifestDecksMock.mockReset();
    resolveDeckBySlugMock.mockReset();
    checkManifestForUpdatesMock.mockReset();
    installDeckFromUrlMock.mockReset();

    loadActiveDeckSlugMock.mockResolvedValue('csharp');
    listManifestDecksMock.mockResolvedValue([
      { slug: 'csharp', title: 'C# Interview', deckType: 1, availability: 'live' },
    ]);
    resolveDeckBySlugMock.mockResolvedValue({
      Slug: 'csharp',
      Title: 'C# Interview',
      DeckType: 1,
      Cards: [{ StableUid: '1', OrderInDeck: 1, Question: 'Q1', Difficulty: 1 }],
    });
    checkManifestForUpdatesMock.mockResolvedValue({});
    installDeckFromUrlMock.mockResolvedValue(true);
  });

  it.each([360, 375, 390, 430])(
    'keeps gate-only layout and single primary CTA at width %d',
    async (width) => {
      viewportWidth = width;
      const { tree } = await renderDeck({ slug: 'csharp' });

      const modeSelector = tree.root.findAll((node) => node.props?.testID === 'mode-selector');
      const grid = tree.root.findAll((node) => node.props?.testID === 'library-card-grid');
      expect(modeSelector).toHaveLength(0);
      expect(grid).toHaveLength(0);

      // Host-type filters are load bearing: the react-native mocks are function
      // components that forward props to a host element of the same name, so a
      // bare testID predicate matches the composite and the host and counts
      // every anchor twice. The .test.tsx siblings already do this; these
      // assertions are about "exactly one anchor in the tree", not node kinds.
      const routeRoots = tree.root.findAll(
        (node) => node.props?.testID === 'screen-deck-root' && (node.type as any) === 'SafeAreaView',
      );
      const primaryAnchors = tree.root.findAll(
        (node) => node.props?.testID === 'screen-deck-primary-cta' && (node.type as any) === 'View',
      );
      const gatePrimary = tree.root.findAll(
        (node) => node.props?.testID === 'deck-gate-primary-cta' && (node.type as any) === 'Pressable',
      );

      expect(routeRoots).toHaveLength(1);
      expect(primaryAnchors).toHaveLength(1);
      expect(gatePrimary).toHaveLength(1);

      const primaryText = gatePrimary[0].find(
        (node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
      );
      expect(primaryText.props.numberOfLines).toBe(1);
    },
  );

  it('renders an empty-state fallback CTA when no deck is available', async () => {
    viewportWidth = 360;
    loadActiveDeckSlugMock.mockResolvedValueOnce(null);
    listManifestDecksMock.mockResolvedValueOnce([]);

    const { tree, navigate } = await renderDeck(undefined);

    // In the empty state the primary CTA anchor sits on the Pressable itself
    // rather than on a wrapper View, so the host filter differs from the gate case.
    const routeRoots = tree.root.findAll(
      (node) => node.props?.testID === 'screen-deck-root' && (node.type as any) === 'SafeAreaView',
    );
    const primaryAnchors = tree.root.findAll(
      (node) => node.props?.testID === 'screen-deck-primary-cta' && (node.type as any) === 'Pressable',
    );
    const gatePrimary = tree.root.findAll(
      (node) => node.props?.testID === 'deck-gate-primary-cta' && (node.type as any) === 'Pressable',
    );

    expect(routeRoots).toHaveLength(1);
    expect(primaryAnchors).toHaveLength(1);
    expect(gatePrimary).toHaveLength(0);

    const textBlob = tree.root
      .findAll((node) => (node.type as any) === 'Text')
      .map((node) => {
        const children = node.props.children;
        return Array.isArray(children) ? children.join('') : String(children ?? '');
      })
      .join('\n');
    expect(textBlob).toContain('No deck ready yet');

    const emptyPrimary = tree.root.find(
      (node) => node.props?.testID === 'screen-deck-primary-cta' && (node.type as any) === 'Pressable',
    );
    const emptyPrimaryText = emptyPrimary.find(
      (node) => (node.type as any) === 'Text' && typeof node.props?.numberOfLines === 'number',
    );
    expect(emptyPrimaryText.props.numberOfLines).toBe(1);

    act(() => {
      emptyPrimary.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('Home');
  });
});
