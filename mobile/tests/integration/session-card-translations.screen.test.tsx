vi.mock('expo-crypto', () => ({ randomUUID: () => 'review-intent-id' }));
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateDeckCache } from '../../src/content/deckCache';

// Card translations contract §5 on the study screen: a card that ships a complete zh-CN translation
// gets the EN | 中文 toggle in the header; the toggle swaps the text on screen and nothing else.
// The shown order, the picks, the verdict, the rating and every write keep using the English card.

beforeEach(() => {
  invalidateDeckCache();
});

vi.mock('react-native', () => {
  const React = require('react');
  class MockAnimatedValue {
    value: number;
    constructor(value: number) {
      this.value = value;
    }
    interpolate(config: any) {
      return config.outputRange?.[0] ?? this.value;
    }
    setValue(value: number) {
      this.value = value;
    }
    stopAnimation() {}
  }
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
    Animated: {
      View: ({ children, ...props }: any) => React.createElement('AnimatedView', props, children),
      Value: MockAnimatedValue,
      spring: (_value: any, _config: any) => ({ start: (cb?: any) => cb?.() }),
    },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Alert: { alert: vi.fn() },
    StyleSheet: { create: (styles: any) => styles },
    AccessibilityInfo: { announceForAccessibility: vi.fn() },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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

vi.mock('../../src/components/CodeBlock', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('View', null, React.createElement('Text', null, 'CodeBlock')),
  };
});

const featureFlagsMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/config/featureFlags', () => ({
  useFeatureFlags: () => featureFlagsMock(),
  getFeatureFlags: () => featureFlagsMock(),
  isFsrsEnabled: () => featureFlagsMock()?.fsrs?.enabled !== false,
}));

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => store.delete(key));
    }),
  },
}));

vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async () => null),
  listManifestDecks: vi.fn(async () => []),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => true),
}));

// The installed deck reader: the translations each test installs, by deck slug. While
// `translationsGate` is set, every read waits on it (a slow file read).
const translationsBySlug = new Map<string, Map<string, unknown>>();
let translationsGate: Promise<void> | null = null;
vi.mock('../../src/content/installedDeckIndex', () => ({
  getDeckTranslations: vi.fn(async (slug: string) => {
    if (translationsGate) await translationsGate;
    return translationsBySlug.get(slug) ?? null;
  }),
  getInstalledDeckIndex: vi.fn(async () => null),
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'aws-saa-c03'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/review/storage', () => ({
  captureProgressUserSub: vi.fn(async () => 'anon'),
  updateDeckProgress: vi.fn(async (deck: any, update: any, sub?: string) => {
    const storage = await import('../../src/review/storage');
    const fresh = await storage.loadDeckProgress(deck, sub);
    const next = await update(fresh);
    if (next !== fresh) await storage.saveDeckProgress(deck, next, sub);
    vi.mocked(storage.loadDeckProgress).mockResolvedValue(next);
    return next;
  }),
  loadDeckProgress: vi.fn(async () => []),
  saveDeckProgress: vi.fn(async () => {}),
  loadOrInitDailyStats: vi.fn(async () => ({ dateKey: '2026-10-18', plannedCount: 0, doneCount: 0 })),
}));

vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: vi.fn(async () => {}),
}));

vi.mock('../../src/sync/progressSync', () => ({
  recordReviewEvent: vi.fn(async () => 'evt-1'),
  scheduleProgressSync: vi.fn(async () => {}),
  applyCachedRemoteProgress: vi.fn(async () => {}),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(),
}));

vi.mock('../../src/premium/revenuecat', () => ({
  rcGetCustomerInfoSafe: vi.fn(async () => null),
  isPremiumActive: vi.fn(() => false),
}));

vi.mock('../../src/features/gacha/mistakes/mistakeBook', () => ({
  recordMistakeOutcome: vi.fn(async () => {}),
}));

vi.mock('../../src/features/gacha/session/sessionReviewHelpers', () => ({
  buildRatedSessionState: vi.fn((input: any) => ({
    updatedProgress: [{ stableUid: input.current.card.StableUid, stage: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 60000 }],
    updatedOne: { stableUid: input.current.card.StableUid, stage: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 60000, lastSeenRevision: 1 },
    nextDone: 1,
    nextCurrent: null,
    prevLearnedCount: 0,
    remainingDueCount: 0,
  })),
  buildSessionProgressVM: vi.fn(() => ({ title: 'Session progress', subtitle: 'Card 1 of 1', progressText: '0 / 1', hint: '0 due', percent: 0, currentRoleLabel: null })),
  modeLabel: vi.fn(() => 'Mixed'),
}));

vi.mock('../../src/features/gacha/session/reviewContentHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/gacha/session/reviewContentHelpers')>();
  return {
    ...actual,
    buildCardMap: vi.fn(() => new Map()),
    showTrialUpsellDialog: vi.fn(),
    sortCards: vi.fn((deck: any) => deck.Cards ?? []),
  };
});

vi.mock('../../src/features/gacha/planner/sessionPlanner', () => ({
  countDueToday: vi.fn(() => 0),
  pickNextCard: vi.fn(() => null),
  planChallengeRoute: vi.fn(() => ({
    slug: 'aws-saa-c03',
    deckTitle: 'AWS SAA-C03',
    mode: 'mixed',
    limit: 1,
    minimumGoal: 1,
    dueCount: 0,
    newCount: 1,
    nodes: [{ id: 'warmup-0', role: 'warmup', title: '', subtitle: 'Start.' }],
    summary: 'AWS SAA-C03',
  })),
}));

vi.mock('../../src/features/gacha/rewards/sessionRewards', () => ({
  settleRatingReward: vi.fn(async () => ({
    newCardPaid: false,
    dueClearPaid: false,
    pulls: 0,
    walletBefore: null,
    walletAfter: null,
    applied: null,
    newCardsLearnedToday: 0,
  })),
}));

import { SessionCardScreen } from '../../src/screens/SessionCardScreen';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { loadDeckProgress, saveDeckProgress } from '../../src/review/storage';
import { recordReviewEvent } from '../../src/sync/progressSync';
import { pickNextCard } from '../../src/features/gacha/planner/sessionPlanner';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';
import { recordMistakeOutcome } from '../../src/features/gacha/mistakes/mistakeBook';
import { resetSessionStore } from '../../src/features/gacha/session/sessionStore';
import { getCardLangSync, loadCardLangPref, setCardLangPref } from '../../src/features/gacha/study/cardLangPrefs';

const FIXED_NOW_MS = Date.UTC(2026, 9, 18, 9, 0, 0);
const CARD_LANG_KEY = 'recallsmith:card-lang:v1';

function flags() {
  return {
    mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false },
    paywall: { hidden: false },
    ceremony: { seamOfLight: true, forceFallback: false },
    cardSource: { enabled: false },
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');

function getTextContent(node: any): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (node?.props?.children) return getTextContent(node.props.children);
  return '';
}

const idText = (tree: renderer.ReactTestRenderer, id: string) => getTextContent(byTestID(tree, id)[0]);

const renderedOrder = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props?.testID === 'string' &&
        /^mcq-option-[a-f]$/.test(node.props.testID),
    )
    .map((node) => node.props.testID.slice('mcq-option-'.length));

const allText = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as any) === 'Text').map((node) => getTextContent(node.props.children));

// An original MCQ (choose one, correct b) and its built-in Chinese translation.
const MCQ_EN = {
  StableUid: 'aws-burst-buffer-mcq',
  Revision: 2,
  Question:
    'A web tier hands every upload to a processing fleet that falls behind at peak times, and uploads are lost. The company wants every upload kept until it is processed, with the LEAST operational overhead. Which design meets these requirements?',
  Explanation: 'Put a queue between the web tier and the fleet, and scale the fleet on queue depth.',
  RealWorldUsage: 'A photo app writes each upload job to a queue and resizes images in the background.',
  Difficulty: 2,
  OrderInDeck: 40,
  Mcq: {
    v: 1,
    qualifier: 'LEAST operational overhead',
    shuffle: true,
    options: [
      { key: 'a', text: 'Move the fleet to larger instance types.', why: 'Larger instances still fall behind at a high enough peak.', correct: false },
      { key: 'b', text: 'Send each upload job to an Amazon SQS queue and scale the fleet on queue depth.', why: null, correct: true },
      { key: 'c', text: 'Write the jobs to a single-shard stream.', why: 'One shard caps the write rate and needs resharding by hand.', correct: false },
      { key: 'd', text: 'Insert the jobs into a database table that the fleet polls.', why: 'Polling turns the database into a queue and couples the tiers.', correct: false },
    ],
  },
};

const MCQ_ZH = {
  v: 1,
  question:
    'Web 层把每次上传交给一组处理实例，高峰期处理不过来，上传会丢失。公司希望每次上传在处理前都被保留，并且运维开销最低。哪种设计满足这些要求？',
  explanation: '在 Web 层和处理实例之间放一个队列，并按队列深度扩展处理实例。',
  realWorldUsage: '一个照片应用把每个上传任务写进队列，在后台缩放图片。',
  mcq: {
    qualifier: '运维开销最低',
    options: {
      a: { text: '把处理实例换成更大的实例类型。', why: '高峰足够高时，更大的实例也会落后。' },
      b: { text: '把每个上传任务发到 Amazon SQS 队列，并按队列深度扩展处理实例。', why: null },
      c: { text: '把任务写进单分片的流。', why: '单分片限制写入速率，还要手动重新分片。' },
      d: { text: '把任务插入数据库表，让处理实例轮询。', why: '轮询把数据库变成了队列，两层也耦合在一起。' },
    },
  },
};

const QA_EN = {
  StableUid: 'aws-s3-ia-qa',
  Revision: 1,
  Question: 'Which S3 storage class fits data that is read about once a quarter?',
  Explanation: 'S3 Standard-IA: lower storage price, a per-GB retrieval fee.',
  RealWorldUsage: '',
  Difficulty: 1,
  OrderInDeck: 3,
};

const QA_ZH = {
  v: 1,
  question: '每季度大约读取一次的数据适合哪种 S3 存储类别？',
  explanation: 'S3 Standard-IA：存储价格更低，按 GB 收取检索费。',
};

function deckOf(cards: any[], overrides: Record<string, unknown> = {}) {
  return { Slug: 'aws-saa-c03', Title: 'AWS SAA-C03', Locale: 'en-US', Version: 'b1', DeckType: 1, TotalCards: cards.length, Cards: cards, ...overrides };
}

const NEW_PROGRESS = (uid: string) => ({ stableUid: uid, stage: 0, nextReviewAt: 0 });
const DUE_PROGRESS = (uid: string) => ({
  stableUid: uid,
  stage: 1,
  lastReviewedAt: FIXED_NOW_MS - 86_400_000,
  nextReviewAt: FIXED_NOW_MS - 1,
  hardStreak: 0,
});

function serve(deck: any, card: any, progress: any, translations: Record<string, unknown> | null) {
  vi.mocked(resolveDeckBySlug).mockResolvedValue(deck);
  vi.mocked(pickNextCard).mockReturnValue({ card, progress } as any);
  vi.mocked(loadDeckProgress).mockResolvedValue([progress] as any);
  translationsBySlug.clear();
  if (translations) {
    translationsBySlug.set(
      deck.Slug,
      new Map(Object.entries(translations).map(([uid, entry]) => [uid, { 'zh-CN': entry }])),
    );
  }
}

async function mount(slug = 'aws-saa-c03') {
  const navigation = { navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } as any;
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <SessionCardScreen
        navigation={navigation}
        route={{ key: 'session-card', name: 'SessionCard', params: { slug, mode: 'mixed', limit: 1 } } as any}
      />,
    );
  });
  await flush();
  await flush();
  return { tree, navigation };
}

async function press(tree: renderer.ReactTestRenderer, id: string) {
  await act(async () => {
    byTestID(tree, id)[0].props.onPress();
    await Promise.resolve();
  });
  await flush();
}

describe('SessionCardScreen card translations', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    store.clear();
    translationsBySlug.clear();
    translationsGate = null;
    resetSessionStore();
    await setCardLangPref('en');
    featureFlagsMock.mockReturnValue(flags());
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW_MS);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('switches an MCQ card to Chinese and back without touching the order, the picks or the verdict', async () => {
    serve(deckOf([MCQ_EN]), MCQ_EN, NEW_PROGRESS(MCQ_EN.StableUid), { [MCQ_EN.StableUid]: MCQ_ZH });
    const { tree, navigation } = await mount();

    // English by default, with the toggle in the header.
    const toggle = byTestID(tree, 'card-lang-toggle');
    expect(toggle).toHaveLength(1);
    expect(toggle[0].props.accessibilityRole).toBe('switch');
    expect(toggle[0].props.accessibilityState).toEqual({ checked: false });
    expect(idText(tree, 'mcq-stem')).toContain('LEAST operational overhead');
    expect(byTestID(tree, 'mcq-stem')[0].props.accessibilityLanguage).toBeUndefined();

    await press(tree, 'mcq-show-options');
    const englishOrder = renderedOrder(tree);
    expect(englishOrder.slice().sort()).toEqual(['a', 'b', 'c', 'd']);

    await press(tree, 'card-lang-toggle');
    expect(byTestID(tree, 'card-lang-toggle')[0].props.accessibilityState).toEqual({ checked: true });
    expect(getCardLangSync()).toBe('zh-CN');
    expect(store.get(CARD_LANG_KEY)).toBe('zh-CN');
    // The ask (with the qualifier) in Chinese, spoken as Chinese; the same option sequence.
    expect(idText(tree, 'mcq-stem')).toContain('哪种设计满足这些要求？');
    expect(idText(tree, 'mcq-qualifier')).toBe('运维开销最低');
    expect(byTestID(tree, 'mcq-stem')[0].props.accessibilityLanguage).toBe('zh-CN');
    expect(renderedOrder(tree)).toEqual(englishOrder);
    expect(idText(tree, 'mcq-option-text-b')).toBe(MCQ_ZH.mcq.options.b.text);
    expect(byTestID(tree, 'mcq-option-text-b')[0].props.accessibilityLanguage).toBe('zh-CN');
    expect(byTestID(tree, 'mcq-option-b')[0].props.accessibilityLabel).toMatch(/^选项 [A-D]，共 4 项：/);
    // The app chrome stays English.
    expect(idText(tree, 'mcq-submit-sure')).toBe('Sure');

    // A pick made in Chinese survives a switch back to English: picks are option keys.
    await press(tree, 'mcq-option-b');
    expect(byTestID(tree, 'mcq-option-b')[0].props.accessibilityState).toEqual({ checked: true });
    await press(tree, 'card-lang-toggle');
    expect(idText(tree, 'mcq-option-text-b')).toBe(MCQ_EN.Mcq.options[1].text);
    expect(byTestID(tree, 'mcq-option-b')[0].props.accessibilityState).toEqual({ checked: true });
    expect(renderedOrder(tree)).toEqual(englishOrder);
    await press(tree, 'card-lang-toggle');

    await press(tree, 'mcq-submit-sure');
    expect(idText(tree, 'mcq-verdict-banner')).toBe('Correct');
    expect(renderedOrder(tree)).toEqual(englishOrder);
    // In-card labels follow the card's language; the why of a wrong option is the Chinese one.
    const texts = allText(tree);
    expect(texts).toEqual(expect.arrayContaining(['解析', '为什么看限定词', '实际应用']));
    expect(texts).not.toContain('EXPLANATION');
    expect(texts).toContain(MCQ_ZH.explanation);
    await press(tree, 'mcq-why-toggle-a');
    expect(idText(tree, 'mcq-why-a')).toBe(MCQ_ZH.mcq.options.a.why);

    await press(tree, 'mcq-next');
    // Every write is about the English card: same uid, revision and the rating a correct, sure,
    // first answer earns in English.
    expect(recordReviewEvent).toHaveBeenCalledTimes(1);
    expect(recordReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({ stableUid: MCQ_EN.StableUid, rating: 'good', reviewStage: 'first_review', cardRevision: 2 }),
    );
    const rated = vi.mocked(buildRatedSessionState).mock.calls[0][0] as any;
    expect(rated.current.card).toBe(MCQ_EN);
    expect(rated.rating).toBe('good');
    expect(recordMistakeOutcome).toHaveBeenCalledWith(expect.objectContaining({ stableUid: MCQ_EN.StableUid, mcqVerdict: 'correct' }), 'anon');
    expect(saveDeckProgress).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith('SessionSummary', expect.objectContaining({ picks: { landed: 1, answered: 1 } }));
  });

  it('gives the same verdict and rating as an English run of the same answer', async () => {
    const run = async (lang: 'en' | 'zh-CN') => {
      vi.clearAllMocks();
      resetSessionStore();
      await setCardLangPref(lang);
      serve(deckOf([MCQ_EN]), MCQ_EN, NEW_PROGRESS(MCQ_EN.StableUid), { [MCQ_EN.StableUid]: MCQ_ZH });
      const { tree } = await mount();
      await press(tree, 'mcq-show-options');
      const order = renderedOrder(tree);
      await press(tree, 'mcq-option-c');
      await press(tree, 'mcq-submit-unsure');
      const banner = idText(tree, 'mcq-verdict-banner');
      await press(tree, 'mcq-next');
      const event = vi.mocked(recordReviewEvent).mock.calls[0][0] as any;
      act(() => tree.unmount());
      return { order, banner, rating: event.rating, uid: event.stableUid, stem: lang };
    };
    const english = await run('en');
    const chinese = await run('zh-CN');
    expect(chinese.order).toEqual(english.order);
    expect(chinese.banner).toBe(english.banner);
    expect(chinese.banner).toBe('Not this time');
    expect(chinese.rating).toBe(english.rating);
    expect(chinese.uid).toBe(english.uid);
  });

  it('opens a translated card in the remembered language', async () => {
    store.set(CARD_LANG_KEY, 'zh-CN');
    await loadCardLangPref();
    serve(deckOf([MCQ_EN]), MCQ_EN, NEW_PROGRESS(MCQ_EN.StableUid), { [MCQ_EN.StableUid]: MCQ_ZH });
    const { tree } = await mount();
    expect(byTestID(tree, 'card-lang-toggle')[0].props.accessibilityState).toEqual({ checked: true });
    expect(idText(tree, 'mcq-stem')).toContain('运维开销最低');
  });

  it('shows no toggle on a deck without translations (Claude) and keeps it English whatever the preference', async () => {
    await setCardLangPref('zh-CN');
    const claudeCard = { ...MCQ_EN, StableUid: 'claude-tool-use-mcq' };
    serve(deckOf([claudeCard], { Slug: 'claude-ccdv-f', Title: 'Claude CCDV-F' }), claudeCard, NEW_PROGRESS(claudeCard.StableUid), null);
    const { tree } = await mount('claude-ccdv-f');
    expect(byTestID(tree, 'card-lang-toggle')).toHaveLength(0);
    expect(idText(tree, 'mcq-stem')).toContain('LEAST operational overhead');
    expect(byTestID(tree, 'mcq-stem')[0].props.accessibilityLanguage).toBeUndefined();
    await press(tree, 'mcq-show-options');
    await press(tree, 'mcq-option-b');
    await press(tree, 'mcq-submit-sure');
    expect(allText(tree)).toContain('EXPLANATION');
  });

  it('shows no toggle and the English card when the translation is incomplete', async () => {
    await setCardLangPref('zh-CN');
    const { d: _d, ...threeOptions } = MCQ_ZH.mcq.options;
    serve(deckOf([MCQ_EN]), MCQ_EN, NEW_PROGRESS(MCQ_EN.StableUid), {
      [MCQ_EN.StableUid]: { ...MCQ_ZH, mcq: { ...MCQ_ZH.mcq, options: threeOptions } },
    });
    const { tree } = await mount();
    expect(byTestID(tree, 'card-lang-toggle')).toHaveLength(0);
    expect(idText(tree, 'mcq-stem')).toContain('LEAST operational overhead');
    await press(tree, 'mcq-show-options');
    expect(idText(tree, 'mcq-option-text-b')).toBe(MCQ_EN.Mcq.options[1].text);
  });

  it('shows no toggle on a deck whose own locale is Chinese', async () => {
    await setCardLangPref('zh-CN');
    serve(deckOf([QA_EN], { Slug: 'aws-saa-fundamentals', Locale: 'zh-CN' }), QA_EN, DUE_PROGRESS(QA_EN.StableUid), {
      [QA_EN.StableUid]: QA_ZH,
    });
    const { tree } = await mount('aws-saa-fundamentals');
    expect(byTestID(tree, 'card-lang-toggle')).toHaveLength(0);
    expect(idText(tree, 'review-question')).toBe(QA_EN.Question);
  });

  it('switches a Q/A review card, its answer labels and the key-line hint', async () => {
    const card = { ...QA_EN, Explanation: '答：S3 Standard-IA。\nIt has a lower storage price and a per-GB retrieval fee.' };
    const zh = { ...QA_ZH, explanation: '答：S3 Standard-IA。\n存储价格更低，按 GB 收取检索费。' };
    serve(deckOf([card]), card, DUE_PROGRESS(card.StableUid), { [card.StableUid]: zh });
    const { tree } = await mount();
    expect(idText(tree, 'review-question')).toBe(card.Question);

    await press(tree, 'card-lang-toggle');
    expect(idText(tree, 'review-question')).toBe(zh.question);
    expect(byTestID(tree, 'review-question')[0].props.accessibilityLanguage).toBe('zh-CN');

    await act(async () => {
      tree.root.find((node) => (node.type as any) === 'Pressable' && getTextContent(node.props.children) === 'Reveal answer').props.onPress();
    });
    await flush();
    const texts = allText(tree);
    // The recap caption above the question is in-card text too.
    expect(texts).toContain('题目');
    expect(texts).not.toContain('QUESTION');
    expect(tree.root.find((node) => (node.type as any) === 'Text' && node.props.children === '题目').props.accessibilityLanguage).toBe('zh-CN');
    expect(texts).toContain('解析');
    expect(texts).not.toContain('EXPLANATION');
    expect(byTestID(tree, 'answer-key-line')).toHaveLength(1);
    expect(texts).toContain('答：S3 Standard-IA。');
    expect(texts).toContain('存储价格更低，按 GB 收取检索费。');
  });

  it('switches the study view of a new Q/A card', async () => {
    serve(deckOf([QA_EN]), QA_EN, NEW_PROGRESS(QA_EN.StableUid), { [QA_EN.StableUid]: QA_ZH });
    const { tree } = await mount();
    expect(byTestID(tree, 'learning-study-view')).toHaveLength(1);
    expect(idText(tree, 'learning-study-question')).toBe(QA_EN.Question);

    await press(tree, 'card-lang-toggle');
    expect(idText(tree, 'learning-study-question')).toBe(QA_ZH.question);
    await press(tree, 'learning-study-show-answer');
    expect(allText(tree)).toContain(QA_ZH.explanation);
    expect(allText(tree)).toContain('解析');
    await press(tree, 'learning-study-got-it');
    expect(recordReviewEvent).toHaveBeenCalledWith(
      expect.objectContaining({ stableUid: QA_EN.StableUid, rating: 'hard', reviewStage: 'learning_study' }),
    );
  });

  // Review fix (2026-10-18): the translations are read from the deck file after the deck itself, so
  // the first frames used to show the English card to a learner who chose 中文.
  it('holds the card back until the translations are read when the learner chose 中文', async () => {
    await setCardLangPref('zh-CN');
    let open!: () => void;
    translationsGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    serve(deckOf([MCQ_EN]), MCQ_EN, NEW_PROGRESS(MCQ_EN.StableUid), { [MCQ_EN.StableUid]: MCQ_ZH });
    const { tree } = await mount();

    // The deck and the card are ready; the loading view stays up and no card text is on screen.
    expect(pickNextCard).toHaveBeenCalled();
    expect(byTestID(tree, 'session-card-loading-text')).toHaveLength(1);
    expect(byTestID(tree, 'mcq-stem')).toHaveLength(0);
    expect(allText(tree).join('\n')).not.toContain('LEAST operational overhead');

    await act(async () => {
      open();
    });
    await flush();
    expect(byTestID(tree, 'session-card-loading-text')).toHaveLength(0);
    expect(idText(tree, 'mcq-stem')).toContain('运维开销最低');
    expect(allText(tree).join('\n')).not.toContain('LEAST operational overhead');
    expect(byTestID(tree, 'card-lang-toggle')[0].props.accessibilityState).toEqual({ checked: true });
  });

  it('shows a Chinese learner the English card once the read finds no translation', async () => {
    await setCardLangPref('zh-CN');
    let open!: () => void;
    translationsGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const claudeCard = { ...MCQ_EN, StableUid: 'claude-tool-use-mcq' };
    serve(deckOf([claudeCard], { Slug: 'claude-ccdv-f', Title: 'Claude CCDV-F' }), claudeCard, NEW_PROGRESS(claudeCard.StableUid), null);
    const { tree } = await mount('claude-ccdv-f');
    expect(byTestID(tree, 'session-card-loading-text')).toHaveLength(1);

    await act(async () => {
      open();
    });
    await flush();
    expect(byTestID(tree, 'card-lang-toggle')).toHaveLength(0);
    expect(idText(tree, 'mcq-stem')).toContain('LEAST operational overhead');
  });

  it('never makes an English learner wait for the translations', async () => {
    let open!: () => void;
    translationsGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    serve(deckOf([MCQ_EN]), MCQ_EN, NEW_PROGRESS(MCQ_EN.StableUid), { [MCQ_EN.StableUid]: MCQ_ZH });
    const { tree } = await mount();

    // The card is on screen in English before the read lands; the toggle comes with the translation.
    expect(byTestID(tree, 'session-card-loading-text')).toHaveLength(0);
    expect(idText(tree, 'mcq-stem')).toContain('LEAST operational overhead');
    expect(byTestID(tree, 'card-lang-toggle')).toHaveLength(0);

    await act(async () => {
      open();
    });
    await flush();
    expect(idText(tree, 'mcq-stem')).toContain('LEAST operational overhead');
    expect(byTestID(tree, 'card-lang-toggle')[0].props.accessibilityState).toEqual({ checked: false });
  });
});
