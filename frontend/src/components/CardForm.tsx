// src/components/CardForm.tsx

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Deck } from '../types/deck';
import { hasContent } from '../lib/cardRules';

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

  function handleChange(field: keyof CardFormValues, value: string | number) {
    setValues(prev => ({ ...prev, [field]: value }));
  }

  function handleQuestionBlur() {
    if (!values.stableUid.trim() && values.question.trim()) {
      const auto = slugifyForStableUid(values.question);
      setValues(prev => ({ ...prev, stableUid: auto }));
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

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
          onBlur={handleQuestionBlur}
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
          onChange={e => handleChange('stableUid', slugifyWhileTyping(e.target.value))}
          onBlur={e => handleChange('stableUid', slugifyForStableUid(e.target.value))}
          placeholder="js-basics-let-const-var"
        />
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
          onChange={e => handleChange('explanation', e.target.value)}
          placeholder="A concise but clear explanation of the answer..."
        />
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
            onChange={e => handleChange('difficulty', Number(e.target.value))}
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