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
//   Q:
//   <question lines>
//   A:
//   <explanation lines>
//   CODE: csharp
//   <code lines>
//   USAGE:
//   <real world usage lines>
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

import type { Card } from '../types/card';
import { hasContent, isValidDifficulty, isValidStableUid } from './cardRules';

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
  | 'DUPLICATE_TOPIC';

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
}

export type ConflictReason =
  | 'INVALID_CARD'
  | 'DUPLICATE_UID_IN_FILE'
  | 'AMBIGUOUS_EXISTING_UID'
  | 'EXISTING_SOFT_DELETED';

/** Fields compared when deciding update vs unchanged. */
export type ComparableField =
  | 'question'
  | 'difficulty'
  | 'orderInDeck'
  | 'explanation'
  | 'codeSnippet'
  | 'codeLanguage'
  | 'realWorldUsage'
  | 'topic';

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

type SectionKind = 'question' | 'answer' | 'code' | 'usage';

interface Section {
  line: number;
  lines: string[];
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
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function sectionText(section: Section | undefined): string {
  if (!section) return '';
  return section.lines.join('\n');
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
    if (!question || !explanation || d.topicInvalid) return;

    const codeSnippet = sectionText(d.sections.code) || null;
    const realWorldUsage = sectionText(d.sections.usage) || null;

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
      orderInDeck: cards.length * 10,
      sourceLine: d.headerLine,
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
      pushIssue(
        'DUPLICATE_SECTION',
        line,
        `Card "${draft.stableUid}" repeats the ${kind} section; the first one wins.`,
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

  return { deckSlug, cards, errors: sortIssues(errors) };
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
export function validateCards(cards: readonly ParsedCard[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const firstSeen = new Map<string, number>();

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
  }

  return sortIssues(issues);
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
    if (normalizeText(card[field]) !== normalizeText(existing[field])) changed.push(field);
  }
  return changed;
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
): ImportPlan {
  const plan: ImportPlan = { creates: [], updates: [], unchanged: [], conflicts: [] };

  // Cards that failed validation never reach the API. planImport re-runs the
  // check rather than trusting the caller to have looked at parsed.errors.
  const invalidUids = new Map<string, ImportIssue>();
  for (const issue of validateCards(parsed.cards)) {
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
    plan.updates.push({
      kind: 'update',
      card,
      existingId: target.id,
      // Optimistic concurrency: the write must fail rather than clobber an
      // edit made in another tab between preview and execute.
      expectedVersion: target.version,
      changedFields,
    });
  }

  return plan;
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
    out.push(`## ${card.stableUid} | d${card.difficulty}`);
    if (card.topic) out.push(`TOPIC: ${card.topic}`);
    out.push('Q:');
    out.push(card.question);
    out.push('A:');
    out.push(card.explanation);
    if (card.codeSnippet) {
      out.push(card.codeLanguage ? `CODE: ${card.codeLanguage}` : 'CODE:');
      out.push(card.codeSnippet);
    }
    if (card.realWorldUsage) {
      out.push('USAGE:');
      out.push(card.realWorldUsage);
    }
    out.push('');
  }

  return out.join('\n');
}

/** "line 12: Stable uid ... is already used" for compact UI lists. */
export function formatIssue(issue: ImportIssue): string {
  return `line ${issue.line}: ${issue.message}`;
}
