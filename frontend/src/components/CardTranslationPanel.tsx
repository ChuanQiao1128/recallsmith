import { CardFrontHelp } from './CardFrontHelp';
// src/components/CardTranslationPanel.tsx
//
// The card's built-in Simplified Chinese translation, read-only, on the Edit
// Card page. Like the MCQ block in CardForm, the translation is authored only
// through the deck Markdown import (the _ZH sections), so this panel never
// edits or sends anything. Options are aligned by their English key, with the
// English correct mark shown: the translation itself never carries one.

import type { Card } from '../types/card';
import type { Deck } from '../types/deck';
import { mcqOf } from '../lib/mcqRules';
import { translationsOf } from '../lib/translationRules';
import {
  deckUsesTranslations,
  translationIssues,
  translationState,
  type TranslationState,
} from '../lib/translationView';

const CHIP: Record<TranslationState, { label: string; className: string }> = {
  ok: { label: 'OK', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  stale: { label: 'Stale', className: 'bg-amber-50 text-amber-900 border-amber-200' },
  missing: { label: 'Missing', className: 'bg-red-50 text-red-800 border-red-200' },
};

type ZhEntry = {
  question?: unknown;
  frontHelp?: unknown;
  explanation?: unknown;
  realWorldUsage?: unknown;
  mcq?: { qualifier?: unknown; options?: Record<string, { text?: unknown; why?: unknown } | undefined> } | null;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function CardTranslationPanel({ card, deck }: { card: Card; deck: Deck }) {
  // A deck that neither declares zh-CN nor holds a translation for this card
  // (the Claude deck, today's English decks) shows nothing at all.
  if (!deckUsesTranslations(deck, [card])) return null;

  const state = translationState(card);
  const chip = CHIP[state];
  const zh = (translationsOf(card)?.['zh-CN'] ?? null) as ZhEntry | null;
  const mcq = mcqOf(card);
  const issues = translationIssues(card);
  const serverStale = card.translationStatus?.['zh-CN'] === 'stale';

  return (
    <section
      data-testid="card-translation-panel"
      lang="zh-CN"
      className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <h2 lang="en" className="text-sm font-medium text-slate-700">Chinese translation (zh-CN)</h2>
        <span
          data-testid="card-translation-status"
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${chip.className}`}
        >
          {chip.label}
        </span>
      </div>
      <p lang="en" className="mt-1 text-xs text-slate-500">
        Read-only. The translation changes only through the deck Markdown import (the _ZH sections). Saving
        this form never writes it, but the server checks it against the edited English: reworded text marks
        it stale, and adding or removing Real-world usage or the Explanation has to be done in the Markdown.
      </p>

      {zh === null ? (
        <p lang="en" className="mt-2 text-xs text-slate-600">
          No Chinese translation yet. This deck needs one on every card before it can publish.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {serverStale ? (
            <p lang="en" data-testid="card-translation-stale" className="text-xs text-amber-800">
              The English changed after this translation was written. Update the card's _ZH sections and re-import.
            </p>
          ) : null}
          {issues.length > 0 ? (
            <ul lang="en" data-testid="card-translation-issues" className="space-y-1 text-xs text-red-700">
              {issues.map(issue => (
                <li key={issue.code + issue.message}>{issue.message}</li>
              ))}
            </ul>
          ) : null}

          <div>
            <div lang="en" className="text-xs font-medium text-slate-500">Question</div>
            <div data-testid="card-translation-question" className="whitespace-pre-wrap text-slate-800">
              {text(zh.question) ?? '—'}
            </div>
            <CardFrontHelp help={zh.frontHelp} lang="zh-CN" />
          </div>

          {mcq ? (
            <div>
              {mcq.qualifier !== null ? (
                <p className="text-xs text-slate-600">
                  <span lang="en">Qualifier: </span>
                  {text(zh.mcq?.qualifier) ?? '—'}
                </p>
              ) : null}
              <ol className="mt-1 space-y-1">
                {mcq.options.map(option => {
                  const zhOption = zh.mcq?.options?.[option.key];
                  return (
                    <li
                      key={option.key}
                      data-testid={`card-translation-option-${option.key}`}
                      className="text-slate-800"
                    >
                      <span className="font-mono text-xs text-slate-500">{option.key}</span>{' '}
                      {option.correct ? (
                        <span
                          data-testid="card-translation-correct"
                          title="Correct in the English card"
                          className="mr-1 text-emerald-700"
                        >
                          ✓
                        </span>
                      ) : null}
                      {text(zhOption?.text) ?? '—'}
                      <div lang="en" className="text-xs text-slate-400">{option.text}</div>
                      {text(zhOption?.why) ? (
                        <div className="text-xs text-slate-500">
                          <span lang="en">Why: </span>
                          {text(zhOption?.why)}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          <div>
            <div lang="en" className="text-xs font-medium text-slate-500">Explanation</div>
            <div className="whitespace-pre-wrap text-slate-800">{text(zh.explanation) ?? '—'}</div>
          </div>

          {text(zh.realWorldUsage) || text(card.realWorldUsage) ? (
            <div>
              <div lang="en" className="text-xs font-medium text-slate-500">Real-world usage</div>
              <div className="whitespace-pre-wrap text-slate-800">{text(zh.realWorldUsage) ?? '—'}</div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
