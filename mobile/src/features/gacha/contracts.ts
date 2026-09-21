export type RouteNodeRole = 'warmup' | 'normal' | 'elite' | 'boss';

export type CalendarDay = {
  dateKey: string;
  count: number;
};

export type DeckSummary = {
  slug: string;
  title: string;
  locale: string;
  version: string;
  deckType: number;
  totalCards: number;
  localCards: number;
  studyCards: number;
  canStudy: boolean;
  tier?: string | null;
  availability?: string | null;
  eta?: string | null;
  downloadMode?: string | null;
  order?: number;
  dueToday: number;
  plannedToday: number;
  newToday: number;
  masteredApprox: number;
  percent: number;
  /** Owned cards at stage >= MASTERY_STAGE_THRESHOLD (isMasteredProgress). masteredApprox keeps
   *  meaning "learned" and still feeds percent; only Home's Mastered ✓ / Deck mastered read this. */
  masteredCount?: number;
  /** Cards of this deck the account holds (learned + fresh, the owned slice deckActionResolver
   *  already sums for `percent`). Optional so hand-built fixtures keep compiling; readers fall
   *  back to that same sum. */
  ownedCards?: number;
};

export type TodayCounts = {
  /** Due today summed across every studiable deck. Feeds reminders and the header line, never
   *  a tile: on a 441-card deck with nothing due it read "0 Total" and was taken for the deck. */
  totalDueAllDecks: number;
  selectedDue: number;
  selectedNew: number;
  selectedMastered: number;
  /** Owned cards in the selected deck — the fourth Today tile (Due · New · Learned · Owned). */
  selectedOwned: number;
  normalCount: number;
  eliteCount: number;
  bossCount: number;
};

export type RoutePreviewNode = {
  id: string;
  role: RouteNodeRole;
  title: string;
  subtitle: string;
};

export type HomeHeroVM = {
  eyebrow: string;
  title: string;
  subtitle: string;
  helper: string;
  ctaLabel: string;
  ctaAction: 'challenge' | 'deck' | 'none';
  ctaDisabled: boolean;
};

export type HomeVM = {
  hero: HomeHeroVM;
  counts: TodayCounts;
  routePreview: RoutePreviewNode[];
  selectedDeckTitle: string | null;
  drawStatusLabel: string;
};

export type ChallengeRoute = {
  slug: string;
  deckTitle: string;
  mode: 'mixed' | 'review-due' | 'learn-new' | 'sweep';
  limit: number;
  minimumGoal: number;
  dueCount: number;
  newCount: number;
  nodes: RoutePreviewNode[];
  summary: string;
};

/**
 * Which cards an account may study, as seen by the pure functions that count,
 * pick, plan and list them.
 *
 * `null` means ungated -- the whole deck is studiable, which is what 1.4.0
 * shipped and what every caller still does until it is switched over. A Set
 * means only those uids exist as far as the caller is concerned.
 *
 * Callers must pass the union of drawn-and-already-studied cards (see
 * resolveEffectiveOwned), never a raw owned set. The functions treat the set as
 * authoritative: hand them one that omits a card the user has been reviewing
 * for weeks and they will hide it, cheerfully and everywhere at once.
 *
 * It lives here, in the type-only module both consumers already sit beside,
 * because the planner and the library mapper each need it and neither should
 * have to import the other to get it.
 */
export type OwnedGate = Set<string> | null;

export type LibraryStatusCounts = {
  newCount: number;
  learningCount: number;
  masteredCount: number;
  dueTodayCount: number;
  updatedCount: number;
  /**
   * How many cards of this deck the account holds. Ungated this is the learned
   * count (the shipped proxy the Library screen computes by hand today);
   * gated it is the real size of the collection, which is what the
   * "owned / total" header and its percentage want.
   */
  ownedCount: number;
  /**
   * Every row this VM produced: the deck, or the trial slice of it. The
   * denominator of the collection ring.
   *
   * It exists because the screen used to add newCount + learningCount +
   * masteredCount to get here, and gated that sum stops being the deck --
   * a card outside the collection is 'missing' and falls out of all three, so
   * the ratio would read "4 / 4" for someone holding four cards of a hundred.
   * Anything the reader would call a total belongs here rather than being
   * re-derived from the parts.
   */
  totalCount: number;
};

export type LibraryVM = {
  title: string;
  subtitle: string;
  drawStatusLabel: string;
  counts: LibraryStatusCounts;
};
