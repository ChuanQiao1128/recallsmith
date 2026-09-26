// src/lib/deckExportPreview.ts
//
// The pure export-model builder behind the Deck Preview page. It rebuilds
// deck.json in the browser as an *approximate* preview: the published file is
// produced by the publish worker, whose Version is the build id. The card shape
// mirrors the worker's CardExportData (src_C/Worker/S3/IS3DeckUploader.cs), so
// JSON.stringify key order matches, and Topic/Mcq are appended after Revision
// only when present — the worker writes them with WhenWritingNull.

import type { Card } from '../types/card';
import type { Deck } from '../types/deck';
import type { McqBlob } from '../types/mcq';

export type DeckExportPreviewCard = {
  StableUid: string;
  OrderInDeck: number;
  Difficulty: number;
  Question: string;
  Explanation: string | null;
  CodeSnippet: string | null;
  RealWorldUsage?: string | null;
  CodeLanguage: string | null;
  Revision?: number;
  Topic?: string;
  Mcq?: McqBlob;
};

export type DeckExportPreview = {
  Slug: string;
  Version: string;
  Title: string;
  Locale: string;
  DeckType: number;
  IsFreeStarter: boolean;
  TotalCards: number;
  FreeCardCount: number;
  Cards: DeckExportPreviewCard[];
};

// Preview is pinned to 0.0.0 by decision: it is not a published build.
export const PREVIEW_VERSION = '0.0.0';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidSemver(v: string): boolean {
  return /^(?:\d+\.){2}\d+(?:[+-][0-9A-Za-z.-]+)?$/.test(v.trim());
}

export function buildDeckExportPreview(deck: Deck, cards: Card[]): DeckExportPreview {
  const liveCards = cards
    .filter(c => (c.isDeleted ?? 0) === 0)
    .slice()
    .sort((a, b) => a.orderInDeck - b.orderInDeck);

  const totalCards = liveCards.length;

  const version = PREVIEW_VERSION;

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

  const Cards: DeckExportPreviewCard[] = liveCards.map(c => {
    const explanation = c.explanation?.trim() ? c.explanation : null;
    const codeSnippet = c.codeSnippet?.trim() ? c.codeSnippet : null;
    const codeLanguage = c.codeLanguage?.trim() ? c.codeLanguage : null;

    const realWorld = c.realWorldUsage ?? null;
    const realWorldUsage =
      typeof realWorld === 'string' && realWorld.trim().length > 0 ? realWorld : null;

    const revision = c.revision ?? null;

    const card: DeckExportPreviewCard = {
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

    // Append Topic and Mcq after Revision, the way the publish worker writes
    // them (CardExportData property order). Omit the key when absent to mirror
    // WhenWritingNull; never write Topic: null / Mcq: null / undefined.
    if (typeof c.topic === 'string' && c.topic.trim() !== '') {
      card.Topic = c.topic;
    }
    if (c.mcq !== null && typeof c.mcq === 'object') {
      // Pass the server's object through as received: the worker also writes
      // the stored jsonb as is, so we do not rebuild, reorder or normalise it.
      card.Mcq = c.mcq;
    }

    return card;
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
}

export function validateDeckExportLikeMobile(model: DeckExportPreview | null): {
  errors: string[];
  warnings: string[];
} {
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
