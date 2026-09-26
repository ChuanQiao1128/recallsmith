// src/components/CardForm.tsx

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Deck } from '../types/deck';
import type { McqBlob } from '../types/mcq';
import {
  MAX_DIFFICULTY,
  MAX_UID_LENGTH,
  MIN_DIFFICULTY,
  hasContent,
  isValidDifficulty,
  isValidStableUid,
} from '../lib/cardRules';
import { checkMcqForm } from '../lib/mcqFormCheck';
import { highlightSnippet, mapToHlLanguage } from '../lib/highlightSnippet';

// The highlight.js theme stays here so it rides the lazy CardForm chunk; the
// engine setup and mapToHlLanguage moved to lib/highlightSnippet.ts.
import 'highlight.js/styles/atom-one-dark.css';

export interface CardFormValues {
  question: string;
  stableUid: string;
  explanation: string;
  realWorldUsage: string;
  codeSnippet: string;
  codeLanguage: string;
  difficulty: number;
  orderInDeck: number;
  revision: number;
  topic: string;
}

interface CardFormProps {
  mode: 'create' | 'edit';
  deck: Deck;
  initialValues: CardFormValues;
  onSubmit: (values: CardFormValues) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;

  /**
   * A second submit button, shown beside the error, when the page has something
   * specific to offer for the failure it just reported. Absent by default, and
   * absent is the right answer for a failure with no recovery: an offer that
   * changes nothing is worse than no offer, because the user spends a press
   * finding that out.
   *
   * It is `type="submit"` on purpose, and that is the whole design. The values
   * live in this component's state, so a recovery button OUTSIDE the form could
   * only re-send whatever the page had captured at the moment the failure
   * arrived -- correct until the user touches a field, and silently wrong from
   * then on. Submitting the form instead sends what is on screen when it is
   * pressed, which is what "retry" means to the person pressing it.
   */
  recoveryLabel?: string | null;

  /**
   * The card's MCQ block as the server holds it, shown read-only below the
   * text fields. The form never edits or sends it: options, answers and WHY
   * notes are authored through the deck Markdown import (OPT:/WHY:/QUALIFIER:)
   * and validated there and at the API. Absent or null on a Q/A card and on
   * the create page.
   *
   * It is still never sent, but it is now VALIDATED against the form's own
   * values: the server re-canonicalises the stored blob against the edited
   * question, explanation and difficulty on every PUT, so checkMcqForm runs the
   * same rules here and surfaces the verdict before submit (see below).
   */
  mcq?: McqBlob | null;

  /**
   * Reports whether any field now differs from the values the form mounted
   * with, so a page can guard against a stray navigation discarding an edit
   * (see useUnsavedChangesGuard). Optional: a form with no guard omits it. The
   * form itself makes no navigation decision — it only reports.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

interface InternalState {
  submitting: boolean;
  error: string | null;
}

const CODE_LANG_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'js', label: 'JavaScript' },
  { value: 'ts', label: 'TypeScript' },
  { value: 'cs', label: 'C#' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Shell / Bash' },
];

// ---------------------------------------------------------------------------
// ADVISORY HINTS: ONE KERNEL, TWO SEVERITIES
// ---------------------------------------------------------------------------
// The import door (deckImport.ts) and this form have never asked a card the same
// questions. tests/cardRuleDivergence.test.tsx records seven differences; the
// ruling on them (docs/console-refactor-plan.md 8.2, option 3) was to share the
// PREDICATES and split the SEVERITY: the importer keeps blocking, this form only
// says the same thing out loud. Nothing below can refuse a submission, and the
// four hard checks in handleSubmit are untouched.
//
// Why not simply tighten the form to match the importer (option 1): the uid
// shape, the uid length and the difficulty range are all but unreachable while
// CREATING a card — the uid input re-slugifies on every keypress and blur strips
// the trailing separator, and the difficulty widget offers only 1/2/3 — so the
// whole cost of that option lands on EDITING an existing card, where a typo fix
// would be blocked by a condition the editor never touched and has no way past.
// Why not normalise silently (option 4): deckImport reconciles on uid alone, so
// a rewritten uid makes the next import create a duplicate instead of updating.
//
// The message TEXT is deliberately not shared with the importer. The importer's
// wording carries line numbers, addresses a deck author, is asserted literally
// by tests/deckImport.test.ts — and, in the uid case, is stale: it says
// "lowercase kebab-case" while UID_PATTERN also admits `_` (see cardRules.ts).
// Copying it here would propagate that inaccuracy to a different audience.
//
// The three hints are nowhere near equally reachable, and the next person should
// not read three symmetrical branches as three equal risks:
//
//   explanation   The only one an ordinary day reaches. Saving a card with no
//                 answer is easy and the consequence is invisible until the
//                 deck is exported and re-imported, where the card is dropped.
//   stableUid     Unreachable by construction while creating. Its real audience
//                 is a historical uid on a card being edited — where the field
//                 is readOnly, which is why the wording states a consequence and
//                 never asks for a change that cannot be made here.
//   difficulty    Nearly unreachable from either side: the widget cannot produce
//                 an out-of-range value and the importer rejects one at
//                 header-parse time. Only a value already in the database lights
//                 it.
//
// tests/cardFormHints.test.tsx pins the behaviour; the appended `hints`
// assertions in tests/cardRuleDivergence.test.tsx pin that it stayed advisory.

type HintField = 'explanation' | 'stableUid' | 'difficulty';

interface CardHint {
  field: HintField;
  id: string;
  text: string;
}

/**
 * Which fields would give the import door trouble, phrased for a person typing.
 *
 * Module-private on purpose: cardRules.ts holds the predicates and nothing else,
 * and tests/cardRulesWiring.test.ts enumerates its exports precisely so a new
 * one with no consumer cannot appear. Hint wording is this component's business.
 *
 * Note that each condition is guarded by the matching HARD check rather than
 * being a bare negation of the predicate. `hasContent(uid) && !isValid(uid)`
 * means an empty uid produces the blocking banner alone — otherwise the form
 * would state the same problem twice, in two colours, about one field.
 */
function hintsFor(values: CardFormValues): CardHint[] {
  const hints: CardHint[] = [];

  if (!hasContent(values.explanation)) {
    hints.push({
      field: 'explanation',
      id: 'explanation-hint',
      text: 'You can save without one. The cost lands later: exported to .md and imported back, this card reads as having no answer and never enters the deck.',
    });
  }

  if (hasContent(values.stableUid) && !isValidStableUid(values.stableUid)) {
    hints.push({
      field: 'stableUid',
      id: 'stableUid-hint',
      text:
        `The import door takes lowercase letters and digits, split by a single - or _, up to ${MAX_UID_LENGTH} characters. ` +
        'This one does not fit, so re-importing the .md would refuse the card as BAD_UID_FORMAT.',
    });
  }

  if (!isValidDifficulty(values.difficulty)) {
    hints.push({
      field: 'difficulty',
      id: 'difficulty-hint',
      text:
        `The import door takes whole numbers from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}. ` +
        'This one sits outside that range, so re-importing the .md would drop the whole card.',
    });
  }

  return hints;
}

function slugifyForStableUid(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The same normalisation, minus the one rule that cannot run mid-keystroke.
 *
 * The field re-slugifies its whole value on every keypress, so stripping
 * trailing separators there deleted each hyphen the instant it was typed and
 * the next character closed the gap: `cs-async-001` typed by hand arrived as
 * `csasync001`, while the identical string pasted in one go survived. The .md
 * file carries the hyphenated spelling, and deckImport reconciles on uid alone,
 * so the next import read the hand-typed card as a stranger and created a
 * duplicate rather than updating it.
 *
 * Leading separators are still stripped: a uid may not start with one, and
 * removing it costs the typist nothing, because there is no keystroke it could
 * be on the way to. A trailing one is every hyphen at the moment it is typed,
 * which is why it has to wait for blur.
 */
function slugifyWhileTyping(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '');
}

export function CardForm(props: CardFormProps) {
  const { mode, deck, initialValues, onSubmit, onCancel, recoveryLabel, mcq, onDirtyChange } = props;

  const mcqRequiredCount = mcq ? mcq.options.filter(option => option.correct).length : 0;

  const [values, setValues] = useState<CardFormValues>(initialValues);

  // The MCQ rules re-run over the live values on every render — cheap, and it is
  // what keeps the inline issues and the submit gate reading the same verdict.
  // Null on a Q/A card, where there is nothing to check.
  const mcqCheck = mcq
    ? checkMcqForm(
        { question: values.question, explanation: values.explanation, difficulty: values.difficulty },
        mcq,
      )
    : null;

  // The values the form mounted with. Frozen once, like `values` itself, so the
  // two are compared against the same starting point across the form's life.
  const [baseline] = useState(initialValues);

  // Dirty is "some field now differs from where it started", field by field
  // over CardFormValues' keys. Reported through onDirtyChange rather than acted
  // on here — the navigation decision belongs to the page's guard.
  const dirty = (Object.keys(baseline) as (keyof CardFormValues)[]).some(
    key => values[key] !== baseline[key],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const [state, setState] = useState<InternalState>({
    submitting: false,
    error: null,
  });

  // Hint timing only. None of these three can change what is submitted.
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [touched, setTouched] = useState<readonly string[]>([]);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  function handleChange(field: keyof CardFormValues, value: string | number) {
    setValues(prev => ({ ...prev, [field]: value }));
  }

  /** Every field leaves focus through here, so the two effects cannot drift. */
  function handleFieldBlur(field: string) {
    setFocusedField(null);
    setTouched(prev => (prev.includes(field) ? prev : [...prev, field]));
  }

  /**
   * A hint waits for the caret to leave the field it is about.
   *
   * The uid input re-slugifies on every keypress and keeps a trailing separator
   * until blur, so `cs-async-` — a value on the way to every correct uid this
   * form can produce — fails UID_PATTERN for as long as the person is still
   * typing. Showing hints mid-keystroke would light that field up during normal,
   * correct use. Blur is also where the value is repaired, so by the time a hint
   * is allowed to speak it is describing the value that would actually be sent.
   *
   * `mode === 'edit'` shows from mount: those values arrived from the database,
   * nobody is part-way through typing them, and the uid field is readOnly.
   */
  const visibleHints = hintsFor(values).filter(
    hint =>
      focusedField !== hint.field &&
      (mode === 'edit' || touched.includes(hint.field) || submitAttempted),
  );
  const hintFor = (field: HintField): CardHint | null =>
    visibleHints.find(hint => hint.field === field) ?? null;

  const explanationHint = hintFor('explanation');
  const stableUidHint = hintFor('stableUid');
  const difficultyHint = hintFor('difficulty');

  function handleQuestionBlur() {
    if (!values.stableUid.trim() && values.question.trim()) {
      const auto = slugifyForStableUid(values.question);
      setValues(prev => ({ ...prev, stableUid: auto }));
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Before the hard checks, so a submission refused by one of them still shows
    // whatever else is worth knowing rather than one problem at a time.
    setSubmitAttempted(true);

    const trimmedQuestion = values.question.trim();
    const trimmedUid = values.stableUid.trim();

    if (!hasContent(values.question)) {
      setState(prev => ({ ...prev, error: 'Question is required.' }));
      return;
    }
    if (!hasContent(values.stableUid)) {
      setState(prev => ({ ...prev, error: 'StableUid is required.' }));
      return;
    }

    if (!Number.isFinite(values.orderInDeck) || values.orderInDeck <= 0) {
      setState(prev => ({ ...prev, error: 'orderInDeck must be a positive number (e.g. 10, 20, 30).' }));
      return;
    }

    if (!Number.isFinite(values.revision) || values.revision <= 0) {
      setState(prev => ({ ...prev, error: 'revision must be a positive number (e.g. 1).' }));
      return;
    }

    // The MCQ blocking gate. A blocking issue is one the server's PUT would
    // refuse against the edited stem/explanation/difficulty, so submitting would
    // fail with a server code; refuse here instead. Advisory issues never block.
    if (mcqCheck && mcqCheck.blocking.length > 0) {
      setState(prev => ({ ...prev, error: 'Fix the multiple-choice issues listed below before saving.' }));
      return;
    }

    setState({ submitting: true, error: null });

    try {
      const result = await onSubmit({
        ...values,
        question: trimmedQuestion,
        stableUid: trimmedUid,
        explanation: values.explanation ?? '',
        realWorldUsage: values.realWorldUsage ?? '',
      });

      if (!result.ok) {
        setState({ submitting: false, error: result.error ?? 'Submit failed.' });
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error.';
      setState({ submitting: false, error: message });
    }
  }

  const hlLanguage = mapToHlLanguage(values.codeLanguage);

  // The preview reads DEFERRED copies of the snippet and language, so typing
  // stays on the urgent render path and highlighting happens at lower priority
  // once React catches up. With no language picked the preview is escaped plain
  // text, because the old behaviour ran every registered grammar (auto-detection)
  // on each keystroke and lagged long snippets. Pick a language to get colours.
  const deferredSnippet = useDeferredValue(values.codeSnippet);
  const deferredLanguage = useDeferredValue(hlLanguage);

  const highlightedHtml = useMemo(
    () => highlightSnippet(deferredSnippet, deferredLanguage),
    [deferredSnippet, deferredLanguage],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-lg shadow-sm px-6 py-6 space-y-4"
    >
      {state.error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
          <div>{state.error}</div>

          {recoveryLabel ? (
            <button
              type="submit"
              disabled={state.submitting}
              className="mt-2 inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                         border border-red-300 text-red-800 hover:bg-red-100
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {recoveryLabel}
            </button>
          ) : null}
        </div>
      )}

      <div className="text-xs text-slate-500 border-b border-slate-100 pb-2 mb-2">
        <span className="font-semibold text-slate-700">{deck.title}</span> ·{' '}
        <span className="font-mono">{deck.slug}</span> · {deck.locale}
      </div>

      {/* Question */}
      <div>
        <label htmlFor="question" className="block text-sm font-medium text-slate-700 mb-1">
          Question <span className="text-red-500">*</span>
        </label>
        <textarea
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500
                     min-h-[80px]"
          id="question"
          value={values.question}
          onChange={e => handleChange('question', e.target.value)}
          onFocus={() => setFocusedField('question')}
          // handleQuestionBlur runs first and unchanged: it is what fills an
          // empty uid from the question, and tests/cardFormStableUid.test.tsx
          // pins that. Focus bookkeeping is appended, never substituted.
          onBlur={() => {
            handleQuestionBlur();
            handleFieldBlur('question');
          }}
          placeholder="Explain the difference between var, let and const."
        />
      </div>

      {/* StableUid */}
      <div>
        <label htmlFor="stableUid" className="block text-sm font-medium text-slate-700 mb-1">
          Stable UID <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          className={`block w-full rounded-md border px-3 py-2 text-sm font-mono
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500
                     ${mode === 'edit' ? 'border-slate-200 bg-slate-100 text-slate-500' : 'border-slate-300'}`}
          id="stableUid"
          value={values.stableUid}
          readOnly={mode === 'edit'}
          aria-describedby={stableUidHint ? stableUidHint.id : undefined}
          onChange={e => handleChange('stableUid', slugifyWhileTyping(e.target.value))}
          onFocus={() => setFocusedField('stableUid')}
          // The normalising blur runs first and unchanged; the trailing-separator
          // strip it performs is precisely why a hint may only look after it.
          onBlur={e => {
            handleChange('stableUid', slugifyForStableUid(e.target.value));
            handleFieldBlur('stableUid');
          }}
          placeholder="js-basics-let-const-var"
        />
        {stableUidHint && (
          <p id={stableUidHint.id} data-card-hint="stableUid" className="mt-1 text-xs text-amber-700">
            {stableUidHint.text}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          {mode === 'edit'
            ? 'This stable ID is fixed. It is how the card is known everywhere: review progress files under it and imports reconcile against it. Changing it would discard every study record this card has and start it over as a new card.'
            : 'Unique within this deck. Generated from the Question, and yours to adjust.'}
        </p>
      </div>

      {/* Explanation */}
      <div>
        <label htmlFor="explanation" className="block text-sm font-medium text-slate-700 mb-1">Explanation</label>
        <textarea
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500
                     min-h-[100px]"
          id="explanation"
          value={values.explanation}
          aria-describedby={explanationHint ? explanationHint.id : undefined}
          onChange={e => handleChange('explanation', e.target.value)}
          onFocus={() => setFocusedField('explanation')}
          onBlur={() => handleFieldBlur('explanation')}
          placeholder="A concise but clear explanation of the answer..."
        />
        {explanationHint && (
          <p id={explanationHint.id} data-card-hint="explanation" className="mt-1 text-xs text-amber-700">
            {explanationHint.text}
          </p>
        )}
      </div>

      {/* Topic */}
      <div>
        <label htmlFor="topic" className="block text-sm font-medium text-slate-700 mb-1">Topic</label>
        <input
          type="text"
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          id="topic"
          maxLength={80}
          value={values.topic}
          onChange={e => handleChange('topic', e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Optional. Groups cards in the app; up to 80 characters. Clear it to remove the topic.
        </p>
      </div>

      {/* Language + Difficulty + Order + Revision */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label htmlFor="codeLanguage" className="block text-sm font-medium text-slate-700 mb-1">Code Language</label>
          <select
            id="codeLanguage"
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            value={values.codeLanguage}
            onChange={e => handleChange('codeLanguage', e.target.value)}
          >
            {CODE_LANG_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="difficulty" className="block text-sm font-medium text-slate-700 mb-1">Difficulty</label>
          <select
            id="difficulty"
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            value={values.difficulty}
            aria-describedby={difficultyHint ? difficultyHint.id : undefined}
            onChange={e => handleChange('difficulty', Number(e.target.value))}
            onFocus={() => setFocusedField('difficulty')}
            onBlur={() => handleFieldBlur('difficulty')}
          >
            <option value={1}>Easy</option>
            <option value={2}>Medium</option>
            <option value={3}>Hard</option>
            {/* The importer accepts difficulty 0..4, this list offers 1..3. A
                select handed a value it does not list falls back to rendering
                its first option, so a card holding 0 or 4 appeared as "Easy" —
                the screen stating a difficulty the card does not have. Adding
                the actual value keeps the display honest without inventing a
                meaning for 0 and 4 that the rest of the system does not have.
                It appears only for the card that already holds such a value, so
                it cannot be picked for a new one. */}
            {![1, 2, 3].includes(values.difficulty) && (
              <option value={values.difficulty}>{values.difficulty} (came from an import, outside the usual range)</option>
            )}
          </select>
          {difficultyHint && (
            <p id={difficultyHint.id} data-card-hint="difficulty" className="mt-1 text-xs text-amber-700">
              {difficultyHint.text}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="orderInDeck" className="block text-sm font-medium text-slate-700 mb-1">Order in Deck</label>
          <input
            id="orderInDeck"
            type="number"
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            value={values.orderInDeck}
            onChange={e => handleChange('orderInDeck', Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-slate-500">Leave gaps &mdash; 10, 20, 30 &mdash; so a later card can slot between two of these.</p>
        </div>

        <div>
          <label htmlFor="revision" className="block text-sm font-medium text-slate-700 mb-1">Revision</label>
          <input
            id="revision"
            type="number"
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            value={values.revision}
            onChange={e => handleChange('revision', Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-slate-500">Content revision number. Optional, but worth bumping as you edit.</p>
        </div>
      </div>

      {/* Code Snippet + Preview */}
      <div>
        <label htmlFor="codeSnippet" className="block text-sm font-medium text-slate-700 mb-1">Code Snippet</label>
        <textarea
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500
                     min-h-[140px]"
          id="codeSnippet"
          value={values.codeSnippet}
          onChange={e => handleChange('codeSnippet', e.target.value)}
          placeholder={`function makeCounter() {\n  let count = 0;\n  return function () {\n    count++;\n    return count;\n  };\n}`}
        />

        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-600">Preview</span>
            <span className="text-[10px] text-slate-400">{values.codeLanguage || 'auto'}</span>
          </div>

          <div className="border border-slate-200 rounded text-xs overflow-auto">
            <pre className="m-0">
              <code
                className={hlLanguage ? `hljs language-${hlLanguage}` : 'hljs'}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </pre>
          </div>
        </div>
      </div>

        {/* RealWorldUsage */}
      <div>
        <label htmlFor="realWorldUsage" className="block text-sm font-medium text-slate-700 mb-1">RealWorldUsage</label>
        <textarea
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500
                     min-h-[90px]"
          id="realWorldUsage"
          value={values.realWorldUsage}
          onChange={e => handleChange('realWorldUsage', e.target.value)}
          placeholder="Where would you use this in real projects? Any pitfalls?"
        />
      </div>

      {mcq ? (
        <fieldset
          data-testid="card-form-mcq"
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
        >
          <legend className="px-1 text-sm font-medium text-slate-700">Multiple choice</legend>
          <p className="text-xs text-slate-500">
            Options, answers and WHY notes change through the deck Markdown import. The checks below
            re-run as you edit the question, explanation and difficulty.
          </p>
          <p data-testid="card-form-mcq-required" className="mt-1 text-xs text-slate-600">
            {mcqRequiredCount === 1 ? 'Single answer' : `Choose ${mcqRequiredCount}`}
          </p>
          {mcq.qualifier ? (
            <p data-testid="card-form-mcq-qualifier" className="mt-1 text-xs text-slate-600">
              Qualifier: {mcq.qualifier}
            </p>
          ) : null}
          <ol className="mt-2 space-y-1">
            {mcq.options.map(option => (
              <li key={option.key} data-testid={`card-form-mcq-option-${option.key}`} className="text-slate-800">
                <span className="font-mono text-xs text-slate-500">{option.key}</span> {option.text}
                {option.correct ? (
                  <span
                    data-testid="card-form-mcq-correct"
                    className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border bg-emerald-50 text-emerald-800 border-emerald-200"
                  >
                    correct
                  </span>
                ) : null}
                {option.why ? <div className="text-xs text-slate-500">Why: {option.why}</div> : null}
              </li>
            ))}
          </ol>
          {mcqCheck && mcqCheck.blocking.length > 0 ? (
            <ul data-testid="card-form-mcq-issues" className="mt-2 space-y-1 text-xs text-red-700">
              {mcqCheck.blocking.map(issue => (
                <li key={issue.code + issue.message}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
          {mcqCheck && mcqCheck.advisory.length > 0 ? (
            <ul data-testid="card-form-mcq-advice" className="mt-2 space-y-1 text-xs text-amber-700">
              {mcqCheck.advisory.map(issue => (
                <li key={issue.code + issue.message}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </fieldset>
      ) : null}

      <div className="pt-2 flex items-center justify-between">
        <button type="button" onClick={onCancel} className="text-sm text-slate-600 hover:text-slate-800">
          Cancel
        </button>

        <button
          type="submit"
          disabled={state.submitting}
          className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium
                     bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                     disabled:opacity-60 disabled:cursor-not-allowed
                     focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          {state.submitting
            ? mode === 'create'
              ? 'Creating...'
              : 'Saving...'
            : mode === 'create'
              ? 'Create Card'
              : 'Save Changes'}
        </button>
      </div>

      
    </form>
  );
}