// src/features/qa/SemanticDuplicatesPanel.tsx
//
// "Semantic duplicates" on the AI QA page (R20 contract §5, V10): card pairs in
// one deck whose embeddings are at least 0.90 cosine apart, each card linked to
// the editor, plus how many of the deck's cards have a current embedding.
//
// The vectors come from the owner's local embedding push, not from any model
// call here. A server without the `vector` extension or the card_embeddings
// table answers 503 VECTOR_NOT_READY; that is an owner step, not an error, so
// it gets a neutral callout that names the steps. A server that predates these
// routes answers 404 "Route not found" (code NOT_FOUND; a missing deck is
// DECK_NOT_FOUND instead), which also gets a neutral callout, not an error.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  fetchEmbeddingsStatus,
  fetchSemanticDuplicates,
  type EmbeddingsStatus,
  type SemanticDuplicateCard,
  type SemanticDuplicates,
} from '../../api/embeddings';
import { CARD_CLASS, H2_CLASS, TD_CLASS, TH_CLASS } from '../../components/console/consoleStyles';
import { Callout } from '../../components/ui/Callout';
import type { ApiError } from '../../types/api';

type LoadError = { code: string; message: string; httpStatus?: number };

type PanelState = {
  forDeckId: number | null;
  status: EmbeddingsStatus | null;
  statusError: LoadError | null;
  duplicates: SemanticDuplicates | null;
  duplicatesError: LoadError | null;
};

const VECTOR_NOT_READY = 'VECTOR_NOT_READY';

function toLoadError(error: ApiError | null, fallback: string): LoadError {
  return { code: error?.code ?? 'UNKNOWN', message: error?.message ?? fallback, httpStatus: error?.httpStatus };
}

/** True when the server has no such route: it predates R20 V06. */
function isMissingRoute(error: LoadError | null): boolean {
  return error?.httpStatus === 404 && (error.code === 'NOT_FOUND' || error.code === 'HTTP_404');
}

function editorHref(deckId: number, card: SemanticDuplicateCard): string {
  return `/decks/cards/edit?deckId=${deckId}&cardId=${card.cardId}`;
}

function CardCell({ deckId, card }: { deckId: number; card: SemanticDuplicateCard }) {
  const name = card.question || card.stableUid || `Card ${card.cardId}`;
  return (
    <td className={TD_CLASS}>
      <Link to={editorHref(deckId, card)} className="text-indigo-700 underline" aria-label={`Open in editor: ${name}`}>
        {name}
      </Link>
      {card.stableUid ? <div className="text-xs text-slate-500 font-mono">{card.stableUid}</div> : null}
    </td>
  );
}

export function SemanticDuplicatesPanel({ deckId }: { deckId: number }) {
  const [state, setState] = useState<PanelState>({
    forDeckId: null,
    status: null,
    statusError: null,
    duplicates: null,
    duplicatesError: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const [statusRes, duplicatesRes] = await Promise.all([
        fetchEmbeddingsStatus(deckId),
        fetchSemanticDuplicates(deckId),
      ]);
      if (cancelled) return;
      setState({
        forDeckId: deckId,
        status: statusRes.success ? statusRes.data : null,
        statusError: statusRes.success ? null : toLoadError(statusRes.error, 'Failed to load the embeddings status.'),
        duplicates: duplicatesRes.success ? duplicatesRes.data : null,
        duplicatesError: duplicatesRes.success
          ? null
          : toLoadError(duplicatesRes.error, 'Failed to load the semantic duplicates.'),
      });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const loading = state.forDeckId !== deckId;
  const notReady =
    !loading &&
    (state.statusError?.code === VECTOR_NOT_READY ||
      state.duplicatesError?.code === VECTOR_NOT_READY ||
      state.status?.engine === 'none');
  const olderServer = !loading && !notReady && (isMissingRoute(state.statusError) || isMissingRoute(state.duplicatesError));
  const neutral = notReady || olderServer;
  const status = state.status;
  const duplicates = state.duplicates;

  return (
    <section className={CARD_CLASS} aria-labelledby="qa-semantic-heading" data-testid="qa-semantic-duplicates">
      <h2 id="qa-semantic-heading" className={H2_CLASS}>
        Semantic duplicates
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Card pairs in this deck whose meaning is nearly the same (cosine similarity of their embeddings).
      </p>

      {loading ? <p className="mt-2 text-sm text-slate-500">Loading semantic duplicates…</p> : null}

      {notReady ? (
        <div className="mt-2" data-testid="qa-semantic-not-ready">
          <Callout tone="info" title="Semantic search is not set up yet">
            <p>The server has no card embeddings to compare. The owner sets it up in three steps:</p>
            <ol className="mt-1 ml-5 list-decimal space-y-0.5">
              <li>Install the pgvector extension on the database (CREATE EXTENSION vector, as the database owner).</li>
              <li>Run the database migration again, so it creates the card embeddings table.</li>
              <li>Push the embeddings from the owner&apos;s machine (dc-evals embed-cards --deck &lt;slug&gt; --push).</li>
            </ol>
          </Callout>
        </div>
      ) : null}

      {olderServer ? (
        <div className="mt-2" data-testid="qa-semantic-older-server">
          <Callout tone="info" title="Semantic duplicates are not on this server yet">
            <p>The server predates semantic duplicates. The panel fills in once the server is updated.</p>
          </Callout>
        </div>
      ) : null}

      {!loading && !neutral && state.statusError ? (
        <div className="mt-2">
          <Callout tone="danger" role="alert">
            {state.statusError.message}
          </Callout>
        </div>
      ) : null}

      {!loading && !neutral && status ? (
        <p className="mt-2 text-sm text-slate-700" data-testid="qa-semantic-status">
          {status.embedded} of {status.cards} card(s) embedded
          {status.stale > 0 ? `, ${status.stale} stale (the card changed since it was embedded)` : ''}
          {status.model ? ` · model ${status.model}` : ''}.
        </p>
      ) : null}

      {!loading && !neutral && state.duplicatesError ? (
        <div className="mt-2">
          <Callout tone="danger" role="alert">
            {state.duplicatesError.message}
          </Callout>
        </div>
      ) : null}

      {!loading && !neutral && duplicates ? (
        duplicates.pairs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No pair at or above cosine {duplicates.minCosine.toFixed(2)}.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="Semantic duplicate pairs">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className={TH_CLASS}>Cosine</th>
                  <th scope="col" className={TH_CLASS}>Card A</th>
                  <th scope="col" className={TH_CLASS}>Card B</th>
                </tr>
              </thead>
              <tbody>
                {duplicates.pairs.map(pair => (
                  <tr key={`${pair.a.cardId}-${pair.b.cardId}`} className="border-t border-slate-100 align-top">
                    <td className={`${TD_CLASS} font-mono`}>{pair.cosine.toFixed(3)}</td>
                    <CardCell deckId={deckId} card={pair.a} />
                    <CardCell deckId={deckId} card={pair.b} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
