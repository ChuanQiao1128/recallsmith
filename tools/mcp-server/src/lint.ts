// lint_card: the console importer's rules (bundled from frontend/src/lib via
// ./deckLib), the server-only option-length rule from frontend/scripts/lint-deck.mts,
// and the draft citation + topic rules of contract §8.4.

import { readFileSync } from 'node:fs';
import { parseDeckMarkdown, serializeDeckMarkdown, type DeckCardContent } from './deckLib';
import type { DraftCard } from './draftCard';

export interface LintItem {
  code: string;
  message: string;
}

export interface LintResult {
  ok: boolean;
  issues: LintItem[];
  warnings: LintItem[];
}

/** Mirrors McqValidation.cs step 9 (`options[i].Text.Length > 600`), as lint-deck.mts does. */
const MCQ_OPTION_MAX_LENGTH = 600;

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * The per-deck TOPIC labels of content/decks/FORMAT.md §5: each `### 5.N … (`<slug>`)`
 * heading starts a deck, and every body row of the table below it contributes the
 * last backtick span of its last cell.
 */
export function parseTopicVocabulary(formatMd: string): Map<string, string[]> {
  const vocabulary = new Map<string, string[]>();
  const lines = formatMd.split(/\r?\n/);
  let inSection = false;
  let labels: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^## /.test(line)) {
      inSection = /^## 5\./.test(line);
      labels = null;
      continue;
    }
    if (!inSection) continue;

    const heading = /^### 5\.\d+\b.*\(`([^`]+)`\)/.exec(line);
    if (heading) {
      const slug = heading[1] ?? '';
      labels = vocabulary.get(slug) ?? [];
      vocabulary.set(slug, labels);
      continue;
    }
    if (/^### /.test(line)) {
      labels = null;
      continue;
    }
    if (labels === null || !line.trim().startsWith('|')) continue;
    if (isSeparatorRow(line)) continue;
    const next = lines[i + 1] ?? '';
    if (next.trim().startsWith('|') && isSeparatorRow(next)) continue; // header row

    const cells = splitRow(line);
    const spans = [...(cells[cells.length - 1] ?? '').matchAll(/`([^`]+)`/g)];
    const label = spans[spans.length - 1]?.[1];
    if (label !== undefined) labels.push(label);
  }
  return vocabulary;
}

const vocabularyCache = new Map<string, Map<string, string[]>>();

/** FORMAT.md is read once per process (per repo root); a missing file means no vocabulary. */
export function loadTopicVocabulary(repoRoot: string): Map<string, string[]> {
  let vocabulary = vocabularyCache.get(repoRoot);
  if (vocabulary === undefined) {
    let text = '';
    try {
      text = readFileSync(`${repoRoot}/content/decks/FORMAT.md`, 'utf8');
    } catch {
      text = '';
    }
    vocabulary = parseTopicVocabulary(text);
    vocabularyCache.set(repoRoot, vocabulary);
  }
  return vocabulary;
}

function toDeckCardContent(card: DraftCard): DeckCardContent {
  const content: DeckCardContent = {
    stableUid: card.stableUid,
    difficulty: card.difficulty,
    question: card.question,
    explanation: card.explanation,
    codeSnippet: card.codeSnippet ?? null,
    codeLanguage: card.codeLanguage ?? null,
    realWorldUsage: card.realWorldUsage ?? null,
  };
  if (typeof card.topic === 'string' && card.topic.trim() !== '') content.topic = card.topic;
  if (card.mcq) content.mcq = card.mcq;
  if (card.source) content.source = { url: card.source.url, quote: card.source.quote.trim() || null };
  return content;
}

/** Collapses every whitespace run to one space and trims; nothing else, so the quote stays verbatim. */
function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function lintDraftCard(
  input: { deckSlug: string; card: DraftCard; sourceChunkText?: string },
  vocabulary: Map<string, string[]>,
): LintResult {
  const { deckSlug, card, sourceChunkText } = input;
  const issues: LintItem[] = [];
  const warnings: LintItem[] = [];

  // 1. The console importer, through a one-card deck document.
  const parsed = parseDeckMarkdown(serializeDeckMarkdown(deckSlug, [toDeckCardContent(card)]));
  for (const error of parsed.errors) issues.push({ code: error.code, message: error.message });
  for (const warning of parsed.warnings) warnings.push({ code: warning.code, message: warning.message });

  // 2. Server-only option length (lint-deck.mts).
  for (const option of card.mcq?.options ?? []) {
    const length = option.text.trim().length;
    if (length > MCQ_OPTION_MAX_LENGTH) {
      issues.push({
        code: 'MCQ_OPTION_TOO_LONG',
        message: `Option "${option.key}" of card "${card.stableUid}" is ${length} characters; the server allows at most ${MCQ_OPTION_MAX_LENGTH}.`,
      });
    }
  }

  // 3. A draft must cite its source.
  const source = card.source;
  if (source === undefined || source.url.trim() === '' || source.quote.trim() === '') {
    const missing = source === undefined ? 'has no source' : source.url.trim() === '' ? 'has a blank source url' : 'has a blank source quote';
    issues.push({
      code: 'SOURCE_REQUIRED',
      message: `Card "${card.stableUid}" ${missing}; every draft needs source.url and a verbatim source.quote.`,
    });
  } else if (sourceChunkText !== undefined) {
    // 4. The quote must appear in the chunk it claims to come from.
    if (!normaliseWhitespace(sourceChunkText).includes(normaliseWhitespace(source.quote))) {
      issues.push({
        code: 'SOURCE_QUOTE_NOT_IN_CHUNK',
        message: `The source quote of card "${card.stableUid}" is not a verbatim substring of the given chunk text (whitespace-insensitive, case-sensitive).`,
      });
    }
  }

  // 5. Topic vocabulary (a warning; decks without a vocabulary are not checked).
  const labels = vocabulary.get(deckSlug);
  if (labels !== undefined && labels.length > 0) {
    const topic = typeof card.topic === 'string' ? card.topic : '';
    if (!labels.includes(topic)) {
      warnings.push({
        code: 'TOPIC_NOT_IN_VOCABULARY',
        message:
          topic.trim() === ''
            ? `Card "${card.stableUid}" has no topic; deck "${deckSlug}" uses one label from content/decks/FORMAT.md §5.`
            : `Topic "${topic}" of card "${card.stableUid}" is not a label of deck "${deckSlug}" in content/decks/FORMAT.md §5.`,
      });
    }
  }

  return { ok: issues.length === 0, issues, warnings };
}
