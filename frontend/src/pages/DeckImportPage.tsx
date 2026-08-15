// src/pages/DeckImportPage.tsx
//
// Markdown batch import for one deck: paste or pick a file, preview the
// reconciliation, then apply it card by card.
//
// The page is deliberately thin. Parsing, validation and the create/update/
// unchanged decision live in lib/deckImport.ts, and the write loop lives in
// lib/deckImportRunner.ts, both covered by tests that need no DOM. What is
// left here is layout, the step machine, and reading a file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { createCard, fetchCardsByDeck, fetchDeckById, updateCard } from '../api/authoring';
import { RarityDistribution } from '../components/RarityDistribution';
import {
  formatIssue,
  parseDeckMarkdown,
  planImport,
  type ImportPlan,
  type ParsedCard,
  type ParsedDeck,
} from '../lib/deckImport';
import {
  describeFailure,
  runImport,
  type ImportAction,
  type ImportRunResult,
} from '../lib/deckImportRunner';
import type { Deck } from '../types/deck';

type Step = 'input' | 'preview' | 'result';

interface DeckState {
  loading: boolean;
  deck: Deck | null;
  error: string | null;
}

interface PreviewState {
  parsed: ParsedDeck;
  plan: ImportPlan;
  /** Set when the document header names a different deck than the target. */
  slugMismatch: string | null;
}

const ACCEPTED_EXTENSIONS = ['.md', '.txt'];

function truncate(text: string, max = 90): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

const ACTION_CLASSES: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  update: 'bg-amber-50 text-amber-700 border-amber-200',
  unchanged: 'bg-slate-50 text-slate-500 border-slate-200',
  conflict: 'bg-red-50 text-red-700 border-red-200',
};

interface PreviewRow {
  card: ParsedCard;
  kind: 'create' | 'update' | 'unchanged' | 'conflict';
  detail: string;
}

/** One row per card, in document order, so the table reads like the file. */
function toRows(plan: ImportPlan): PreviewRow[] {
  const rows: PreviewRow[] = [
    ...plan.creates.map((c): PreviewRow => ({ card: c.card, kind: 'create', detail: 'new card' })),
    ...plan.updates.map((u): PreviewRow => ({
      card: u.card,
      kind: 'update',
      detail: u.changedFields.join(', '),
    })),
    ...plan.unchanged.map((u): PreviewRow => ({
      card: u.card,
      kind: 'unchanged',
      detail: 'identical to server',
    })),
    ...plan.conflicts.map((c): PreviewRow => ({
      card: c.card,
      kind: 'conflict',
      detail: c.message,
    })),
  ];
  return rows.sort((a, b) => a.card.sourceLine - b.card.sourceLine);
}

function Badge({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs ${tone}`}>
      <span className="font-semibold">{count}</span>
      <span>{label}</span>
    </span>
  );
}

export function DeckImportPage() {
  const [searchParams] = useSearchParams();

  const deckIdRaw = searchParams.get('deckId') ?? '';
  const deckId = Number(deckIdRaw);
  const invalidDeckId = !deckId || Number.isNaN(deckId) || deckId <= 0;

  const [deckState, setDeckState] = useState<DeckState>({
    loading: !invalidDeckId,
    deck: null,
    error: invalidDeckId ? 'Missing or invalid deckId.' : null,
  });

  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [runResult, setRunResult] = useState<ImportRunResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (invalidDeckId) return;

    let cancelled = false;

    (async () => {
      try {
        const result = await fetchDeckById(deckId);
        if (cancelled) return;

        if (!result.success || !result.data) {
          setDeckState({ loading: false, deck: null, error: result.error?.message ?? 'Deck not found.' });
          return;
        }
        setDeckState({ loading: false, deck: result.data, error: null });
      } catch (err: unknown) {
        if (cancelled) return;
        setDeckState({
          loading: false,
          deck: null,
          error: err instanceof Error ? err.message : 'Network error.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deckId, invalidDeckId]);

  const deck = deckState.deck;

  function handleFile(file: File | null) {
    setFileError(null);
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setFileError(`Only ${ACCEPTED_EXTENSIONS.join(' and ')} files are accepted.`);
      // Clear the picker so choosing the same wrong file again still fires a
      // change event and re-shows the message.
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => setFileError('Could not read that file.');
    reader.onload = () => {
      setText(typeof reader.result === 'string' ? reader.result : '');
      setFileName(file.name);
    };
    reader.readAsText(file);
  }

  /**
   * Re-reads the deck from the server every time. The plan carries the row
   * versions it saw, so a preview built on a stale card list would hand the
   * runner an expectedVersion that is already wrong.
   */
  const buildPreview = useCallback(async () => {
    if (!deck) return;

    setPreviewing(true);
    setPreviewError(null);
    setRunResult(null);

    try {
      const parsed = parseDeckMarkdown(text);
      const cardsResult = await fetchCardsByDeck(deck.id);

      if (!cardsResult.success) {
        setPreviewError(cardsResult.error?.message ?? 'Failed to load the current deck contents.');
        return;
      }

      const existing = cardsResult.data ?? [];
      const plan = planImport(parsed, existing);
      const slugMismatch =
        parsed.deckSlug && deck.slug && parsed.deckSlug !== deck.slug ? parsed.deckSlug : null;

      setPreview({ parsed, plan, slugMismatch });
      setStep('preview');
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPreviewing(false);
    }
  }, [deck, text]);

  const actions = useMemo<ImportAction[]>(() => {
    if (!preview) return [];
    return [...preview.plan.creates, ...preview.plan.updates];
  }, [preview]);

  const blocked = useMemo(() => {
    if (!preview) return true;
    if (preview.parsed.errors.length > 0) return true;
    if (preview.plan.conflicts.length > 0) return true;
    if (preview.slugMismatch) return true;
    return false;
  }, [preview]);

  async function execute(toRun: readonly ImportAction[]) {
    if (!deck || toRun.length === 0) return;

    setRunning(true);
    setProgress({ done: 0, total: toRun.length });
    setStep('result');

    try {
      const result = await runImport(
        deck.id,
        toRun,
        { createCard, updateCard },
        (p) => setProgress({ done: p.done, total: p.total }),
      );
      setRunResult(result);
    } finally {
      setRunning(false);
    }
  }

  function restart() {
    setStep('input');
    setPreview(null);
    setPreviewError(null);
    setRunResult(null);
    setProgress({ done: 0, total: 0 });
  }

  const backLink = invalidDeckId ? '/' : `/decks/cards?deckId=${deckId}`;

  if (deckState.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading deck...</div>
      </div>
    );
  }

  if (deckState.error || !deck) {
    return (
      <div className="min-h-screen bg-slate-100">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-slate-800">Import Markdown</h1>
            <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
              ← Back to Decks
            </Link>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-6">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            <div className="font-semibold mb-1">Failed to load deck</div>
            <div className="text-sm">{deckState.error ?? 'Unknown error'}</div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">
              Import Markdown · <span className="font-mono text-base">{deck.slug}</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {deck.title} · step {step === 'input' ? '1 of 3 · source' : step === 'preview' ? '2 of 3 · preview' : '3 of 3 · execute'}
            </p>
          </div>
          <Link to={backLink} className="text-sm text-indigo-600 hover:text-indigo-800">
            ← Back to Cards
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {step === 'input' ? (
          <section className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">1 · Source</h2>
              <p className="text-xs text-slate-500 mt-1">
                Paste a deck document, or load a{' '}
                <span className="font-mono">.md</span> / <span className="font-mono">.txt</span> file.
                Cards are matched by <span className="font-mono">stableUid</span>, so importing the
                same file twice changes nothing.
              </p>
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.txt,text/markdown,text/plain"
                  className="text-sm text-slate-600"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
                {fileName ? (
                  <span className="text-xs text-slate-500 font-mono">{fileName}</span>
                ) : null}
              </div>

              {fileError ? (
                <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
                  {fileError}
                </div>
              ) : null}

              <textarea
                className="w-full h-80 font-mono text-xs border border-slate-300 rounded-md px-3 py-2
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                spellCheck={false}
                placeholder={'# deck: your-deck-slug\n\n## card-uid-001 | d2\nQ:\nQuestion text\nA:\nAnswer text'}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFileName(null);
                }}
              />

              {previewError ? (
                <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
                  {previewError}
                </div>
              ) : null}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={previewing || !text.trim()}
                  className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                             bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                             disabled:bg-slate-300 disabled:cursor-not-allowed
                             focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  onClick={() => void buildPreview()}
                >
                  {previewing ? 'Reading deck...' : 'Preview import'}
                </button>
                <span className="text-xs text-slate-500">
                  Nothing is written until you confirm on the next step.
                </span>
              </div>
            </div>
          </section>
        ) : null}

        {step === 'preview' && preview ? (
          <>
            <section className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">2 · Preview</h2>
                <button
                  type="button"
                  className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                  onClick={() => setStep('input')}
                >
                  ← Edit source
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge label="create" count={preview.plan.creates.length} tone={ACTION_CLASSES.create} />
                  <Badge label="update" count={preview.plan.updates.length} tone={ACTION_CLASSES.update} />
                  <Badge label="unchanged" count={preview.plan.unchanged.length} tone={ACTION_CLASSES.unchanged} />
                  <Badge label="conflict" count={preview.plan.conflicts.length} tone={ACTION_CLASSES.conflict} />
                  <Badge label="parse errors" count={preview.parsed.errors.length} tone={ACTION_CLASSES.conflict} />
                </div>

                {preview.slugMismatch ? (
                  <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
                    This document targets deck{' '}
                    <span className="font-mono">{preview.slugMismatch}</span>, but you are importing
                    into <span className="font-mono">{deck.slug}</span>. Fix the{' '}
                    <span className="font-mono"># deck:</span> header or open the right deck.
                  </div>
                ) : null}

                {preview.parsed.errors.length > 0 ? (
                  <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded">
                    <div className="font-semibold text-sm mb-1">
                      {preview.parsed.errors.length} problem
                      {preview.parsed.errors.length === 1 ? '' : 's'} in the document
                    </div>
                    <ul className="text-xs font-mono space-y-1 max-h-64 overflow-y-auto">
                      {preview.parsed.errors.map((issue, i) => (
                        <li key={`${issue.code}-${issue.line}-${i}`}>{formatIssue(issue)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>

            {preview.parsed.cards.length > 0 ? (
              <RarityDistribution cards={preview.parsed.cards} />
            ) : null}

            <section className="bg-white rounded-lg shadow-sm border border-slate-200">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Cards in this document</h3>
                <span className="text-xs text-slate-500">{preview.parsed.cards.length} parsed</span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Line</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">StableUid</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Diff</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Question</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Action</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toRows(preview.plan).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-500 text-sm">
                          No cards parsed from this document.
                        </td>
                      </tr>
                    ) : (
                      toRows(preview.plan).map((row) => (
                        <tr
                          key={`${row.card.stableUid}-${row.card.sourceLine}`}
                          className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-3 py-2 text-slate-500 font-mono text-xs">{row.card.sourceLine}</td>
                          <td className="px-3 py-2 text-slate-700 font-mono text-xs">{row.card.stableUid}</td>
                          <td className="px-3 py-2 text-slate-700">d{row.card.difficulty}</td>
                          <td className="px-3 py-2 text-slate-800">{truncate(row.card.question)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded border text-xs ${ACTION_CLASSES[row.kind]}`}>
                              {row.kind}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{row.detail}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-3">
                <button
                  type="button"
                  disabled={blocked || actions.length === 0 || running}
                  className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                             bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                             disabled:bg-slate-300 disabled:cursor-not-allowed
                             focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  onClick={() => void execute(actions)}
                >
                  Import {actions.length} card{actions.length === 1 ? '' : 's'}
                </button>

                <button
                  type="button"
                  className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                  disabled={previewing}
                  onClick={() => void buildPreview()}
                >
                  Refresh reconciliation
                </button>

                <span className="text-xs text-slate-500">
                  {blocked
                    ? 'Fix the problems above before importing.'
                    : actions.length === 0
                      ? 'Everything in this document already matches the deck.'
                      : `${preview.plan.unchanged.length} card(s) will be left alone.`}
                </span>
              </div>
            </section>
          </>
        ) : null}

        {step === 'result' ? (
          <section className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">3 · Execute</h2>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm text-slate-600 mb-1">
                  <span>{running ? 'Writing cards...' : 'Finished'}</span>
                  <span className="font-mono text-xs">
                    {progress.done} / {progress.total}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all"
                    style={{
                      width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              {runResult ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge label="created" count={runResult.created} tone={ACTION_CLASSES.create} />
                    <Badge label="updated" count={runResult.updated} tone={ACTION_CLASSES.update} />
                    <Badge label="failed" count={runResult.failures.length} tone={ACTION_CLASSES.conflict} />
                    <span className="text-xs text-slate-500 self-center">
                      counts describe the most recent run
                    </span>
                  </div>

                  {runResult.failures.length > 0 ? (
                    <div className="bg-red-50 border border-red-200 rounded px-3 py-2">
                      <div className="font-semibold text-sm text-red-800 mb-1">
                        {runResult.failures.length} card
                        {runResult.failures.length === 1 ? '' : 's'} failed
                      </div>
                      <ul className="text-xs text-red-800 space-y-1 max-h-64 overflow-y-auto">
                        {runResult.failures.map((failure) => (
                          <li key={failure.stableUid}>
                            <span className="font-mono">{failure.stableUid}</span>:{' '}
                            {describeFailure(failure)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded text-sm">
                      All planned writes succeeded.
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    {runResult.failures.length > 0 ? (
                      <button
                        type="button"
                        disabled={running}
                        className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                                   bg-indigo-600 text-white hover:bg-indigo-700
                                   disabled:bg-slate-300 disabled:cursor-not-allowed"
                        onClick={() => {
                          const retry = runResult.failures.map((f) => f.action);
                          void execute(retry);
                        }}
                      >
                        Retry {runResult.failures.length} failed
                      </button>
                    ) : null}

                    <button
                      type="button"
                      className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                      onClick={() => void buildPreview()}
                    >
                      Re-preview
                    </button>

                    <button
                      type="button"
                      className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                      onClick={restart}
                    >
                      Start over
                    </button>

                    <Link
                      to={backLink}
                      className="text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      Back to cards →
                    </Link>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
