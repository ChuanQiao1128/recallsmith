// src/components/CardForm.tsx

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Deck } from '../types/deck';
import {
  MAX_DIFFICULTY,
  MAX_UID_LENGTH,
  MIN_DIFFICULTY,
  hasContent,
  isValidDifficulty,
  isValidStableUid,
} from '../lib/cardRules';

// highlight.js core + languages
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import csharp from 'highlight.js/lib/languages/csharp';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import 'highlight.js/styles/atom-one-dark.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('bash', bash);

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
}

interface CardFormProps {
  mode: 'create' | 'edit';
  deck: Deck;
  initialValues: CardFormValues;
  onSubmit: (values: CardFormValues) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
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
      text: '留空可以存下。代价在之后：这张卡导出成 .md 再导入时会被判为没有答案，整张卡不会进入 deck。',
    });
  }

  if (hasContent(values.stableUid) && !isValidStableUid(values.stableUid)) {
    hints.push({
      field: 'stableUid',
      id: 'stableUid-hint',
      text:
        `导入门接受的 uid 由小写字母和数字组成，中间可以用单个 - 或 _ 分隔，长度不超过 ${MAX_UID_LENGTH} 个字符。` +
        '当前这个不符合，所以这张卡随 .md 重新导入时会被判为 BAD_UID_FORMAT。',
    });
  }

  if (!isValidDifficulty(values.difficulty)) {
    hints.push({
      field: 'difficulty',
      id: 'difficulty-hint',
      text:
        `导入门接受的难度是 ${MIN_DIFFICULTY}..${MAX_DIFFICULTY} 之间的整数。` +
        '当前这个在范围外，所以这张卡随 .md 重新导入时会被整张丢掉。',
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

function mapToHlLanguage(codeLang: string): string | null {
  if (!codeLang) return null;
  switch (codeLang) {
    case 'js':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'cs':
      return 'csharp';
    default:
      return codeLang;
  }
}

export function CardForm(props: CardFormProps) {
  const { mode, deck, initialValues, onSubmit, onCancel } = props;

  const [values, setValues] = useState<CardFormValues>(initialValues);
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

  const highlightedHtml = useMemo(() => {
    const code = values.codeSnippet;

    if (!code) {
      return hljs.highlight('// No code snippet.', { language: 'javascript' }).value;
    }

    try {
      if (hlLanguage) return hljs.highlight(code, { language: hlLanguage }).value;
      return hljs.highlightAuto(code).value;
    } catch {
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [values.codeSnippet, hlLanguage]);

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-lg shadow-sm px-6 py-6 space-y-4"
    >
      {state.error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
          {state.error}
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
            ? '这张卡的稳定 ID 不能改。它是这张卡在全系统里的身份：复习进度按它归档，导入也按它对账。改掉等于把这张卡上已有的学习记录全部弃掉，再当成一张新卡重新开始。'
            : '每个 Deck 内唯一的稳定 ID。默认根据 Question 自动生成，可以手动调整。'}
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
              <option value={values.difficulty}>{values.difficulty}（导入时写入，不在常用范围）</option>
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
          <p className="mt-1 text-xs text-slate-500">建议用 10, 20, 30 间隔，方便插题。</p>
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
          <p className="mt-1 text-xs text-slate-500">内容修订号（可选但建议保持）。</p>
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