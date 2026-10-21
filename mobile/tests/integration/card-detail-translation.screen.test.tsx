import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Card translations contract §5 on Card Detail: an owned card with a complete zh-CN translation
// gets the EN | 中文 toggle next to its slot; the question, the correct options and the answer
// sections switch, matched by option key, and the stored choice is the one the study screen uses.

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

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

// Choose two (a, c), stored order a, b, c, d.
const MCQ_CARD = {
  StableUid: 'aws-durable-copy-mcq',
  OrderInDeck: 1,
  Difficulty: 2,
  Question: 'A company must keep an undeletable copy of every object in a second Region. Which two actions meet this requirement? (Choose two.)',
  Explanation: 'Replication makes the second copy; compliance-mode Object Lock keeps anyone from deleting it.',
  Mcq: {
    v: 1,
    qualifier: null,
    shuffle: true,
    options: [
      { key: 'a', text: 'Turn on Cross-Region Replication with versioning.', why: null, correct: true },
      { key: 'b', text: 'Turn on Transfer Acceleration.', why: 'It speeds uploads and never copies to another Region.', correct: false },
      { key: 'c', text: 'Turn on Object Lock in compliance mode on the copy.', why: null, correct: true },
      { key: 'd', text: 'Add a bucket policy that denies deletes.', why: 'An administrator can edit or remove a policy.', correct: false },
    ],
  },
};

const MCQ_ZH = {
  v: 1,
  question: '公司必须在第二个区域为每个对象保留一份无法删除的副本。哪两项操作能满足这个要求？（选择两项。）',
  explanation: '复制负责产生第二份副本；合规模式的对象锁定让任何人都无法删除它。',
  mcq: {
    qualifier: null,
    options: {
      a: { text: '启用跨区域复制并开启版本控制。', why: null },
      b: { text: '启用传输加速。', why: '它只加快上传，从不把数据复制到其他区域。' },
      c: { text: '在副本上启用合规模式的对象锁定。', why: null },
      d: { text: '添加拒绝删除的存储桶策略。', why: '管理员可以修改或删除策略。' },
    },
  },
};

const CLAUDE_CARD = {
  StableUid: 'claude-tool-loop',
  OrderInDeck: 1,
  Difficulty: 1,
  Question: 'When does an agent loop stop calling tools?',
  Explanation: 'When the model returns a final answer with no tool call.',
};

const DECKS: Record<string, any> = {
  'aws-saa-c03': { Slug: 'aws-saa-c03', Title: 'AWS SAA-C03', Locale: 'en-US', Version: 'b1', DeckType: 1, TotalCards: 1, Cards: [MCQ_CARD] },
  'claude-ccdv-f': { Slug: 'claude-ccdv-f', Title: 'Claude', Locale: 'en-US', Version: 'b1', DeckType: 1, TotalCards: 1, Cards: [CLAUDE_CARD] },
};

const translations = new Map<string, Map<string, unknown>>([
  ['aws-saa-c03', new Map([[MCQ_CARD.StableUid, { 'zh-CN': MCQ_ZH }]])],
]);

vi.mock('../../src/content/activeDeck', () => ({ loadActiveDeckSlug: vi.fn(async () => 'aws-saa-c03') }));
vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    { slug: 'aws-saa-c03', title: 'AWS SAA-C03', locale: 'en-US', version: 'b1', deckType: 1, availability: 'live' },
    { slug: 'claude-ccdv-f', title: 'Claude', locale: 'en-US', version: 'b1', deckType: 1, availability: 'live' },
  ]),
  resolveDeckBySlug: vi.fn(async (slug: string) => DECKS[slug] ?? null),
}));
vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async (slug: string) => DECKS[slug] ?? null),
  invalidateDeckCache: () => {},
}));
// While `translationsGate` is set, every translations read waits on it (a slow file read).
let translationsGate: Promise<void> | null = null;
vi.mock('../../src/content/installedDeckIndex', () => ({
  getDeckTranslations: vi.fn(async (slug: string) => {
    if (translationsGate) await translationsGate;
    return translations.get(slug) ?? null;
  }),
  getInstalledDeckIndex: vi.fn(async () => null),
}));
vi.mock('../../src/review/storage', () => ({
loadDeckProgress: vi.fn(async () => []) }));
let ownedFixture: Set<string> | null = null;
vi.mock('../../src/features/gacha/draw/effectiveOwned', () => ({ resolveEffectiveOwned: vi.fn(async () => ownedFixture) }));

import { CardDetailScreen } from '../../src/screens/CardDetailScreen';
import { getCardLangSync, setCardLangPref } from '../../src/features/gacha/study/cardLangPrefs';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

function textOf(node: any): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node?.props?.children) return textOf(node.props.children);
  return '';
}

const texts = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => textOf(node.props.children));

const byTestId = (tree: renderer.ReactTestRenderer, testID: string) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID);

async function renderScreen(cardId: string) {
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
  await flush();
  return tree;
}

async function press(tree: renderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    byTestId(tree, testID)[0].props.onPress();
  });
  await flush();
}

const questionText = (tree: renderer.ReactTestRenderer) =>
  byTestId(tree, 'card-detail-question')[0]
    .findAll((n) => (n.type as any) === 'Text')
    .map((n) => textOf(n.props.children))
    .join('');

describe('CardDetailScreen — card translations', () => {
  beforeEach(async () => {
    store.clear();
    ownedFixture = new Set([MCQ_CARD.StableUid, CLAUDE_CARD.StableUid]);
    translationsGate = null;
    await setCardLangPref('en');
  });

  afterEach(async () => {
    await setCardLangPref('en');
  });

  it('switches the question, the correct options and the answer of an owned translated card', async () => {
    const tree = await renderScreen(MCQ_CARD.StableUid);
    expect(byTestId(tree, 'card-lang-toggle')).toHaveLength(1);
    expect(questionText(tree)).toBe(MCQ_CARD.Question);

    await press(tree, 'card-lang-toggle');
    expect(getCardLangSync()).toBe('zh-CN');
    expect(store.get('recallsmith:card-lang:v1')).toBe('zh-CN');
    expect(questionText(tree)).toBe(MCQ_ZH.question);
    const question = byTestId(tree, 'card-detail-question')[0].findAll((n) => (n.type as any) === 'Text')[0];
    expect(question.props.accessibilityLanguage).toBe('zh-CN');

    await press(tree, 'card-detail-show-answer');
    const correct = byTestId(tree, 'card-detail-mcq-correct')[0];
    // The correct options are the English card's (a, c), in stored order, with Chinese text.
    expect(correct.findAll((n) => (n.type as any) === 'Text').map((n) => textOf(n.props.children))).toEqual([
      '正确答案',
      MCQ_ZH.mcq.options.a.text,
      MCQ_ZH.mcq.options.c.text,
    ]);
    const all = texts(tree);
    expect(all).toContain('解析');
    expect(all).toContain(MCQ_ZH.explanation);
    expect(all).not.toContain('EXPLANATION');
    // The kind chip is chrome and stays English.
    expect(byTestId(tree, 'card-detail-kind-chip')[0].findAll((n) => (n.type as any) === 'Text').map((n) => textOf(n.props.children))).toEqual([
      'Multiple choice · pick 2',
    ]);

    await press(tree, 'card-lang-toggle');
    expect(questionText(tree)).toBe(MCQ_CARD.Question);
    expect(texts(tree)).toContain('CORRECT ANSWER');
    expect(texts(tree)).toContain(MCQ_CARD.Mcq.options[0].text);
  });

  it('shows no toggle for a card without a translation, whatever the preference', async () => {
    await setCardLangPref('zh-CN');
    const tree = await renderScreen(CLAUDE_CARD.StableUid);
    expect(byTestId(tree, 'card-lang-toggle')).toHaveLength(0);
    expect(questionText(tree)).toBe(CLAUDE_CARD.Question);
    await press(tree, 'card-detail-show-answer');
    expect(texts(tree)).toContain('EXPLANATION');
  });

  it('shows no toggle and no translated text on a locked card', async () => {
    await setCardLangPref('zh-CN');
    ownedFixture = new Set();
    const tree = await renderScreen(MCQ_CARD.StableUid);
    expect(byTestId(tree, 'card-lang-toggle')).toHaveLength(0);
    expect(questionText(tree)).toBe('Not in your collection yet');
    expect(texts(tree).join('\n')).not.toContain('公司');
  });

  // Review fix (2026-10-18): the translations are read from the deck file after the card is found,
  // so the first frames used to show the English card to a learner who chose 中文.
  it('keeps the skeleton until the translations are read when the learner chose 中文', async () => {
    await setCardLangPref('zh-CN');
    let open!: () => void;
    translationsGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const tree = await renderScreen(MCQ_CARD.StableUid);
    expect(byTestId(tree, 'card-detail-skeleton')).toHaveLength(1);
    expect(byTestId(tree, 'card-detail-question')).toHaveLength(0);
    expect(texts(tree).join('\n')).not.toContain(MCQ_CARD.Question);

    await act(async () => {
      open();
    });
    await flush();
    expect(byTestId(tree, 'card-detail-skeleton')).toHaveLength(0);
    expect(questionText(tree)).toBe(MCQ_ZH.question);
    expect(byTestId(tree, 'card-lang-toggle')).toHaveLength(1);
  });

  it('shows a Chinese learner an untranslated card in English once the read finds none', async () => {
    await setCardLangPref('zh-CN');
    let open!: () => void;
    translationsGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const tree = await renderScreen(CLAUDE_CARD.StableUid);
    expect(byTestId(tree, 'card-detail-skeleton')).toHaveLength(1);
    await act(async () => {
      open();
    });
    await flush();
    expect(questionText(tree)).toBe(CLAUDE_CARD.Question);
    expect(byTestId(tree, 'card-lang-toggle')).toHaveLength(0);
  });

  it('never makes an English learner wait for the translations', async () => {
    let open!: () => void;
    translationsGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const tree = await renderScreen(MCQ_CARD.StableUid);
    expect(byTestId(tree, 'card-detail-skeleton')).toHaveLength(0);
    expect(questionText(tree)).toBe(MCQ_CARD.Question);
    expect(byTestId(tree, 'card-lang-toggle')).toHaveLength(0);

    await act(async () => {
      open();
    });
    await flush();
    expect(questionText(tree)).toBe(MCQ_CARD.Question);
    expect(byTestId(tree, 'card-lang-toggle')).toHaveLength(1);
  });

  it('does not hold a locked card back for its translations', async () => {
    await setCardLangPref('zh-CN');
    ownedFixture = new Set();
    translationsGate = new Promise<void>(() => {});
    const tree = await renderScreen(MCQ_CARD.StableUid);
    expect(byTestId(tree, 'card-detail-skeleton')).toHaveLength(0);
    expect(questionText(tree)).toBe('Not in your collection yet');
    act(() => tree.unmount());
  });
});
