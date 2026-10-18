// The api layer's half of card translations (contract §1, §4): what
// src/api/authoring.ts keeps from the wire for a card (translations,
// translationStatus) and a deck (translationLocales), what updateDeck sends,
// and what src/api/cardReports.ts keeps of a report's displayLocale. An older
// server that sends none of these keys must come back exactly as before.
// src/api/http is replaced wholesale, so nothing here can leave the process.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CardTranslations } from '../src/types/translation';

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const authoring = await import('../src/api/authoring');
const reports = await import('../src/api/cardReports');

const ZH: CardTranslations = {
  'zh-CN': { v: 1, question: '哪种 S3 存储类别最便宜？', explanation: 'S3 Glacier Flexible Retrieval。' },
};

function envelope(data: unknown) {
  return { data: { success: true, data, error: null, traceId: 't' } };
}

const WIRE_CARD = {
  id: 1,
  deckId: 7,
  stableUid: 'saa-001',
  question: 'Which S3 class is cheapest?',
  difficulty: 2,
  orderInDeck: 5,
  version: 3,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const WIRE_DECK = {
  id: 7,
  slug: 'aws-saa-c03',
  title: 'AWS SAA-C03',
  author: 'console-tests',
  locale: 'en-US',
  deckType: 2,
  version: 3,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  for (const fn of Object.values(httpMock)) fn.mockReset();
});

describe('cards: translations and translationStatus', () => {
  it('keeps the translations object and only the ok / stale verdicts', async () => {
    httpMock.get.mockResolvedValueOnce(
      envelope([{ ...WIRE_CARD, translations: ZH, translationStatus: { 'zh-CN': 'stale', 'ja': 'maybe' } }]),
    );
    const res = await authoring.fetchCardById(1);
    expect(res.data?.translations).toEqual(ZH);
    expect(res.data?.translationStatus).toEqual({ 'zh-CN': 'stale' });
  });

  it('turns a non-object translations into null, and leaves both keys off a card from an older server', async () => {
    httpMock.get.mockResolvedValueOnce(envelope([{ ...WIRE_CARD, translations: 'oops', translationStatus: null }]));
    const broken = await authoring.fetchCardById(1);
    expect(broken.data?.translations).toBeNull();
    expect(broken.data?.translationStatus).toBeNull();

    httpMock.get.mockResolvedValueOnce(envelope([WIRE_CARD]));
    const old = await authoring.fetchCardById(1);
    expect(Object.hasOwn(old.data!, 'translations')).toBe(false);
    expect(Object.hasOwn(old.data!, 'translationStatus')).toBe(false);
  });

  it('importCardsBatch forwards translations as given, null included', async () => {
    httpMock.post.mockResolvedValueOnce(envelope({ created: 2, updated: 0, unchanged: 0 }));
    const base = {
      question: 'q',
      explanation: 'a',
      codeSnippet: '',
      codeLanguage: '',
      realWorldUsage: '',
      topic: '',
      mcq: null,
      source: null,
      difficulty: 1,
    };
    await authoring.importCardsBatch({
      deckId: 7,
      cards: [
        { ...base, stableUid: 'a', orderInDeck: 5, translations: ZH },
        { ...base, stableUid: 'b', orderInDeck: 10, translations: null },
      ],
    });
    const body = httpMock.post.mock.calls[0][1] as { cards: Array<Record<string, unknown>> };
    expect(body.cards[0].translations).toEqual(ZH);
    expect(Object.hasOwn(body.cards[1], 'translations')).toBe(true);
    expect(body.cards[1].translations).toBeNull();
  });
});

describe('decks: translationLocales', () => {
  it('keeps the locale list, and leaves the key off a deck from an older server', async () => {
    httpMock.get.mockResolvedValueOnce(envelope([{ ...WIRE_DECK, translationLocales: ['zh-CN', '', 3] }]));
    expect((await authoring.fetchDeckById(7)).data?.translationLocales).toEqual(['zh-CN']);

    httpMock.get.mockResolvedValueOnce(envelope([{ ...WIRE_DECK, translationLocales: null }]));
    expect((await authoring.fetchDeckById(7)).data?.translationLocales).toEqual([]);

    httpMock.get.mockResolvedValueOnce(envelope([WIRE_DECK]));
    expect(Object.hasOwn((await authoring.fetchDeckById(7)).data!, 'translationLocales')).toBe(false);
  });

  it('updateDeck sends translationLocales only when asked to', async () => {
    httpMock.put.mockResolvedValue(envelope(WIRE_DECK));
    await authoring.updateDeck(7, { title: 'AWS SAA-C03' });
    expect(Object.hasOwn(httpMock.put.mock.calls[0][1] as object, 'translationLocales')).toBe(false);

    await authoring.updateDeck(7, { translationLocales: ['zh-CN'] });
    expect((httpMock.put.mock.calls[1][1] as Record<string, unknown>).translationLocales).toEqual(['zh-CN']);
  });
});

describe('card reports: displayLocale', () => {
  const WIRE_REPORT = {
    reportId: 41,
    deckId: 7,
    deckSlug: 'aws-saa-c03',
    cardId: 1,
    stableUid: 'saa-001',
    question: 'Which S3 class is cheapest?',
    reason: 'wrong_answer',
    note: null,
    status: 'open',
    resolution: null,
    resolutionNote: null,
    clientVersion: '2.1.0',
    createdAt: '2026-10-18T00:00:00Z',
    resolvedAt: null,
    anonymous: false,
  };

  it('keeps a well-formed displayLocale and drops anything else', async () => {
    httpMock.get.mockResolvedValueOnce(
      envelope({
        items: [
          { ...WIRE_REPORT, reportId: 1, displayLocale: 'zh-CN' },
          { ...WIRE_REPORT, reportId: 2, displayLocale: 'zh_CN' },
          { ...WIRE_REPORT, reportId: 3, displayLocale: null },
          { ...WIRE_REPORT, reportId: 4 },
        ],
        nextCursor: null,
      }),
    );
    const res = await reports.listCardReports({ status: 'open' });
    expect(res.data!.items.map((r) => r.displayLocale)).toEqual(['zh-CN', undefined, undefined, undefined]);
    expect(res.data!.items.slice(1).every((r) => !Object.hasOwn(r, 'displayLocale'))).toBe(true);
  });

  it('badges every non-English display locale and nothing else', () => {
    expect(reports.cardReportLocaleBadge({ displayLocale: 'zh-CN' })).toBe('Seen in Chinese (zh-CN)');
    expect(reports.cardReportLocaleBadge({ displayLocale: 'ja' })).toBe('Seen in ja');
    expect(reports.cardReportLocaleBadge({ displayLocale: 'en' })).toBeNull();
    expect(reports.cardReportLocaleBadge({ displayLocale: 'en-US' })).toBeNull();
    expect(reports.cardReportLocaleBadge({})).toBeNull();
  });
});
