// @vitest-environment jsdom
//
// The console surfaces of card translations (contract §2-§4), page by page,
// with the authoring and card-report APIs mocked so nothing leaves the process:
//
//   - EditCardPage: the read-only Chinese panel, options aligned by key with
//     the English correct mark, and the Missing / Stale / OK chip;
//   - CardListPage: the Chinese missing / stale filter and per-row badges;
//   - DeckPreviewPage: the English | Chinese toggle, with the app's
//     whole-card English fallback, and Translations in the approximate JSON;
//   - DeckEditPage: the super_admin-only Translation locales setting;
//   - ReportsPage: the display-locale badge;
//   - DeckImportPage: the TRANSLATIONS_WOULD_BE_CLEARED opt-in.
//
// Every surface must stay invisible on a deck without translations.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import type { McqBlob } from '../src/types/mcq';
import type { CardTranslations } from '../src/types/translation';
import type { CardReport } from '../src/api/cardReports';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { queryClient } from '../src/api/queryClient';
import { ok } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { renderWithQuery } from './support/queryTestClient';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchDecks: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  fetchCardById: vi.fn(),
  createCard: vi.fn(),
  updateCard: vi.fn(),
  updateDeck: vi.fn(),
  fetchDeckBuilds: vi.fn(),
  importCardsBatch: vi.fn(),
}));

const reportsApi = vi.hoisted(() => ({
  listCardReports: vi.fn(),
  resolveCardReport: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

vi.mock('../src/api/cardReports', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/cardReports')>();
  return { ...actual, ...reportsApi };
});

const { EditCardPage } = await import('../src/pages/EditCardPage');
const { CardListPage } = await import('../src/pages/CardListPage');
const { DeckPreviewPage } = await import('../src/pages/DeckPreviewPage');
const { DeckEditPage } = await import('../src/pages/DeckEditPage');
const { ReportsPage } = await import('../src/pages/ReportsPage');
const { DeckImportPage } = await import('../src/pages/DeckImportPage');

const DECK_ID = 7;

const MCQ: McqBlob = {
  v: 1,
  qualifier: 'MOST secure',
  shuffle: true,
  options: [
    { key: 'a', text: 'Use a customer managed KMS key.', why: null, correct: true },
    { key: 'b', text: 'Use SSE-S3.', why: 'S3 owns those keys.', correct: false },
    { key: 'c', text: 'Enable Versioning.', why: 'Versioning encrypts nothing.', correct: false },
  ],
};

const ZH: CardTranslations = {
  'zh-CN': {
    v: 1,
    question: '哪种做法最安全？',
    explanation: '使用客户托管的 AWS KMS 密钥。',
    mcq: {
      qualifier: '最安全',
      options: {
        a: { text: '使用客户托管的 KMS 密钥。', why: null },
        b: { text: '使用 SSE-S3。', why: '这些密钥归 Amazon S3 所有。' },
        c: { text: '启用 Versioning。', why: 'Versioning 不加密任何内容。' },
      },
    },
  },
};

const englishDeck: Deck = {
  id: DECK_ID,
  slug: 'aws-saa-c03',
  title: 'AWS SAA-C03',
  author: 'console-tests',
  locale: 'en-US',
  deckType: 2,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const translatedDeck: Deck = { ...englishDeck, translationLocales: ['zh-CN'] };

function card(over: Partial<Card> = {}): Card {
  return {
    id: 101,
    deckId: DECK_ID,
    stableUid: 'saa-kms-001',
    question: 'Which approach is the MOST secure?',
    explanation: 'Use a customer managed KMS key.',
    realWorldUsage: null,
    codeSnippet: null,
    codeLanguage: null,
    difficulty: 2,
    orderInDeck: 10,
    mcq: MCQ,
    version: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDeckById.mockResolvedValue(ok(translatedDeck));
  api.fetchCardsByDeck.mockResolvedValue(ok([card({ translations: ZH, translationStatus: { 'zh-CN': 'ok' } })]));
  api.fetchCardById.mockResolvedValue(ok(card({ translations: ZH, translationStatus: { 'zh-CN': 'ok' } })));
  api.fetchDeckBuilds.mockResolvedValue(ok({ deckId: DECK_ID, slug: 'aws-saa-c03', liveBuildId: null, builds: [] }));
  api.importCardsBatch.mockResolvedValue(ok({ created: 0, updated: 1, unchanged: 0 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  queryClient.clear();
  signOut();
});

describe('EditCardPage: the read-only Chinese panel', () => {
  function mountEdit() {
    return renderAt(<EditCardPage />, [`/decks/cards/edit?deckId=${DECK_ID}&cardId=101`]);
  }

  it('aligns the Chinese options by key, marks the English correct option, and says OK', async () => {
    mountEdit();
    const panel = await screen.findByTestId('card-translation-panel');
    expect(within(panel).getByTestId('card-translation-status').textContent).toBe('OK');
    expect(within(panel).getByTestId('card-translation-question').textContent).toBe('哪种做法最安全？');
    const optionA = within(panel).getByTestId('card-translation-option-a');
    expect(optionA.textContent).toContain('使用客户托管的 KMS 密钥。');
    expect(optionA.textContent).toContain('Use a customer managed KMS key.');
    expect(within(optionA).getByTestId('card-translation-correct')).toBeTruthy();
    expect(within(within(panel).getByTestId('card-translation-option-b')).queryByTestId('card-translation-correct')).toBeNull();
    expect(within(panel).getByTestId('card-translation-option-b').textContent).toContain('这些密钥归 Amazon S3 所有。');
    // Read-only: no form control of any kind inside the panel.
    expect(panel.querySelectorAll('input, textarea, select, button')).toHaveLength(0);
  });

  it('says Stale when the server marks the translation stale', async () => {
    api.fetchCardById.mockResolvedValue(ok(card({ translations: ZH, translationStatus: { 'zh-CN': 'stale' } })));
    mountEdit();
    const panel = await screen.findByTestId('card-translation-panel');
    expect(within(panel).getByTestId('card-translation-status').textContent).toBe('Stale');
    expect(within(panel).getByTestId('card-translation-stale')).toBeTruthy();
  });

  it('says Stale, with the reason, when the translation no longer fits the English options', async () => {
    const fourOptions: McqBlob = {
      ...MCQ,
      options: [...MCQ.options, { key: 'd', text: 'Enable MFA Delete.', why: 'Protects versions only.', correct: false }],
    };
    api.fetchCardById.mockResolvedValue(ok(card({ mcq: fourOptions, translations: ZH, translationStatus: { 'zh-CN': 'ok' } })));
    mountEdit();
    const panel = await screen.findByTestId('card-translation-panel');
    expect(within(panel).getByTestId('card-translation-status').textContent).toBe('Stale');
    expect(within(panel).getByTestId('card-translation-issues').textContent).toContain('"d"');
  });

  it('says Missing on a card of a zh-CN deck that has no translation', async () => {
    api.fetchCardById.mockResolvedValue(ok(card({ translations: null })));
    mountEdit();
    const panel = await screen.findByTestId('card-translation-panel');
    expect(within(panel).getByTestId('card-translation-status').textContent).toBe('Missing');
  });

  it('renders nothing on a deck without translations', async () => {
    api.fetchDeckById.mockResolvedValue(ok(englishDeck));
    api.fetchCardById.mockResolvedValue(ok(card({ translations: null })));
    mountEdit();
    await screen.findByRole('button', { name: 'Save Changes' });
    expect(screen.queryByTestId('card-translation-panel')).toBeNull();
  });

  it('saving the English form sends no translations key, so the stored one is left alone', async () => {
    api.updateCard.mockResolvedValue(ok(card({ translations: ZH })));
    mountEdit();
    await screen.findByTestId('card-translation-panel');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(1));
    expect(Object.hasOwn(api.updateCard.mock.calls[0][0] as object, 'translations')).toBe(false);
  });
});

describe('CardListPage: the Chinese missing / stale filter', () => {
  const okCard = card({ id: 1, stableUid: 'zh-ok', question: 'Q ok', orderInDeck: 10, translations: ZH, translationStatus: { 'zh-CN': 'ok' } });
  const staleCard = card({ id: 2, stableUid: 'zh-stale', question: 'Q stale', orderInDeck: 20, translations: ZH, translationStatus: { 'zh-CN': 'stale' } });
  const missingCard = card({ id: 3, stableUid: 'zh-missing', question: 'Q missing', orderInDeck: 30, translations: null });

  function mountList() {
    return renderWithQuery(
      <ConfirmDialogProvider>
        <CardListPage />
      </ConfirmDialogProvider>,
      [`/decks/cards?deckId=${DECK_ID}`],
    );
  }

  it('filters to the cards whose translation is missing, or stale', async () => {
    api.fetchCardsByDeck.mockResolvedValue(ok([okCard, staleCard, missingCard]));
    mountList();
    await screen.findByText('Q missing');
    expect(screen.getByTestId('card-translation-badge-ok')).toBeTruthy();
    expect(screen.getByTestId('card-translation-badge-stale')).toBeTruthy();
    expect(screen.getByTestId('card-translation-badge-missing')).toBeTruthy();

    const filter = screen.getByLabelText('Chinese translation') as HTMLSelectElement;
    await userEvent.selectOptions(filter, 'zh-missing');
    await waitFor(() => expect(screen.queryByText('Q ok')).toBeNull());
    expect(screen.getByText('Q missing')).toBeTruthy();
    expect(screen.queryByText('Q stale')).toBeNull();

    await userEvent.selectOptions(filter, 'zh-stale');
    await waitFor(() => expect(screen.queryByText('Q missing')).toBeNull());
    expect(screen.getByText('Q stale')).toBeTruthy();
    expect(screen.getByTestId('card-list-visible-count').textContent).toBe('Showing 1 of 3 cards');
  });

  it('shows neither the filter nor the badges on a deck without translations', async () => {
    api.fetchDeckById.mockResolvedValue(ok(englishDeck));
    api.fetchCardsByDeck.mockResolvedValue(ok([missingCard]));
    mountList();
    await screen.findByText('Q missing');
    expect(screen.queryByLabelText('Chinese translation')).toBeNull();
    expect(screen.queryByTestId('card-translation-badge-missing')).toBeNull();
  });
});

describe('DeckPreviewPage: the English | Chinese toggle', () => {
  function mountPreview() {
    return render(
      <MemoryRouter initialEntries={[`/decks/preview?deckId=${DECK_ID}`]}>
        <DeckPreviewPage />
      </MemoryRouter>,
    );
  }

  it('switches complete cards to Chinese and keeps an incomplete one wholly English', async () => {
    const complete = card({ id: 1, stableUid: 'zh-complete', orderInDeck: 10, translations: ZH });
    const broken: CardTranslations = { 'zh-CN': { ...ZH['zh-CN']!, mcq: { qualifier: '最安全', options: { a: { text: '只有一个。', why: null } } } } };
    const incomplete = card({ id: 2, stableUid: 'zh-incomplete', orderInDeck: 20, translations: broken });
    api.fetchCardsByDeck.mockResolvedValue(ok([complete, incomplete]));
    mountPreview();

    const completeFace = await screen.findByTestId('preview-card-zh-complete');
    expect(completeFace.textContent).toContain('Which approach is the MOST secure?');
    expect(document.querySelector('pre')!.textContent).toContain('"Translations"');

    await userEvent.click(screen.getByTestId('preview-lang-zh-CN'));
    expect(screen.getByTestId('preview-card-zh-complete').textContent).toContain('哪种做法最安全？');
    expect(screen.getByTestId('preview-card-zh-complete').textContent).toContain('这些密钥归 Amazon S3 所有。');
    const incompleteFace = screen.getByTestId('preview-card-zh-incomplete');
    expect(incompleteFace.textContent).toContain('Which approach is the MOST secure?');
    expect(incompleteFace.textContent).not.toContain('只有一个');
    expect(within(incompleteFace).getByTestId('preview-card-fallback')).toBeTruthy();

    await userEvent.click(screen.getByTestId('preview-lang-en'));
    expect(screen.getByTestId('preview-card-zh-complete').textContent).toContain('Which approach is the MOST secure?');
  });

  it('has no toggle and no Translations key on a deck without translations', async () => {
    api.fetchDeckById.mockResolvedValue(ok(englishDeck));
    api.fetchCardsByDeck.mockResolvedValue(ok([card({ translations: null })]));
    mountPreview();
    await screen.findByTestId('preview-card-saa-kms-001');
    expect(screen.queryByTestId('preview-lang-zh-CN')).toBeNull();
    expect(document.querySelector('pre')!.textContent).not.toContain('Translations');
  });
});

describe('DeckEditPage: Translation locales', () => {
  async function mountEditDeck(deck: Deck) {
    api.fetchDeckById.mockResolvedValue(ok(deck));
    api.fetchCardsByDeck.mockResolvedValue(ok([]));
    api.updateDeck.mockResolvedValue(ok(deck));
    renderAt(<DeckEditPage />, [`/decks/edit?deckId=${DECK_ID}`]);
    await screen.findByRole('button', { name: 'Save' });
    return within(screen.getByTestId('deck-translation-locales')).getByRole('checkbox') as HTMLInputElement;
  }

  it('lets a super_admin turn zh-CN on, and sends translationLocales only when it changed', async () => {
    const box = await mountEditDeck(englishDeck);
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect(Object.hasOwn(api.updateDeck.mock.calls[0][1] as object, 'translationLocales')).toBe(false);

    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(2));
    expect((api.updateDeck.mock.calls[1][1] as Record<string, unknown>).translationLocales).toEqual(['zh-CN']);
  });

  it('shows the stored setting and lets a super_admin clear it', async () => {
    const box = await mountEditDeck(translatedDeck);
    expect(box.checked).toBe(true);
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateDeck).toHaveBeenCalledTimes(1));
    expect((api.updateDeck.mock.calls[0][1] as Record<string, unknown>).translationLocales).toEqual([]);
  });

  it('is read-only for an editor, and for a deck that is itself zh-CN', async () => {
    signOut();
    signInAsEditor();
    expect((await mountEditDeck(englishDeck)).disabled).toBe(true);
    cleanup();
    queryClient.clear();

    signOut();
    signInAsSuperAdmin();
    expect((await mountEditDeck({ ...englishDeck, locale: 'zh-CN' })).disabled).toBe(true);
  });
});

describe('ReportsPage: the display-locale badge', () => {
  function report(over: Partial<CardReport>): CardReport {
    return {
      reportId: 41,
      deckId: DECK_ID,
      deckSlug: 'aws-saa-c03',
      cardId: 101,
      stableUid: 'saa-kms-001',
      question: 'Which approach is the MOST secure?',
      reason: 'wrong_answer',
      note: null,
      status: 'open',
      resolution: null,
      resolutionNote: null,
      clientVersion: '2.1.0',
      createdAt: '2026-10-18T10:00:00Z',
      resolvedAt: null,
      anonymous: false,
      ...over,
    };
  }

  it('badges a report read in Chinese and leaves English and older reports alone', async () => {
    reportsApi.listCardReports.mockResolvedValue(
      ok({
        items: [
          report({ reportId: 1, question: 'Read in Chinese', displayLocale: 'zh-CN' }),
          report({ reportId: 2, question: 'Read in English', displayLocale: 'en' }),
          report({ reportId: 3, question: 'Older client' }),
        ],
        nextCursor: null,
      }),
    );
    api.fetchDecks.mockResolvedValue(ok([englishDeck]));
    signOut();
    signInAsEditor();
    renderAt(
      <ConfirmDialogProvider>
        <ReportsPage />
      </ConfirmDialogProvider>,
      ['/reports'],
    );
    await screen.findByRole('table', { name: 'Card reports' });
    await act(async () => {});

    const badges = screen.getAllByTestId('report-display-locale');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('Seen in Chinese (zh-CN)');
    expect(badges[0].closest('tr')!.textContent).toContain('Read in Chinese');
  });
});

describe('DeckImportPage: TRANSLATIONS_WOULD_BE_CLEARED', () => {
  const ENGLISH_DOC = [
    '# deck: aws-saa-c03',
    '',
    '## saa-kms-001 | d2',
    'QUALIFIER: MOST secure',
    'Q:',
    'Which approach is the MOST secure?',
    'OPT: a *',
    'Use a customer managed KMS key.',
    'OPT: b',
    'Use SSE-S3.',
    'WHY:',
    'S3 owns those keys.',
    'OPT: c',
    'Enable Versioning.',
    'WHY:',
    'Versioning encrypts nothing.',
    'A:',
    'Use a customer managed KMS key.',
    '',
  ].join('\n');

  it('blocks an English-only import over a translated card until the operator opts in, then sends translations: null', async () => {
    const user = userEvent.setup();
    api.fetchCardsByDeck.mockResolvedValue(ok([card({ orderInDeck: 5, translations: ZH })]));
    renderAt(<DeckImportPage />, [`/decks/import?deckId=${DECK_ID}`]);
    await screen.findByText('1 · Source');
    await user.click(document.querySelector('textarea')!);
    await user.paste(ENGLISH_DOC);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('2 · Preview');

    const guard = screen.getByTestId('import-translation-clears');
    expect(guard.textContent).toContain('1 card has a Chinese translation');
    const importButton = screen.getByRole('button', { name: /^Import \d+ card/ }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);

    await user.click(within(guard).getByRole('checkbox'));
    const armed = screen.getByRole('button', { name: 'Import 1 card' }) as HTMLButtonElement;
    expect(armed.disabled).toBe(false);

    await user.click(armed);
    await waitFor(() => expect(api.importCardsBatch).toHaveBeenCalledTimes(1));
    const sent = api.importCardsBatch.mock.calls[0][0] as { cards: Array<Record<string, unknown>> };
    expect(sent.cards[0].translations).toBeNull();
  });
});
