// src/pages/DeckPreviewPage.tsx

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchDeckById, fetchCardsByDeck } from '../api/authoring';
import type { Deck } from '../types/deck';
import type { Card } from '../types/card';

type DeckExportCard = {
  StableUid: string;
  OrderInDeck: number;
  Difficulty: number;
  Question: string;
  Explanation: string | null;
  CodeSnippet: string | null;
  RealWorldUsage?: string | null;
  CodeLanguage: string | null;
  Revision?: number;
};

type DeckExport = {
  Slug: string;
  Version: string;
  Title: string;
  Locale: string;
  DeckType: number;
  IsFreeStarter: boolean;
  TotalCards: number;
  FreeCardCount: number;
  Cards: DeckExportCard[];
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidSemver(v: string): boolean {
  return /^(?:\d+\.){2}\d+(?:[+-][0-9A-Za-z.-]+)?$/.test(v.trim());
}

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

function validateDeckExportLikeMobile(model: DeckExport | null) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!model) {
    errors.push('No model generated.');
    return { errors, warnings };
  }

  if (!isNonEmptyString(model.Slug)) errors.push('Deck.Slug is required.');
  if (!isNonEmptyString(model.Version)) errors.push('Deck.Version is required.');
  if (isNonEmptyString(model.Version) && !isValidSemver(model.Version)) {
    warnings.push(`Deck.Version "${model.Version}" is not strict semver (recommended).`);
  }

  if (!Array.isArray(model.Cards)) errors.push('Deck.Cards must be an array.');

  const seenUid = new Set<string>();
  const seenOrder = new Set<number>();

  for (let i = 0; i < model.Cards.length; i++) {
    const c = model.Cards[i];
    const idx = i + 1;

    if (!isNonEmptyString(c.StableUid)) errors.push(`Card #${idx}: StableUid is required.`);
    if (!isFiniteNumber(c.OrderInDeck)) errors.push(`Card #${idx}: OrderInDeck must be a number.`);

    if (isNonEmptyString(c.StableUid)) {
      if (seenUid.has(c.StableUid)) errors.push(`Duplicate StableUid: "${c.StableUid}"`);
      seenUid.add(c.StableUid);
    }

    if (isFiniteNumber(c.OrderInDeck)) {
      if (seenOrder.has(c.OrderInDeck)) errors.push(`Duplicate OrderInDeck: ${c.OrderInDeck}`);
      seenOrder.add(c.OrderInDeck);
      if (c.OrderInDeck <= 0) warnings.push(`Card "${c.StableUid}": OrderInDeck should be > 0.`);
    }

    if (!isNonEmptyString(c.Question)) warnings.push(`Card "${c.StableUid}": Question is empty.`);
    if (!isFiniteNumber(c.Difficulty) || c.Difficulty < 1 || c.Difficulty > 3) {
      warnings.push(`Card "${c.StableUid}": Difficulty should be 1..3.`);
    }
  }

  if (model.TotalCards !== model.Cards.length) {
    warnings.push(`TotalCards(${model.TotalCards}) != Cards.length(${model.Cards.length}).`);
  }
  if (model.FreeCardCount > model.TotalCards) {
    warnings.push(`FreeCardCount(${model.FreeCardCount}) > TotalCards(${model.TotalCards}).`);
  }

  return { errors, warnings };
}

export function DeckPreviewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const deckIdRaw = searchParams.get('deckId') ?? '';
  const deckId = Number(deckIdRaw);
  const invalidDeckId = !deckId || Number.isNaN(deckId);

  const [loading, setLoading] = useState(!invalidDeckId);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(invalidDeckId ? 'Missing or invalid deckId.' : null);

  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (invalidDeckId) return;

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [deckRes, cardsRes] = await Promise.all([fetchDeckById(deckId), fetchCardsByDeck(deckId)]);
        if (cancelled) return;

        if (!deckRes.success || !deckRes.data) {
          setDeck(null);
          setCards([]);
          setError(deckRes.error?.message ?? 'Deck not found.');
          setLoading(false);
          return;
        }

        if (!cardsRes.success) {
          setDeck(deckRes.data);
          setCards([]);
          setError(cardsRes.error?.message ?? 'Failed to load cards.');
          setLoading(false);
          return;
        }

        setDeck(deckRes.data);
        setCards(cardsRes.data ?? []);
        setLoading(false);
      } catch (e: unknown) {
        if (cancelled) return;
        setDeck(null);
        setCards([]);
        setError(e instanceof Error ? e.message : 'Network error.');
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [deckId, invalidDeckId]);

  const exportModel: DeckExport | null = useMemo(() => {
    if (!deck) return null;

    const liveCards = cards
      .filter(c => (c.isDeleted ?? 0) === 0)
      .slice()
      .sort((a, b) => a.orderInDeck - b.orderInDeck);

    const totalCards = liveCards.length;

    // ✅ 你要求：Preview 永远固定 0.0.0
    const version = '0.0.0';

    const isFreeStarter =
      typeof deck.isFreeStarter === 'boolean' ? deck.isFreeStarter : deck.deckType === 1;

    const freeCardCountRaw = deck.freeCardCount;
    const freeCardCountCandidate =
      deck.deckType === 1
        ? totalCards
        : Number.isFinite(freeCardCountRaw)
          ? Number(freeCardCountRaw)
          : 50;

    const freeCardCount = Math.max(0, Math.min(freeCardCountCandidate, totalCards));

    const Cards: DeckExportCard[] = liveCards.map(c => {
      const explanation = c.explanation?.trim() ? c.explanation : null;
      const codeSnippet = c.codeSnippet?.trim() ? c.codeSnippet : null;
      const codeLanguage = c.codeLanguage?.trim() ? c.codeLanguage : null;

      const realWorld = c.realWorldUsage ?? null;
      const realWorldUsage =
        typeof realWorld === 'string' && realWorld.trim().length > 0 ? realWorld : null;

      const revision = c.revision ?? null;

      return {
        StableUid: c.stableUid,
        OrderInDeck: c.orderInDeck,
        Difficulty: isFiniteNumber(c.difficulty) ? c.difficulty : 2,
        Question: c.question ?? '',
        Explanation: explanation,
        CodeSnippet: codeSnippet,
        RealWorldUsage: realWorldUsage,
        CodeLanguage: codeLanguage,
        ...(Number.isFinite(revision) ? { Revision: Number(revision) } : {}),
      };
    });

    return {
      Slug: deck.slug,
      Version: version,
      Title: deck.title,
      Locale: deck.locale,
      DeckType: deck.deckType,
      IsFreeStarter: !!isFreeStarter,
      TotalCards: totalCards,
      FreeCardCount: freeCardCount,
      Cards,
    };
  }, [deck, cards]);

  const { errors, warnings } = useMemo(() => validateDeckExportLikeMobile(exportModel), [exportModel]);
  const exportJson = useMemo(() => (exportModel ? JSON.stringify(exportModel, null, 2) : ''), [exportModel]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading preview...</div>
      </div>
    );
  }

  if (error || !deck) {
    return (
      <div className="min-h-screen bg-slate-100">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-slate-800">Deck Preview</h1>
            <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
              ← Back to Decks
            </Link>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-6">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            {error ?? 'Failed to load.'}
          </div>
        </main>
      </div>
    );
  }

  const liveCount = exportModel?.Cards.length ?? 0;
  const deletedCount = Math.max(0, cards.length - liveCount);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
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
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
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
                有 {errors.length} 条校验错误，先修好才能导出。
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
          <h2 className="text-sm font-semibold text-slate-800">DeckExport JSON</h2>
          <pre className="mt-2 text-xs bg-slate-950 text-slate-100 rounded p-3 overflow-auto">
            {exportJson}
          </pre>
        </div>
      </main>
    </div>
  );
}