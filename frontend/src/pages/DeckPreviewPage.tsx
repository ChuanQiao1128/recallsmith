// src/pages/DeckPreviewPage.tsx

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCards } from '../hooks/useCards';
import { useDeck } from '../hooks/useDecks';
import {
  buildDeckExportPreview,
  validateDeckExportLikeMobile,
  type DeckExportPreview,
} from '../lib/deckExportPreview';
import { CONSOLE_NAME } from '../lib/brand';
import { readSessionUser, isSuperAdmin } from '../auth/sessionUser';
import { ConsoleShell } from '../components/console/ConsoleShell';

async function copyToClipboard(text: string) {
  if (navigator.clipboard && (window.isSecureContext || location.hostname === 'localhost')) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function DeckPreviewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const deckIdRaw = searchParams.get('deckId') ?? '';
  const deckId = Number(deckIdRaw);
  const invalidDeckId = !deckId || Number.isNaN(deckId);
  const queryDeckId = invalidDeckId ? Number.NaN : deckId;

  // The deck and its cards come through the shared cache; both are read here
  // rather than fetched by hand, so opening the preview after the card list does
  // not download the whole deck again inside the staleTime window.
  const deckQuery = useDeck(queryDeckId);
  const cardsQuery = useCards(queryDeckId);

  const [copied, setCopied] = useState<string | null>(null);

  const deck = deckQuery.data ?? null;
  // Memoised so the empty-list fallback is a stable reference: exportModel's
  // useMemo lists it, and a fresh [] each render would recompute the export on
  // every render for a deck that has no cards.
  const cards = useMemo(() => cardsQuery.data ?? [], [cardsQuery.data]);

  const exportModel: DeckExportPreview | null = useMemo(
    () => (deck ? buildDeckExportPreview(deck, cards) : null),
    [deck, cards],
  );

  const { errors, warnings } = useMemo(() => validateDeckExportLikeMobile(exportModel), [exportModel]);
  const exportJson = useMemo(() => (exportModel ? JSON.stringify(exportModel, null, 2) : ''), [exportModel]);

  if (!invalidDeckId && (deckQuery.isPending || cardsQuery.isPending)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading preview...</div>
      </div>
    );
  }

  // Any failure — the deck, the cards, or an unusable deckId — collapses to one
  // error string and the same red box the hand-rolled version showed. A cards
  // failure still takes the whole screen rather than a half-built preview.
  const error = invalidDeckId
    ? 'Missing or invalid deckId.'
    : deckQuery.isError || !deck
      ? deckQuery.error instanceof Error
        ? deckQuery.error.message
        : 'Deck not found.'
      : cardsQuery.isError
        ? cardsQuery.error instanceof Error
          ? cardsQuery.error.message
          : 'Failed to load cards.'
        : null;

  if (error || !deck) {
    return (
      <ConsoleShell
        title={CONSOLE_NAME}
        subtitle="Authoring · Preview"
        decksHref="/"
        contentIntelligenceHref="/content-intelligence"
        adminUsersHref={isSuperAdmin(readSessionUser()) ? '/admin/users' : undefined}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-800">Deck Preview</h1>
          <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
            ← Back to Decks
          </Link>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            {error ?? 'Failed to load.'}
          </div>
        </div>
      </ConsoleShell>
    );
  }

  const liveCount = exportModel?.Cards.length ?? 0;
  const deletedCount = Math.max(0, cards.length - liveCount);

  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Authoring · Preview"
      decksHref="/"
      contentIntelligenceHref="/content-intelligence"
      adminUsersHref={isSuperAdmin(readSessionUser()) ? '/admin/users' : undefined}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Deck Preview</h1>
          <p className="text-xs text-slate-500 mt-1">
            {deck.title} · <span className="font-mono">{deck.slug}</span> · {deck.locale}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-sm text-slate-600 hover:text-slate-800"
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>
          <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
            Decks
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Approximate preview</div>
          <p className="mt-1">
            Built in this browser from the deck and its cards. The published deck.json is produced by the publish worker: its Version is the build id (shown here as 0.0.0), and other details can differ.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono">
              deckId={deckId}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
              deckType={deck.deckType}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
              cards={liveCount}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
              deletedHidden={deletedCount}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono">
              version={(exportModel?.Version ?? '')}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
              freeCardCount={(exportModel?.FreeCardCount ?? 0)}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={async () => {
                try {
                  await copyToClipboard(exportJson);
                  setCopied('Copied!');
                  setTimeout(() => setCopied(null), 1200);
                } catch {
                  setCopied('Copy failed');
                  setTimeout(() => setCopied(null), 1200);
                }
              }}
              disabled={!exportJson || errors.length > 0}
            >
              Copy JSON
            </button>

            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => downloadText(`${deck.slug}-deck.json`, exportJson)}
              disabled={!exportJson || errors.length > 0}
            >
              Download deck.json
            </button>

            {copied ? <span className="text-xs text-slate-500">{copied}</span> : null}

            {/* A disabled button with no reason next to it is its own small
                defect. The buttons used to check only for an empty payload, so
                the console would hand out a deck.json its own validator had
                already rejected — a file that fails later, on a device, with no
                validator attached. Warnings do not block: they are advice, and
                gating on them would make the gate constant and therefore
                meaningless. */}
            {exportJson && errors.length > 0 ? (
              <span className="text-xs text-red-700">
                {errors.length} validation {errors.length === 1 ? 'error' : 'errors'} to fix before this can be exported.
              </span>
            ) : null}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <h2 className="text-sm font-semibold text-slate-800">Validation (mobile-compatible)</h2>

          {errors.length === 0 ? (
            <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
              ✅ No blocking errors.
            </div>
          ) : (
            <div className="mt-2 bg-red-50 border border-red-200 rounded px-3 py-2">
              <div className="text-sm font-semibold text-red-800">Blocking errors</div>
              <ul className="mt-1 text-sm text-red-800 list-disc pl-5">
                {errors.map(e => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 ? (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <div className="text-sm font-semibold text-amber-900">Warnings</div>
              <ul className="mt-1 text-sm text-amber-900 list-disc pl-5">
                {warnings.map(w => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <h2 className="text-sm font-semibold text-slate-800">Approximate deck.json</h2>
          <pre className="mt-2 text-xs bg-slate-950 text-slate-100 rounded p-3 overflow-auto">
            {exportJson}
          </pre>
        </div>
      </div>
    </ConsoleShell>
  );
}