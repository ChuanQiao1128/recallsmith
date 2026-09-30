import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    // CodeBlock (rendered when a code card's answer is open) reads Platform.
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (styles: any) => styles },
    Modal: ({ children, ...props }: any) => React.createElement('Modal', props, children),
    TextInput: ({ children, ...props }: any) => React.createElement('TextInput', props, children),
    Linking: { openURL: vi.fn(async () => undefined) },
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

const CSHARP_DECK = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 3,
  Cards: [
    {
      StableUid: 'cs-sourced',
      OrderInDeck: 1,
      Difficulty: 2,
      Question: 'What does a using statement do?',
      Explanation: 'It disposes the resource at the end of the block.',
    },
    { StableUid: 'cs-plain', OrderInDeck: 2, Difficulty: 1, Question: 'A card without a source', Explanation: 'Plain.' },
    { StableUid: 'cs-locked', OrderInDeck: 3, Difficulty: 1, Question: 'A locked C# question' },
  ],
};

const DECKS: Record<string, any> = { csharp: CSHARP_DECK };

const SOURCE_URL = 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/using';
const SOURCES: Record<string, { url: string; quote: string | null }> = {
  'cs-sourced': { url: SOURCE_URL, quote: 'The using statement ensures the correct use of an IDisposable instance.' },
  'cs-locked': { url: 'https://learn.microsoft.com/en-us/dotnet/locked', quote: 'Locked quote text.' },
};

let ownedFixture: Set<string> | null = null;

vi.mock('../../src/content/activeDeck', () => ({ loadActiveDeckSlug: vi.fn(async () => 'csharp') }));
vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    { slug: 'csharp', title: 'C# Interview', locale: 'en-US', version: '1', deckType: 1, availability: 'live' },
  ]),
  resolveDeckBySlug: vi.fn(async (slug: string) => DECKS[slug] ?? null),
}));
vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async (slug: string) => DECKS[slug] ?? null),
  invalidateDeckCache: () => {},
}));
vi.mock('../../src/review/storage', () => ({ loadDeckProgress: vi.fn(async () => []) }));
vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({ resolveEffectiveOwned: vi.fn(async () => ownedFixture) }));
vi.mock('../../src/content/cardSource', () => ({
  getCardSource: vi.fn(async (_slug: string, uid: string) => SOURCES[uid] ?? null),
  sourceHostLabel: vi.fn((url: string) => (/^https:\/\/(?:www\.)?([^/:?#]+)/.exec(url)?.[1] ?? '').toLowerCase()),
}));

vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));
vi.mock('../../src/auth/freshToken', () => ({ getFreshAccessToken: vi.fn(async () => 'tok-1') }));

import { CardDetailScreen } from '../../src/screens/CardDetailScreen';
import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';
import { CHROME_MAX_FONT_SCALE } from '../../src/theme/dynamicType';

const flagOn = () => applyRemoteFeatures({ features: { cardReport: { enabled: true } } } as unknown as RemoteConfig);

beforeEach(() => {
  ownedFixture = null;
});

afterEach(() => {
  applyRemoteFeatures(null);
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

function byTestId(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID);
}

async function renderScreen(cardId: string): Promise<renderer.ReactTestRenderer> {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() };
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <CardDetailScreen
        navigation={navigation as any}
        route={{ key: 'k', name: 'CardDetail', params: { cardId } } as any}
      />,
    );
  });
  await flush();
  return tree;
}

async function press(tree: renderer.ReactTestRenderer, testID: string) {
  const node = byTestId(tree, testID)[0];
  await act(async () => {
    node.props.onPress();
  });
  await flush();
}

describe('CardDetailScreen — report a problem', () => {
  it('shows the Report a problem row after the Source row when the flag is on', async () => {
    flagOn();
    ownedFixture = new Set(['cs-sourced']);
    const tree = await renderScreen('cs-sourced');
    expect(byTestId(tree, 'card-detail-report')).toHaveLength(0);
    await press(tree, 'card-detail-show-answer');

    const answer = byTestId(tree, 'card-detail-answer')[0];
    const ids = answer
      .findAll((n) => typeof n.type === 'string' && typeof n.props?.testID === 'string')
      .map((n) => n.props.testID as string);
    expect(ids).toContain('card-detail-report');
    expect(ids.indexOf('card-detail-report')).toBeGreaterThan(ids.indexOf('card-detail-source'));

    const row = byTestId(tree, 'card-detail-report')[0];
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe('Report a problem with this card');
    expect(typeof row.props.accessibilityHint).toBe('string');
    const rawStyle = typeof row.props.style === 'function' ? row.props.style({ pressed: false }) : row.props.style;
    const style = Object.assign({}, ...[rawStyle].flat(Infinity).filter(Boolean));
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    const label = row.findAll((n) => (n.type as unknown) === 'Text')[0];
    expect(label.props.children).toBe('Report a problem');
    expect(label.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
  });

  it('opens the report sheet for this card without navigating', async () => {
    flagOn();
    ownedFixture = new Set(['cs-plain']);
    const tree = await renderScreen('cs-plain');
    await press(tree, 'card-detail-show-answer');
    expect(byTestId(tree, 'report-card-sheet')).toHaveLength(0);
    await press(tree, 'card-detail-report');
    expect(byTestId(tree, 'report-card-sheet')).toHaveLength(1);
    expect(byTestId(tree, 'report-reason-wrong_answer')).toHaveLength(1);
    await press(tree, 'report-card-cancel');
    expect(byTestId(tree, 'report-card-sheet')).toHaveLength(0);
  });

  it('hides the row when the flag is off (the default)', async () => {
    ownedFixture = new Set(['cs-sourced']);
    const tree = await renderScreen('cs-sourced');
    await press(tree, 'card-detail-show-answer');
    expect(byTestId(tree, 'card-detail-answer')).toHaveLength(1);
    expect(byTestId(tree, 'card-detail-report')).toHaveLength(0);
  });

  it('hides the row on a locked card even with the flag on', async () => {
    flagOn();
    ownedFixture = new Set(['cs-sourced']);
    const tree = await renderScreen('cs-locked');
    expect(byTestId(tree, 'card-detail-show-answer')).toHaveLength(0);
    expect(byTestId(tree, 'card-detail-report')).toHaveLength(0);
  });
});
