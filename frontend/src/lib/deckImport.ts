// src/lib/deckImport.ts
//
// Markdown deck import: parse -> validate -> reconcile. Pure functions only,
// so the whole import decision is testable without a network or a DOM.
//
// Format (see docs/console-import-plan.md, shared with the C# deck design doc):
//
//   # deck: csharp-backend-fundamentals
//
//   ## cs-async-001 | d2
//   TOPIC: <one line, optional, max 80 chars>
//   QUALIFIER: <one line, optional; an MCQ card only>
//   Q:
//   <question lines>
//   OPT: <a-f>            (an MCQ card only; "OPT: <a-f> *" marks a correct option)
//   <option lines>
//   WHY:                  (explains the OPT: above it; required for a wrong option)
//   <why lines>
//   A:
//   <explanation lines>
//   CODE: csharp
//   <code lines>
//   USAGE:
//   <real world usage lines>
//   SOURCE: <https url>    (optional; the lines below it are the quote)
//   <quote lines>
//
// A card may also carry its built-in Simplified Chinese (zh-CN) translation:
// each translatable section gets a `_ZH` twin right after it (QUALIFIER_ZH:,
// Q_ZH:, OPT_ZH:, WHY_ZH:, A_ZH:, USAGE_ZH:). OPT_ZH:/WHY_ZH: bind to the
// nearest OPT: above them; correct marks, code, topic and the source quote
// stay English only. A card with one _ZH section needs all that apply. A
// misspelled _ZH marker ("Q_ZH :", a fullwidth colon) is refused, never glued
// into the English section above it.
//
// Two deliberate lexing rules make hand written files predictable:
//
// 1. A marker is only a marker at column 0. Indented text is always content,
//    which is what lets a code snippet contain a line such as "  ## header".
// 2. Blank lines carry no meaning anywhere, including inside a section body.
//    The format is advertised as blank line tolerant, so a blank line must
//    never change the parse result; the price is that a blank line inside a
//    code snippet is dropped rather than preserved. Paying that price here
//    keeps "insert a blank line to make it readable" a safe edit for authors.

import type { Card, CardSource } from '../types/card';
import type { McqBlob } from '../types/mcq';
import type { CardTranslation, CardTranslations, TranslatedMcq } from '../types/translation';
import { hasContent, isValidDifficulty, isValidStableUid } from './cardRules';
import { validateMcq, normalizeMcqForCompare, mcqOf, OPT_PAYLOAD, type McqIssueCode } from './mcqRules';
import { warnMcq, sortWarnings, type ImportWarning } from './mcqWarnings';
import {
  isValidSourceUrl,
  normalizeSourceForCompare,
  SOURCE_QUOTE_MAX_LENGTH,
  SOURCE_URL_MAX_LENGTH,
} from './sourceRules';
import {
  hasCjk,
  normalizeTranslationsForCompare,
  translationsOf,
  validateTranslation,
  warnTranslation,
  type TranslationIssueCode,
} from './translationRules';

// ---------------------- types ----------------------

/** Card content as it exists in a markdown document, before ordering. */
export interface DeckCardContent {
  stableUid: string;
  difficulty: number;
  question: string;
  explanation: string;
  codeSnippet: string | null;
  codeLanguage: string | null;
  realWorldUsage: string | null;
  /** Optional grouping label (server column cards.topic). ABSENT, never null, when the card has no TOPIC: line. */
  topic?: string;
  /** MCQ payload (server column cards.mcq). ABSENT, never null, on a Q/A card (a card with no OPT:/WHY:/QUALIFIER: line). */
  mcq?: McqBlob;
  /** Citation (server column cards.source). ABSENT, never null, when the card has no SOURCE: line. */
  source?: CardSource;
  /** Built-in translations (server column cards.translations). ABSENT, never null, when the card has no _ZH section. */
  translations?: CardTranslations;
}

export interface ParsedCard extends DeckCardContent {
  /** Position in the file times 10, leaving room to insert cards later. */
  orderInDeck: number;
  /** 1-based line of the `##` header, so the UI can point at the card. */
  sourceLine: number;
}

export type ImportIssueCode =
  | 'EMPTY_DOCUMENT'
  | 'MISSING_DECK_HEADER'
  | 'DUPLICATE_DECK_HEADER'
  | 'BAD_DECK_SLUG'
  | 'BAD_CARD_HEADER'
  | 'BAD_DIFFICULTY'
  | 'BAD_UID_FORMAT'
  | 'DUPLICATE_UID'
  | 'DUPLICATE_SECTION'
  | 'MISSING_QUESTION'
  | 'MISSING_ANSWER'
  | 'TEXT_BEFORE_CARD'
  | 'TEXT_BEFORE_SECTION'
  | 'BAD_TOPIC'
  | 'DUPLICATE_TOPIC'
  | McqIssueCode
  | 'MCQ_DUPLICATE_QUALIFIER'
  | 'BAD_SOURCE_URL'
  | 'SOURCE_QUOTE_TOO_LONG'
  | 'ZH_UNSUPPORTED_FIELD'
  | 'ZH_BAD_MARKER'
  | 'ZH_MISSING_FIELD'
  | 'ZH_BAD_OPT_LINE'
  | 'ZH_WITHOUT_OPTION'
  | 'EN_FIELD_HAS_CJK'
  | TranslationIssueCode;

export interface ImportIssue {
  code: ImportIssueCode;
  /** 1-based line number in the source document. Always present. */
  line: number;
  message: string;
  /** Set when the issue can be attributed to a specific card. */
  stableUid?: string;
}

export interface ParsedDeck {
  deckSlug: string | null;
  /** Only structurally complete cards. A broken card never silently ships. */
  cards: ParsedCard[];
  errors: ImportIssue[];
  /** Non-blocking suggestions (mcqWarnings.ts). Never members of errors; the page and lint-deck print them, nothing gates on them. */
  warnings: ImportWarning[];
}

export type ConflictReason =
  | 'INVALID_CARD'
  | 'DUPLICATE_UID_IN_FILE'
  | 'AMBIGUOUS_EXISTING_UID'
  | 'EXISTING_SOFT_DELETED'
  | 'TRANSLATIONS_WOULD_BE_CLEARED';

/** Fields compared when deciding update vs unchanged. */
export type ComparableField =
  | 'question'
  | 'difficulty'
  | 'orderInDeck'
  | 'explanation'
  | 'codeSnippet'
  | 'codeLanguage'
  | 'realWorldUsage'
  | 'topic'
  | 'mcq'
  | 'source'
  | 'translations';

export interface ImportCreate {
  kind: 'create';
  card: ParsedCard;
}

export interface ImportUpdate {
  kind: 'update';
  card: ParsedCard;
  existingId: number;
  /** Server version at plan time, passed straight to updateCard for CAS. */
  expectedVersion: number;
  changedFields: ComparableField[];
  /**
   * Set only when the operator opted in (PlanImportOptions.allowClearTranslations)
   * and this update deletes the card's stored translation. The runner refuses an
   * update that would delete one without it.
   */
  clearsTranslations?: true;
  /**
   * Set when the file's translation equals the stored one but the server marks
   * it stale (its English changed after it was written): the update re-sends
   * it, which restamps it as current. translationPlanWarnings says so.
   */
  restampsStaleTranslation?: true;
}

export interface ImportUnchanged {
  kind: 'unchanged';
  card: ParsedCard;
  existingId: number;
}

export interface ImportConflict {
  kind: 'conflict';
  card: ParsedCard;
  reason: ConflictReason;
  message: string;
}

export interface ImportPlan {
  creates: ImportCreate[];
  updates: ImportUpdate[];
  unchanged: ImportUnchanged[];
  conflicts: ImportConflict[];
}

// ---------------------- lexing helpers ----------------------

const DECK_HEADER = /^#[ \t]*deck:[ \t]*(.*)$/i;
const CARD_HEADER = /^##[ \t]+(.*)$/;
const QUESTION_MARKER = /^Q:[ \t]?(.*)$/;
const ANSWER_MARKER = /^A:[ \t]?(.*)$/;
const CODE_MARKER = /^CODE:[ \t]?(.*)$/;
const USAGE_MARKER = /^USAGE:[ \t]?(.*)$/;
// Loose on purpose (MCQ plan §4.4): a column-0 "TOPIC:" line is always this marker,
// and the payload is validated afterwards, so a bad topic is reported instead of being
// glued to the open section by the catch-all at the end of the loop.
const TOPIC_MARKER = /^TOPIC:(.*)$/;
/** Same limit as the server's Helpers.ParseOptionalTopic (C05): measured on the trimmed payload. */
export const TOPIC_MAX_LENGTH = 80;
// Loose on purpose (MCQ plan §4.4): a column-0 OPT:/WHY:/QUALIFIER: line is always
// its marker, and the payload is validated afterwards, so a mistyped "OPT: g" is
// reported at its own line instead of being glued to the open section by the
// catch-all at the end of the loop.
const OPT_MARKER = /^OPT:(.*)$/;
const WHY_MARKER = /^WHY:(.*)$/;
const QUALIFIER_MARKER = /^QUALIFIER:(.*)$/;
// Loose on purpose, like TOPIC_MARKER: a column-0 SOURCE: line is always this
// marker; the payload is the URL, the lines below it are the quote.
const SOURCE_MARKER = /^SOURCE:(.*)$/;
// The zh-CN twins of the translatable sections. Q_ZH:/A_ZH:/USAGE_ZH:/WHY_ZH:
// take text like their English markers; QUALIFIER_ZH: is single line; OPT_ZH:
// takes no payload (it translates the OPT: above it, text on the lines below).
const QUALIFIER_ZH_MARKER = /^QUALIFIER_ZH:(.*)$/;
const QUESTION_ZH_MARKER = /^Q_ZH:[ \t]?(.*)$/;
const OPT_ZH_MARKER = /^OPT_ZH:(.*)$/;
const WHY_ZH_MARKER = /^WHY_ZH:(.*)$/;
const ANSWER_ZH_MARKER = /^A_ZH:[ \t]?(.*)$/;
const USAGE_ZH_MARKER = /^USAGE_ZH:[ \t]?(.*)$/;
// Every other column-0 "<NAME>_ZH:" (SOURCE_ZH:, CODE_ZH:, TOPIC_ZH: ...) is
// reserved and refused, so it can never be glued into the open section. The
// net is wider than the contract's form: a space before the colon or a
// fullwidth colon (U+FF1A, what a Chinese keyboard types), as in "Q_ZH :" or
// "Q_ZH\uFF1A", is caught too and refused as ZH_BAD_MARKER instead of being
// glued, silently, into the English section above it.
const RESERVED_ZH_MARKER = /^([A-Z]+)_ZH\s*[:\uFF1A]/;
const RESERVED_ZH_EXACT = /^[A-Z]+_ZH:/;

/**
 * The card uid rule moved to cardRules.ts (UID_PATTERN + MAX_UID_LENGTH,
 * reached here through isValidStableUid) so the hand-entry form can share the
 * same predicates. It still accepts kebab uids (`cs-async-001`) and the
 * `card_<ts>_<rand>` shape that api/authoring.ts ensureStableUid falls back to,
 * so a card created in the single card form can round trip through an export
 * and back in.
 *
 * SLUG_PATTERN stays here. It is the DECK slug rule, which no card form has an
 * opinion about; it only looks identical to the uid rule by coincidence, and
 * merging the two would couple a deck-level rule to a card-level one.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

type SectionKind =
  | 'question' | 'answer' | 'code' | 'usage' | 'source' | `option:${string}` | `why:${string}`
  | 'question_zh' | 'answer_zh' | 'usage_zh' | `option_zh:${string}` | `why_zh:${string}`;

/** The marker a zh section kind is written with, for messages; English kinds keep their old wording. */
function sectionName(kind: SectionKind): string {
  if (kind === 'question_zh') return 'Q_ZH:';
  if (kind === 'answer_zh') return 'A_ZH:';
  if (kind === 'usage_zh') return 'USAGE_ZH:';
  if (kind.startsWith('option_zh:')) return `OPT_ZH: of option "${kind.slice('option_zh:'.length)}"`;
  if (kind.startsWith('why_zh:')) return `WHY_ZH: of option "${kind.slice('why_zh:'.length)}"`;
  return kind;
}

interface Section {
  line: number;
  lines: string[];
}

/** MCQ state accumulated across a card's OPT:/WHY:/QUALIFIER: lines. */
interface McqDraft {
  qualifier: string | null;
  qualifierSeen: boolean;
  options: Array<{ key: string; correct: boolean }>;
  lastOptionKey: string | null;
}

interface CardDraft {
  headerLine: number;
  stableUid: string;
  difficulty: number;
  sections: Partial<Record<SectionKind, Section>>;
  codeLanguage: string | null;
  topic: string | null;
  topicSeen: boolean;
  topicInvalid: boolean;
  /** The valid SOURCE: url; null when the card has no SOURCE: line or its url was refused. */
  sourceUrl: string | null;
  /** Set by BAD_SOURCE_URL: finishCard drops the card, like a BAD_TOPIC. */
  sourceInvalid: boolean;
  /** null until the first OPT:/WHY:/QUALIFIER: line. A card that never sees one is a Q/A card and gets no `mcq` key. */
  mcq: McqDraft | null;
  /** Set by MCQ_BAD_OPT_LINE: finishCard drops the card and reports nothing further for it. */
  dropped: boolean;
  /** Line of the first _ZH marker; null on an English-only card, which gets no `translations` key. */
  zhLine: number | null;
  /** The QUALIFIER_ZH: payload ('' when empty), null until one is seen. */
  zhQualifier: string | null;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function sectionText(section: Section | undefined): string {
  if (!section) return '';
  return section.lines.join('\n');
}

/** Creates the MCQ draft on the first OPT:/WHY:/QUALIFIER: line and returns it. */
function ensureMcq(draft: CardDraft): McqDraft {
  if (draft.mcq === null) {
    draft.mcq = { qualifier: null, qualifierSeen: false, options: [], lastOptionKey: null };
  }
  return draft.mcq;
}

// ---------------------- parse ----------------------

/**
 * Parses a deck document. One broken card is reported and skipped rather than
 * failing the whole file, because a 200 card paste with one typo should still
 * show the operator the other 199.
 */
export function parseDeckMarkdown(text: string): ParsedDeck {
  const errors: ImportIssue[] = [];
  const cards: ParsedCard[] = [];

  // Strip BOM and normalize CRLF/CR up front, so line numbers below are the
  // numbers the author sees in their editor regardless of line endings.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  let deckSlug: string | null = null;
  let deckHeaderLine = 0;
  let draft: CardDraft | null = null;
  let currentSection: Section | null = null;
  // True while dropping the body of a repeated section, so those lines are not
  // also reported as stray text.
  let swallowing = false;
  // One stray text complaint per stretch. A malformed header would otherwise
  // turn its whole card body into a wall of identical errors.
  let strayInCardReported = false;
  let strayBeforeCardReported = false;

  const pushIssue = (
    code: ImportIssueCode,
    line: number,
    message: string,
    stableUid?: string,
  ): void => {
    errors.push(stableUid === undefined ? { code, line, message } : { code, line, message, stableUid });
  };

  const finishCard = (): void => {
    if (!draft) return;
    const d = draft;
    draft = null;
    currentSection = null;

    // A card flagged by MCQ_BAD_OPT_LINE is dropped whole: the error is already
    // reported at the offending line, and shipping half of it would hide it.
    if (d.dropped) return;

    const question = sectionText(d.sections.question);
    const explanation = sectionText(d.sections.answer);

    if (!question) {
      pushIssue(
        'MISSING_QUESTION',
        d.sections.question?.line ?? d.headerLine,
        `Card "${d.stableUid}" has no Q: content.`,
        d.stableUid,
      );
    }
    if (!explanation) {
      pushIssue(
        'MISSING_ANSWER',
        d.sections.answer?.line ?? d.headerLine,
        `Card "${d.stableUid}" has no A: content.`,
        d.stableUid,
      );
    }
    if (!question || !explanation || d.topicInvalid || d.sourceInvalid) return;

    const codeSnippet = sectionText(d.sections.code) || null;
    const realWorldUsage = sectionText(d.sections.usage) || null;

    // A translated card must translate every section its English card has
    // (contract §3): a half-translated card would show mixed languages, so it
    // is dropped like a card without Q:, one issue per missing section.
    if (d.zhLine !== null) {
      const missing: string[] = [];
      if (d.mcq?.qualifierSeen && d.zhQualifier === null) missing.push('QUALIFIER_ZH:');
      if (!d.sections.question_zh) missing.push('Q_ZH:');
      for (const option of d.mcq?.options ?? []) {
        if (!d.sections[`option_zh:${option.key}`]) missing.push(`OPT_ZH: for option "${option.key}"`);
        if (sectionText(d.sections[`why:${option.key}`]) && !d.sections[`why_zh:${option.key}`]) {
          missing.push(`WHY_ZH: for option "${option.key}"`);
        }
      }
      if (!d.sections.answer_zh) missing.push('A_ZH:');
      if (realWorldUsage && !d.sections.usage_zh) missing.push('USAGE_ZH:');
      for (const name of missing) {
        pushIssue(
          'ZH_MISSING_FIELD',
          d.headerLine,
          `Card "${d.stableUid}" has a Chinese translation but no ${name}; a translated card needs the _ZH twin of every section it has.`,
          d.stableUid,
        );
      }
      if (missing.length > 0) return;
    }

    // A card with at least one MCQ marker becomes an MCQ card. shuffle is always
    // true (the format has no marker for it) and v is always 1.
    const mcq: McqBlob | null = d.mcq
      ? {
          v: 1,
          qualifier: d.mcq.qualifier,
          shuffle: true,
          options: d.mcq.options.map((o) => ({
            key: o.key,
            text: sectionText(d.sections[`option:${o.key}`]),
            why: sectionText(d.sections[`why:${o.key}`]) || null,
            correct: o.correct,
          })),
        }
      : null;

    // Built from whatever _ZH sections the author wrote, extras included, so
    // validateTranslation (via validateCards) can name what does not match.
    let translations: CardTranslations | undefined;
    if (d.zhLine !== null) {
      const zhMcq: TranslatedMcq | null =
        d.mcq || d.zhQualifier !== null
          ? {
              qualifier: d.zhQualifier,
              options: Object.fromEntries(
                (d.mcq?.options ?? []).map((o) => [
                  o.key,
                  {
                    text: sectionText(d.sections[`option_zh:${o.key}`]),
                    why: sectionText(d.sections[`why_zh:${o.key}`]) || null,
                  },
                ]),
              ),
            }
          : null;
      const usageZh = sectionText(d.sections.usage_zh);
      const entry: CardTranslation = {
        v: 1,
        question: sectionText(d.sections.question_zh),
        explanation: sectionText(d.sections.answer_zh),
        ...(usageZh ? { realWorldUsage: usageZh } : {}),
        ...(zhMcq ? { mcq: zhMcq } : {}),
      };
      translations = { 'zh-CN': entry };
    }

    cards.push({
      stableUid: d.stableUid,
      difficulty: d.difficulty,
      question,
      explanation,
      codeSnippet,
      // Language without a snippet is meaningless, and a snippet without a
      // language is legal (the format allows a bare `CODE:`).
      codeLanguage: codeSnippet ? d.codeLanguage : null,
      realWorldUsage,
      ...(d.topic !== null ? { topic: d.topic } : {}),
      // Position × 10 leaves room to insert later. Position 0 becomes 5, not 0:
      // the production cards table carries ck_cards_order_in_deck_positive
      // (order_in_deck > 0; migration 020 records it), so a 0 is a guaranteed
      // 500 on the first card of every file — the live decks already sit at 5
      // for that reason (2026-09-21, the 371-card AWS import).
      orderInDeck: cards.length === 0 ? 5 : cards.length * 10,
      sourceLine: d.headerLine,
      ...(mcq ? { mcq } : {}),
      ...(d.sourceUrl !== null
        ? { source: { url: d.sourceUrl, quote: sectionText(d.sections.source).trim() || null } }
        : {}),
      ...(translations ? { translations } : {}),
    });
  };

  // Returns the section to append to, or null when the body must be dropped.
  // The caller assigns the result, which is what keeps `currentSection`
  // narrowable: a let assigned only inside a closure still reads as its
  // initial type at the use site, so assigning from a return value is what
  // lets the compiler see a real section there.
  const openSection = (kind: SectionKind, line: number, firstLine: string): Section | null => {
    if (!draft) return null;
    if (draft.sections[kind]) {
      if (kind.startsWith('option:')) {
        pushIssue(
          'MCQ_DUPLICATE_OPTION_KEY',
          line,
          `Card "${draft.stableUid}" repeats option "${kind.slice('option:'.length)}"; the first one wins.`,
          draft.stableUid,
        );
        swallowing = true;
        return null;
      }
      pushIssue(
        'DUPLICATE_SECTION',
        line,
        `Card "${draft.stableUid}" repeats the ${sectionName(kind)} section; the first one wins.`,
        draft.stableUid,
      );
      // Keep the first section intact and swallow the repeat, so the result
      // does not depend on which copy the author edited last.
      swallowing = true;
      return null;
    }
    const section: Section = { line, lines: [] };
    if (!isBlank(firstLine)) section.lines.push(firstLine.trimEnd());
    draft.sections[kind] = section;
    swallowing = false;
    return section;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;

    if (isBlank(raw)) continue;

    const cardMatch = CARD_HEADER.exec(raw);
    if (cardMatch) {
      finishCard();
      swallowing = false;
      strayInCardReported = false;
      strayBeforeCardReported = false;
      const header = cardMatch[1].trim();
      const parts = header.split('|');
      const uid = (parts[0] ?? '').trim();
      const difficultyToken = (parts[1] ?? '').trim();

      if (parts.length !== 2 || !uid || !difficultyToken) {
        pushIssue(
          'BAD_CARD_HEADER',
          lineNo,
          `Card header must look like "## <stable-uid> | d<0-4>", got "## ${header}".`,
        );
        continue;
      }

      const difficultyMatch = /^d(\d+)$/.exec(difficultyToken);
      if (!difficultyMatch) {
        pushIssue(
          'BAD_DIFFICULTY',
          lineNo,
          `Difficulty must be written as d0..d4, got "${difficultyToken}".`,
          uid,
        );
        continue;
      }
      const difficulty = Number(difficultyMatch[1]);
      if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 4) {
        pushIssue(
          'BAD_DIFFICULTY',
          lineNo,
          `Difficulty must be between 0 and 4, got "${difficultyToken}".`,
          uid,
        );
        continue;
      }

      draft = {
        headerLine: lineNo,
        stableUid: uid,
        difficulty,
        sections: {},
        codeLanguage: null,
        topic: null,
        topicSeen: false,
        topicInvalid: false,
        sourceUrl: null,
        sourceInvalid: false,
        mcq: null,
        dropped: false,
        zhLine: null,
        zhQualifier: null,
      };
      currentSection = null;
      continue;
    }

    const deckMatch = DECK_HEADER.exec(raw);
    if (deckMatch) {
      const slug = deckMatch[1].trim();
      if (deckSlug !== null) {
        pushIssue(
          'DUPLICATE_DECK_HEADER',
          lineNo,
          `Deck header already declared on line ${deckHeaderLine}; a file imports into one deck.`,
        );
        continue;
      }
      deckHeaderLine = lineNo;
      if (!slug) {
        pushIssue('BAD_DECK_SLUG', lineNo, 'Deck header has no slug.');
        continue;
      }
      if (!SLUG_PATTERN.test(slug)) {
        pushIssue('BAD_DECK_SLUG', lineNo, `Deck slug "${slug}" is not a lowercase kebab slug.`);
        continue;
      }
      deckSlug = slug;
      continue;
    }

    if (!draft) {
      if (!strayBeforeCardReported) {
        strayBeforeCardReported = true;
        pushIssue(
          'TEXT_BEFORE_CARD',
          lineNo,
          'Text outside any card. Cards start with "## <stable-uid> | d<0-4>".',
        );
      }
      continue;
    }

    const topicMatch = TOPIC_MARKER.exec(raw);
    if (topicMatch) {
      const topic = topicMatch[1].trim();
      if (draft.topicSeen) {
        pushIssue(
          'DUPLICATE_TOPIC',
          lineNo,
          `Card "${draft.stableUid}" repeats the TOPIC: line; the first one wins.`,
          draft.stableUid,
        );
        continue;
      }
      draft.topicSeen = true;
      if (!topic) {
        pushIssue('BAD_TOPIC', lineNo, `Card "${draft.stableUid}" has an empty TOPIC: line.`, draft.stableUid);
        draft.topicInvalid = true;
        continue;
      }
      if (topic.length > TOPIC_MAX_LENGTH) {
        pushIssue(
          'BAD_TOPIC',
          lineNo,
          `Card "${draft.stableUid}" has a topic that is longer than ${TOPIC_MAX_LENGTH} characters.`,
          draft.stableUid,
        );
        draft.topicInvalid = true;
        continue;
      }
      draft.topic = topic;
      continue;
    }

    const qualifierMatch = QUALIFIER_MARKER.exec(raw);
    if (qualifierMatch) {
      const mcq = ensureMcq(draft);
      // Single line, like TOPIC:; it never touches currentSection.
      if (mcq.qualifierSeen) {
        pushIssue(
          'MCQ_DUPLICATE_QUALIFIER',
          lineNo,
          `Card "${draft.stableUid}" repeats the QUALIFIER: line; the first one wins.`,
          draft.stableUid,
        );
        continue;
      }
      // An empty payload is stored as '' so validateMcq reports MCQ_QUALIFIER_EMPTY.
      mcq.qualifier = qualifierMatch[1].trim();
      mcq.qualifierSeen = true;
      continue;
    }

    const sourceMatch = SOURCE_MARKER.exec(raw);
    if (sourceMatch) {
      // A repeat reports DUPLICATE_SECTION, keeps the first and swallows its
      // body; its payload is never evaluated.
      if (draft.sections.source) {
        currentSection = openSection('source', lineNo, '');
        continue;
      }
      const url = sourceMatch[1].trim();
      if (!isValidSourceUrl(url)) {
        pushIssue(
          'BAD_SOURCE_URL',
          lineNo,
          `Card "${draft.stableUid}" has a SOURCE: url that is not an https:// URL without spaces of at most ${SOURCE_URL_MAX_LENGTH} characters.`,
          draft.stableUid,
        );
        draft.sourceInvalid = true;
      } else {
        draft.sourceUrl = url;
      }
      // Either way the quote lines below belong to this section, so they never
      // raise TEXT_BEFORE_SECTION.
      currentSection = openSection('source', lineNo, '');
      continue;
    }

    const optMatch = OPT_MARKER.exec(raw);
    if (optMatch) {
      const mcq = ensureMcq(draft);
      const payload = OPT_PAYLOAD.exec(optMatch[1]);
      if (!payload) {
        pushIssue(
          'MCQ_BAD_OPT_LINE',
          lineNo,
          `Card "${draft.stableUid}": OPT: must be "OPT: <a-f>" or "OPT: <a-f> *" on its own line, got "${raw.trimEnd()}".`,
          draft.stableUid,
        );
        // The line is never appended to the open section, and the body that
        // follows it is swallowed silently: the whole card is dropped anyway.
        draft.dropped = true;
        currentSection = null;
        swallowing = true;
        continue;
      }
      const key = payload[1].toLowerCase();
      const correct = payload[2] === '*';
      currentSection = openSection(`option:${key}`, lineNo, '');
      if (currentSection) mcq.options.push({ key, correct });
      mcq.lastOptionKey = key;
      continue;
    }

    const whyMatch = WHY_MARKER.exec(raw);
    if (whyMatch) {
      const mcq = ensureMcq(draft);
      if (mcq.lastOptionKey === null) {
        pushIssue(
          'MCQ_WHY_WITHOUT_OPTION',
          lineNo,
          `Card "${draft.stableUid}" has a WHY: line before any OPT: line.`,
          draft.stableUid,
        );
        // The orphan body must not also raise TEXT_BEFORE_SECTION.
        currentSection = null;
        swallowing = true;
        continue;
      }
      currentSection = openSection(`why:${mcq.lastOptionKey}`, lineNo, whyMatch[1].replace(/^[ \t]/, ''));
      continue;
    }

    const questionMatch = QUESTION_MARKER.exec(raw);
    if (questionMatch) {
      currentSection = openSection('question', lineNo, questionMatch[1]);
      continue;
    }
    const answerMatch = ANSWER_MARKER.exec(raw);
    if (answerMatch) {
      currentSection = openSection('answer', lineNo, answerMatch[1]);
      continue;
    }
    const usageMatch = USAGE_MARKER.exec(raw);
    if (usageMatch) {
      currentSection = openSection('usage', lineNo, usageMatch[1]);
      continue;
    }
    const codeMatch = CODE_MARKER.exec(raw);
    if (codeMatch) {
      const language = codeMatch[1].trim();
      const alreadySeen = draft.sections.code !== undefined;
      currentSection = openSection('code', lineNo, '');
      if (!alreadySeen) draft.codeLanguage = language || null;
      continue;
    }

    // ---- zh-CN translation markers (contract §3) ----
    const qualifierZhMatch = QUALIFIER_ZH_MARKER.exec(raw);
    if (qualifierZhMatch) {
      draft.zhLine ??= lineNo;
      // Single line, like QUALIFIER:; it never touches currentSection.
      if (draft.zhQualifier !== null) {
        pushIssue(
          'DUPLICATE_SECTION',
          lineNo,
          `Card "${draft.stableUid}" repeats the QUALIFIER_ZH: line; the first one wins.`,
          draft.stableUid,
        );
        continue;
      }
      draft.zhQualifier = qualifierZhMatch[1].trim();
      continue;
    }

    const questionZhMatch = QUESTION_ZH_MARKER.exec(raw);
    if (questionZhMatch) {
      draft.zhLine ??= lineNo;
      currentSection = openSection('question_zh', lineNo, questionZhMatch[1]);
      continue;
    }

    const optZhMatch = OPT_ZH_MARKER.exec(raw);
    if (optZhMatch) {
      draft.zhLine ??= lineNo;
      const payload = optZhMatch[1].trim();
      if (payload !== '') {
        // A star here would be a second, contradicting answer key; anything
        // else is a mistyped marker. Either way the card is dropped, like an
        // MCQ_BAD_OPT_LINE, and its body swallowed.
        if (payload.includes('*')) {
          pushIssue(
            'TRANSLATION_CORRECT_MARK',
            lineNo,
            `Card "${draft.stableUid}": OPT_ZH: never carries "*"; correct answers are marked only on the English OPT: line.`,
            draft.stableUid,
          );
        } else {
          pushIssue(
            'ZH_BAD_OPT_LINE',
            lineNo,
            `Card "${draft.stableUid}": OPT_ZH: takes no payload (it translates the OPT: above it; the text goes on the lines below), got "${raw.trimEnd()}".`,
            draft.stableUid,
          );
        }
        draft.dropped = true;
        currentSection = null;
        swallowing = true;
        continue;
      }
      const key = draft.mcq?.lastOptionKey ?? null;
      if (key === null) {
        pushIssue(
          'ZH_WITHOUT_OPTION',
          lineNo,
          `Card "${draft.stableUid}" has an OPT_ZH: line before any OPT: line.`,
          draft.stableUid,
        );
        currentSection = null;
        swallowing = true;
        continue;
      }
      currentSection = openSection(`option_zh:${key}`, lineNo, '');
      continue;
    }

    const whyZhMatch = WHY_ZH_MARKER.exec(raw);
    if (whyZhMatch) {
      draft.zhLine ??= lineNo;
      const key = draft.mcq?.lastOptionKey ?? null;
      if (key === null) {
        pushIssue(
          'ZH_WITHOUT_OPTION',
          lineNo,
          `Card "${draft.stableUid}" has a WHY_ZH: line before any OPT: line.`,
          draft.stableUid,
        );
        currentSection = null;
        swallowing = true;
        continue;
      }
      currentSection = openSection(`why_zh:${key}`, lineNo, whyZhMatch[1].replace(/^[ \t]/, ''));
      continue;
    }

    const answerZhMatch = ANSWER_ZH_MARKER.exec(raw);
    if (answerZhMatch) {
      draft.zhLine ??= lineNo;
      currentSection = openSection('answer_zh', lineNo, answerZhMatch[1]);
      continue;
    }
    const usageZhMatch = USAGE_ZH_MARKER.exec(raw);
    if (usageZhMatch) {
      draft.zhLine ??= lineNo;
      currentSection = openSection('usage_zh', lineNo, usageZhMatch[1]);
      continue;
    }

    const reservedZhMatch = RESERVED_ZH_MARKER.exec(raw);
    if (reservedZhMatch) {
      // Every exact spelling of the six markers was taken above, so an exact
      // "<NAME>_ZH:" here names a section that has no translation, and
      // anything else is one of the six (or a reserved name) misspelled.
      if (RESERVED_ZH_EXACT.test(raw)) {
        pushIssue(
          'ZH_UNSUPPORTED_FIELD',
          lineNo,
          `Card "${draft.stableUid}": ${reservedZhMatch[1]}_ZH: is not a translatable section; only QUALIFIER_ZH:, Q_ZH:, OPT_ZH:, WHY_ZH:, A_ZH: and USAGE_ZH: exist (code, topic and the source quote stay English).`,
          draft.stableUid,
        );
      } else {
        pushIssue(
          'ZH_BAD_MARKER',
          lineNo,
          `Card "${draft.stableUid}": "${reservedZhMatch[0]}" is not a marker as written; a translation marker is exactly QUALIFIER_ZH:, Q_ZH:, OPT_ZH:, WHY_ZH:, A_ZH: or USAGE_ZH:, with an ASCII colon and no space before it.`,
          draft.stableUid,
        );
      }
      // The body is dropped silently rather than glued to the section above.
      currentSection = null;
      swallowing = true;
      continue;
    }

    if (currentSection === null) {
      if (!swallowing && !strayInCardReported) {
        strayInCardReported = true;
        pushIssue(
          'TEXT_BEFORE_SECTION',
          lineNo,
          `Card "${draft.stableUid}" has text before its first Q:/A:/CODE:/USAGE: marker.`,
          draft.stableUid,
        );
      }
      continue;
    }

    currentSection.lines.push(raw.trimEnd());
  }

  finishCard();

  if (deckSlug === null && deckHeaderLine === 0) {
    pushIssue(
      lines.every(isBlank) ? 'EMPTY_DOCUMENT' : 'MISSING_DECK_HEADER',
      1,
      'Document must start with "# deck: <slug>".',
    );
  }

  errors.push(...validateCards(cards));

  const warnings: ImportWarning[] = [];
  for (const card of cards) {
    if (!card.mcq) continue;
    for (const w of warnMcq({ question: card.question, realWorldUsage: card.realWorldUsage, mcq: card.mcq })) {
      warnings.push({ code: w.code, severity: 'warning', line: card.sourceLine, message: w.message, stableUid: card.stableUid });
    }
    if (!card.translations) continue;
    for (const w of warnTranslation({ translations: card.translations, mcq: card.mcq })) {
      warnings.push({ code: w.code, severity: 'warning', line: card.sourceLine, message: w.message, stableUid: card.stableUid });
    }
  }

  return { deckSlug, cards, errors: sortIssues(errors), warnings: sortWarnings(warnings) };
}

/** Stable ordering so two parses of the same text give byte identical issues. */
function sortIssues(issues: ImportIssue[]): ImportIssue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => (a.issue.line - b.issue.line) || (a.index - b.index))
    .map((entry) => entry.issue);
}

// ---------------------- validate ----------------------

/**
 * Semantic checks over already parsed cards. Kept separate from parsing so the
 * preview UI can re-validate a list the operator edited in place.
 *
 * The uid uniqueness check is the important one. Nothing between a deck export
 * and the mobile draw enforces uid uniqueness: gacha/draw/poolSelection.ts had
 * to grow its own dedupe after a duplicated StableUid let one pull grant the
 * same card twice, showing two reveals while the owned set (keyed by uid) grew
 * by one, so the player was silently short a card they paid for. Authoring is
 * the first place a duplicate can be refused, and refusing it here is cheaper
 * than every downstream consumer defending itself.
 */
export function validateCards(
  cards: readonly ParsedCard[],
  options: { deckLocale?: string | null } = {},
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const firstSeen = new Map<string, number>();
  // A file with one translated card is a bilingual file, so Chinese in any
  // card's English sections is a mistake there, not a Chinese deck.
  const fileHasTranslations = cards.some((card) => card.translations !== undefined);

  for (const card of cards) {
    if (!isValidStableUid(card.stableUid)) {
      issues.push({
        code: 'BAD_UID_FORMAT',
        line: card.sourceLine,
        message: `Stable uid "${card.stableUid}" must be lowercase kebab-case, for example "cs-async-001".`,
        stableUid: card.stableUid,
      });
    }

    const seenAt = firstSeen.get(card.stableUid);
    if (seenAt !== undefined) {
      issues.push({
        code: 'DUPLICATE_UID',
        line: card.sourceLine,
        message: `Stable uid "${card.stableUid}" is already used on line ${seenAt}. Uids must be unique within a deck.`,
        stableUid: card.stableUid,
      });
    } else {
      firstSeen.set(card.stableUid, card.sourceLine);
    }

    if (!isValidDifficulty(card.difficulty)) {
      issues.push({
        code: 'BAD_DIFFICULTY',
        line: card.sourceLine,
        message: `Difficulty must be an integer between 0 and 4, got ${card.difficulty}.`,
        stableUid: card.stableUid,
      });
    }

    if (!hasContent(card.question)) {
      issues.push({
        code: 'MISSING_QUESTION',
        line: card.sourceLine,
        message: `Card "${card.stableUid}" has an empty question.`,
        stableUid: card.stableUid,
      });
    }
    if (!hasContent(card.explanation)) {
      issues.push({
        code: 'MISSING_ANSWER',
        line: card.sourceLine,
        message: `Card "${card.stableUid}" has an empty answer.`,
        stableUid: card.stableUid,
      });
    }

    // Every MCQ issue blocks: planImport re-runs validateCards and turns any
    // issue with a stableUid into an INVALID_CARD conflict, and the page blocks
    // on parsed.errors. The non-blocking tier lives in mcqWarnings.ts and is
    // collected by parseDeckMarkdown into ParsedDeck.warnings, never here.
    if (card.mcq) {
      for (const issue of validateMcq({
        question: card.question,
        explanation: card.explanation,
        difficulty: card.difficulty,
        mcq: card.mcq,
      })) {
        issues.push({ code: issue.code, line: card.sourceLine, message: issue.message, stableUid: card.stableUid });
      }
    }

    if (card.source) {
      if (card.source.quote !== null && card.source.quote.length > SOURCE_QUOTE_MAX_LENGTH) {
        issues.push({
          code: 'SOURCE_QUOTE_TOO_LONG',
          line: card.sourceLine,
          message: `Card "${card.stableUid}" has a source quote longer than ${SOURCE_QUOTE_MAX_LENGTH} characters.`,
          stableUid: card.stableUid,
        });
      }
      // Never fires for a parsed card (the parser drops it); it guards an
      // edited list that planImport re-validates.
      if (!isValidSourceUrl(card.source.url)) {
        issues.push({
          code: 'BAD_SOURCE_URL',
          line: card.sourceLine,
          message: `Card "${card.stableUid}" has a source url that is not an https:// URL without spaces of at most ${SOURCE_URL_MAX_LENGTH} characters.`,
          stableUid: card.stableUid,
        });
      }
    }

    // A translated card is checked against its own English (contract §2), and
    // its English must not contain Chinese: on a bilingual card that is almost
    // always zh text pasted into the wrong section, or a _ZH marker mistyped
    // so that its text joined the section above. Once a file carries one
    // translation the check covers every card in it, the untranslated ones
    // too. A file with no translated card is not checked at all, so a deck
    // written in Chinese (aws-saa-fundamentals) is unaffected.
    if (card.translations || fileHasTranslations) {
      const cjkFields = englishCjkFields(card);
      if (cjkFields.length > 0) {
        issues.push({
          code: 'EN_FIELD_HAS_CJK',
          line: card.sourceLine,
          message: card.translations
            ? `Card "${card.stableUid}" has a Chinese translation, but its English ${cjkFields.join(', ')} contain Chinese characters; Chinese text belongs in the _ZH sections.`
            : `Card "${card.stableUid}" has no _ZH sections, but its English ${cjkFields.join(', ')} contain Chinese characters, in a file that carries Chinese translations; Chinese text belongs in the _ZH sections.`,
          stableUid: card.stableUid,
        });
      }
    }
    if (card.translations) {
      for (const issue of validateTranslation({
        translations: card.translations,
        english: {
          question: card.question,
          explanation: card.explanation,
          realWorldUsage: card.realWorldUsage,
          mcq: card.mcq ?? null,
        },
        deckLocale: options.deckLocale,
      })) {
        issues.push({ code: issue.code, line: card.sourceLine, message: `Card "${card.stableUid}": ${issue.message}`, stableUid: card.stableUid });
      }
    }
  }

  return sortIssues(issues);
}

/** The English sections of a card that contain a Han character, named by their markers. */
function englishCjkFields(card: ParsedCard): string[] {
  const fields: string[] = [];
  if (hasCjk(card.question)) fields.push('Q:');
  if (card.mcq?.qualifier && hasCjk(card.mcq.qualifier)) fields.push('QUALIFIER:');
  for (const option of card.mcq?.options ?? []) {
    if (hasCjk(option.text)) fields.push(`OPT: ${option.key}`);
    if (option.why !== null && hasCjk(option.why)) fields.push(`WHY: of option "${option.key}"`);
  }
  if (hasCjk(card.explanation)) fields.push('A:');
  if (card.realWorldUsage !== null && hasCjk(card.realWorldUsage)) fields.push('USAGE:');
  return fields;
}

// ---------------------- plan ----------------------

const COMPARABLE_FIELDS: readonly ComparableField[] = [
  'question',
  'difficulty',
  'orderInDeck',
  'explanation',
  'codeSnippet',
  'codeLanguage',
  'realWorldUsage',
  'topic',
  'mcq',
  'source',
  'translations',
];

/**
 * The server round trips absent optional text as either null or "", so both
 * have to normalize to the same thing or a re-import of an untouched file
 * would report updates and idempotence would be a lie.
 */
function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function fieldsThatDiffer(card: ParsedCard, existing: Card): ComparableField[] {
  const changed: ComparableField[] = [];
  for (const field of COMPARABLE_FIELDS) {
    if (field === 'difficulty' || field === 'orderInDeck') {
      if (card[field] !== existing[field]) changed.push(field);
      continue;
    }
    if (field === 'mcq') {
      // Server null, a missing key on an old server, and file absence all
      // normalize to '' (mcqOf reads the wire key without a typed Card.mcq).
      if (normalizeMcqForCompare(card.mcq) !== normalizeMcqForCompare(mcqOf(existing))) changed.push(field);
      continue;
    }
    if (field === 'source') {
      // Server null, a missing key on an old server, and file absence all
      // normalize to ''; a blank quote equals a null one.
      if (normalizeSourceForCompare(card.source) !== normalizeSourceForCompare(existing.source)) changed.push(field);
      continue;
    }
    if (field === 'translations') {
      // Like mcq: server null, a missing key on an old server and a card with
      // no _ZH section all normalize to ''. A translation the server marks
      // stale is a change even when its text is identical: only a write that
      // carries it restamps its basis, so planning it unchanged would leave
      // the deck behind the publish gate's TRANSLATION_STALE for good.
      if (
        normalizeTranslationsForCompare(card.translations) !== normalizeTranslationsForCompare(translationsOf(existing)) ||
        restampsStaleTranslation(card, existing)
      ) {
        changed.push(field);
      }
      continue;
    }
    if (normalizeText(card[field]) !== normalizeText(existing[field])) changed.push(field);
  }
  return changed;
}

/**
 * True when the file carries the very translation the server holds, for a
 * locale the server marks 'stale' (translationStatus): writing it restamps
 * the stored basis, so the import turns a stale translation current without
 * changing a word of it.
 */
function restampsStaleTranslation(card: ParsedCard, existing: Card): boolean {
  if (card.translations === undefined) return false;
  const stale = Object.keys(card.translations).some(
    (locale) => existing.translationStatus?.[locale as keyof CardTranslations] === 'stale',
  );
  return (
    stale &&
    normalizeTranslationsForCompare(card.translations) === normalizeTranslationsForCompare(translationsOf(existing))
  );
}

export interface PlanImportOptions {
  /**
   * The operator ticked "clear translations": an update that deletes a stored
   * translation goes ahead (marked clearsTranslations) instead of becoming a
   * TRANSLATIONS_WOULD_BE_CLEARED conflict.
   */
  allowClearTranslations?: boolean;
  /** The target deck's locale, so a translation into the deck's own language is refused. */
  deckLocale?: string | null;
}

/**
 * Reconciles a parsed document against the deck as the server currently has
 * it. Keyed on stableUid, never on question text or row id, because uid is the
 * only identity that survives an edit.
 *
 * Pure and deterministic: running it twice on the same inputs yields the same
 * plan, and running it against the result of applying it yields an all
 * unchanged plan. That is what makes re-importing the same file a no-op.
 */
export function planImport(
  parsed: Pick<ParsedDeck, 'cards'>,
  existingCards: readonly Card[],
  options: PlanImportOptions = {},
): ImportPlan {
  const plan: ImportPlan = { creates: [], updates: [], unchanged: [], conflicts: [] };

  // Cards that failed validation never reach the API. planImport re-runs the
  // check rather than trusting the caller to have looked at parsed.errors.
  const invalidUids = new Map<string, ImportIssue>();
  for (const issue of validateCards(parsed.cards, { deckLocale: options.deckLocale })) {
    if (issue.stableUid === undefined) continue;
    if (!invalidUids.has(issue.stableUid)) invalidUids.set(issue.stableUid, issue);
  }

  const byUid = new Map<string, Card[]>();
  for (const existing of existingCards) {
    const bucket = byUid.get(existing.stableUid);
    if (bucket) bucket.push(existing);
    else byUid.set(existing.stableUid, [existing]);
  }

  const seenInFile = new Set<string>();

  for (const card of parsed.cards) {
    if (seenInFile.has(card.stableUid)) {
      plan.conflicts.push({
        kind: 'conflict',
        card,
        reason: 'DUPLICATE_UID_IN_FILE',
        message: `Stable uid "${card.stableUid}" appears more than once in this document.`,
      });
      continue;
    }
    seenInFile.add(card.stableUid);

    const issue = invalidUids.get(card.stableUid);
    if (issue && issue.code !== 'DUPLICATE_UID') {
      plan.conflicts.push({ kind: 'conflict', card, reason: 'INVALID_CARD', message: issue.message });
      continue;
    }

    const matches = byUid.get(card.stableUid) ?? [];
    const live = matches.filter((c) => !c.isDeleted);

    if (live.length > 1) {
      // The deck already violates uid uniqueness, so there is no safe target.
      plan.conflicts.push({
        kind: 'conflict',
        card,
        reason: 'AMBIGUOUS_EXISTING_UID',
        message: `Deck already has ${live.length} cards with uid "${card.stableUid}". Fix the deck before importing.`,
      });
      continue;
    }

    if (live.length === 0) {
      if (matches.length > 0) {
        // Creating would mint a second row for a uid that already exists in a
        // soft deleted state, which is exactly the collision to avoid.
        plan.conflicts.push({
          kind: 'conflict',
          card,
          reason: 'EXISTING_SOFT_DELETED',
          message: `Uid "${card.stableUid}" belongs to a deleted card. Restore or purge it before importing.`,
        });
        continue;
      }
      plan.creates.push({ kind: 'create', card });
      continue;
    }

    const target = live[0];
    const changedFields = fieldsThatDiffer(card, target);
    if (changedFields.length === 0) {
      plan.unchanged.push({ kind: 'unchanged', card, existingId: target.id });
      continue;
    }

    // The runner writes the whole card, so a card the file leaves without _ZH
    // sections would have its stored translation deleted. Typically that is an
    // English-only export of a translated deck, so it is refused unless the
    // operator opted in.
    const clearsTranslations = card.translations === undefined && changedFields.includes('translations');
    if (clearsTranslations && !options.allowClearTranslations) {
      plan.conflicts.push({
        kind: 'conflict',
        card,
        reason: 'TRANSLATIONS_WOULD_BE_CLEARED',
        message: `Card "${card.stableUid}" has a Chinese translation on the server, but this document has no _ZH sections for it, so importing would delete the translation. Add its _ZH sections, or choose to clear translations.`,
      });
      continue;
    }

    plan.updates.push({
      kind: 'update',
      card,
      existingId: target.id,
      // Optimistic concurrency: the write must fail rather than clobber an
      // edit made in another tab between preview and execute.
      expectedVersion: target.version,
      changedFields,
      ...(clearsTranslations ? { clearsTranslations: true as const } : {}),
      ...(restampsStaleTranslation(card, target) ? { restampsStaleTranslation: true as const } : {}),
    });
  }

  return plan;
}

const ENGLISH_TRANSLATED_FIELDS: readonly ComparableField[] = ['question', 'explanation', 'realWorldUsage', 'mcq'];

/**
 * ZH_WARN_MAYBE_STALE, non-blocking: an update that changes the English text of
 * a translated card while leaving its _ZH sections exactly as the server has
 * them. The server re-stamps a translation as current on every write that
 * carries one, so this is the last point where the drift is visible.
 *
 * ZH_WARN_STALE_MARKED_CURRENT, non-blocking: an update that re-sends, word
 * for word, a translation the server already marks stale (the English moved on
 * after it was written, typically through the Edit Card form). It takes the
 * place of ZH_WARN_MAYBE_STALE on that card, so a card gets one of the two.
 */
export function translationPlanWarnings(plan: Pick<ImportPlan, 'updates'>): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  for (const update of plan.updates) {
    if (update.restampsStaleTranslation) {
      warnings.push({
        code: 'ZH_WARN_STALE_MARKED_CURRENT',
        severity: 'warning',
        line: update.card.sourceLine,
        message: `Card "${update.card.stableUid}": the server marks its Chinese translation stale (the English changed after it was written) and this import marks the stale Chinese translation as current without changing it, so check the _ZH sections still say the same as the English.`,
        stableUid: update.card.stableUid,
      });
      continue;
    }
    if (!update.card.translations || update.changedFields.includes('translations')) continue;
    const english = update.changedFields.filter((field) => ENGLISH_TRANSLATED_FIELDS.includes(field));
    if (english.length === 0) continue;
    warnings.push({
      code: 'ZH_WARN_MAYBE_STALE',
      severity: 'warning',
      line: update.card.sourceLine,
      message: `Card "${update.card.stableUid}": the English ${english.join(', ')} changed but its _ZH sections did not; importing marks the translation current, so check the Chinese still says the same.`,
      stableUid: update.card.stableUid,
    });
  }
  return sortWarnings(warnings);
}

// ---------------------- serialize ----------------------

/**
 * Inverse of parseDeckMarkdown for the content fields. Used by tests to prove
 * the round trip, and available to the UI for "copy this deck as markdown".
 */
export function serializeDeckMarkdown(
  deckSlug: string,
  cards: readonly DeckCardContent[],
): string {
  const out: string[] = [`# deck: ${deckSlug}`, ''];

  for (const card of cards) {
    // Canonical order (FORMAT.md §1.4): each _ZH twin right after its English section.
    const zh = card.translations?.['zh-CN'];
    out.push(`## ${card.stableUid} | d${card.difficulty}`);
    if (card.topic) out.push(`TOPIC: ${card.topic}`);
    if (card.mcq && card.mcq.qualifier !== null) out.push(`QUALIFIER: ${card.mcq.qualifier}`);
    if (zh?.mcq && zh.mcq.qualifier !== null) out.push(`QUALIFIER_ZH: ${zh.mcq.qualifier}`);
    out.push('Q:');
    out.push(card.question);
    if (zh) {
      out.push('Q_ZH:');
      out.push(zh.question);
    }
    if (card.mcq) {
      for (const option of card.mcq.options) {
        const zhOption = zh?.mcq?.options[option.key];
        out.push(option.correct ? `OPT: ${option.key} *` : `OPT: ${option.key}`);
        out.push(option.text);
        if (zhOption) {
          out.push('OPT_ZH:');
          out.push(zhOption.text);
        }
        if (option.why !== null) {
          out.push('WHY:');
          out.push(option.why);
        }
        if (zhOption && zhOption.why !== null) {
          out.push('WHY_ZH:');
          out.push(zhOption.why);
        }
      }
    }
    out.push('A:');
    out.push(card.explanation);
    if (zh && zh.explanation !== undefined) {
      out.push('A_ZH:');
      out.push(zh.explanation);
    }
    if (card.codeSnippet) {
      out.push(card.codeLanguage ? `CODE: ${card.codeLanguage}` : 'CODE:');
      out.push(card.codeSnippet);
    }
    if (card.realWorldUsage) {
      out.push('USAGE:');
      out.push(card.realWorldUsage);
    }
    if (zh?.realWorldUsage) {
      out.push('USAGE_ZH:');
      out.push(zh.realWorldUsage);
    }
    if (card.source) {
      out.push(`SOURCE: ${card.source.url}`);
      if (card.source.quote !== null) out.push(card.source.quote);
    }
    out.push('');
  }

  return out.join('\n');
}

/** "line 12: Stable uid ... is already used" for compact UI lists. */
export function formatIssue(issue: Pick<ImportIssue, 'line' | 'message'>): string {
  return `line ${issue.line}: ${issue.message}`;
}
