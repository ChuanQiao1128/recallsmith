// src/pages/deckListRows.ts
//
// One function: turn either of DeckListPage's two data paths into the row list
// the deck table renders. Lifted verbatim out of the viewRows useMemo
// (DeckListPage.tsx:620-696) so it can be reasoned about — and mutated — without
// mounting a 1177-line component.
//
// Not folded into deckListManifest.ts: that module's subject is parsing the
// published content manifest. This one's subject is the table's row model.
//
// ConsoleDeckRow and ListMode moved here with the function and the page imports
// them back. That direction is deliberate: exporting a new symbol from
// DeckListPage.tsx trips react-refresh/only-export-components (12 errors, seen
// in step 5.5), while a plain .ts module has no such constraint.
//
// ---------------------------------------------------------------------------
// A DIVERGENCE THAT IS PRESERVED HERE ON PURPOSE — DO NOT "TIDY" IT
// ---------------------------------------------------------------------------
// The paginated type filter below asks isStarterLike(deckType, tier); the
// legacy type filter asks `deckType !== 1`. They are not equivalent:
// isStarterLike falls back to `tier !== 'premium'` when deckType is not a
// number, and a deck with deckType null + tier 'free' is production-reachable
// (normalizeDeck in api/authoring.ts:63 passes null straight through, while
// types/deck.ts declares deckType as a plain number). The Type badge in the
// page's JSX uses isStarterLike too, so under the legacy path such a deck
// renders the word "Starter" while surviving only the *Paid* filter.
//
// Collapsing the two spellings into one would be a change to what the console
// shows, not a refactor. tests/deckListViewRows.test.tsx V1-V5 pin the current
// behaviour of both paths; V2 and V3 are the ones that go red if anyone
// unifies them. Deciding which predicate wins belongs to a human.

import type { AdminDeckListItem } from '../api/authoring';
import type { Deck } from '../types/deck';
import { derivePagedDeckStatus, isStarterLike } from './deckListPagination';
import type { DeckStatus } from './deckListPagination';
import { getDeckStatusFromManifest } from './deckListManifest';
import type { ManifestDeckLite } from './deckListManifest';

/** Which data path produced the rows. */
export type ListMode = 'paginated' | 'legacy';

// Unified row shape rendered by the table, produced by both the paginated
// (/api/v1/admin/decks) and legacy (full fetchDecks + manifest) data paths.
export type ConsoleDeckRow = {
  key: string;
  id: number | null;
  slug: string;
  title: string;
  deckType: number | null;
  tier: string | null;
  manifestOrder: number | null;
  cardCount: number;
  status: DeckStatus;
  updatedAt: string | number | null;
};

/**
 * Every value the row model depends on, one field per entry of the useMemo
 * deps array it was lifted out of — same names, same order, nothing derived
 * inside. Passing an enclosing object instead of the tracked value (`paged`
 * rather than `paged.items`) would make the value read differ from the value
 * memoised on; tests/deckListRowsWiring.test.ts asserts they still match.
 *
 * The wording above avoids one specific noun on purpose: it is also the name
 * of a Tailwind layout utility, and Tailwind's candidate scanner reads plain
 * prose in .ts files under src/. Writing it in this comment emitted a real
 * utility rule into dist/assets/*.css and grew the built stylesheet by
 * 0.29 kB. Measured by building both ways, not guessed — and the first draft
 * of this very note re-introduced it by naming the class it was warning about.
 */
export interface BuildViewRowsInput {
  listMode: ListMode;
  pagedItems: AdminDeckListItem[];
  decks: Deck[];
  manifestBySlug: Record<string, ManifestDeckLite>;
  q: string;
  statusFilter: 'all' | DeckStatus;
  typeFilter: 'all' | 'starter' | 'paid';
}

export function buildViewRows(input: BuildViewRowsInput): ConsoleDeckRow[] {
  const { listMode, pagedItems, decks, manifestBySlug, q, statusFilter, typeFilter } = input;

  if (listMode === 'paginated') {
    // Server already applied q (ILIKE on slug/title) and ordering
    // (updated_at DESC, slug); status/type filters remain client-side
    // refinements over the loaded pages.
    return pagedItems
      .map<ConsoleDeckRow>(item => ({
        key: item.slug,
        id: item.id ?? null,
        slug: item.slug,
        title: item.title ?? '',
        deckType: item.deckType ?? null,
        tier: item.tier ?? null,
        manifestOrder: null,
        cardCount: item.totalCards ?? 0,
        status: derivePagedDeckStatus(item),
        updatedAt: item.updatedAtMs ?? null,
      }))
      .filter(row => {
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        if (typeFilter !== 'all') {
          const starter = isStarterLike(row.deckType, row.tier);
          if (typeFilter === 'starter' && !starter) return false;
          if (typeFilter === 'paid' && starter) return false;
        }
        return true;
      });
  }

  const query = q.trim().toLowerCase();

  return decks
    .map(d => {
      const m = manifestBySlug[String(d.slug || '').trim()];
      const cardCount = d.totalCards ?? 0;
      const status = getDeckStatusFromManifest(d, m, cardCount);
      return { deck: d, status, cardCount };
    })
    .filter(row => {
      const d = row.deck;

      if (query) {
        const s = `${d.slug ?? ''} ${d.title ?? ''}`.toLowerCase();
        if (!s.includes(query)) return false;
      }

      if (statusFilter !== 'all' && row.status !== statusFilter) return false;

      if (typeFilter !== 'all') {
        if (typeFilter === 'starter' && d.deckType !== 1) return false;
        if (typeFilter === 'paid' && d.deckType === 1) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const oA = typeof (a.deck as Deck & { manifestOrder?: number }).manifestOrder === 'number' ? (a.deck as Deck & { manifestOrder?: number }).manifestOrder! : 999999;
      const oB = typeof (b.deck as Deck & { manifestOrder?: number }).manifestOrder === 'number' ? (b.deck as Deck & { manifestOrder?: number }).manifestOrder! : 999999;
      return oA - oB;
    })
    .map<ConsoleDeckRow>(({ deck: d, status, cardCount }) => {
      const withDates = d as Deck & { updatedAt?: string | null; createdAt?: string | null };
      const idNum = Number(d.id);
      return {
        key: String(d.id),
        id: Number.isFinite(idNum) ? idNum : null,
        slug: String(d.slug ?? ''),
        title: String(d.title ?? ''),
        deckType: typeof d.deckType === 'number' ? d.deckType : null,
        tier: d.tier ?? null,
        manifestOrder: typeof d.manifestOrder === 'number' ? d.manifestOrder : null,
        cardCount,
        status,
        updatedAt: withDates.updatedAt ?? withDates.createdAt ?? null,
      };
    });
}
