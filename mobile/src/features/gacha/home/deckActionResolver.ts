import { loadActiveDeckSlug, setActiveDeckSlug } from '../../../content/activeDeck';
import {
  checkManifestForUpdates,
  listManifestDecks,
  type ManifestDeckEntry,
  type UpdateInfo,
} from '../../../content/deckRepository';
import { getCachedDeck, installDeckAndInvalidate } from '../../../content/deckCache';
import { syncDailyReminders } from '../../../notifications/reminders';
import { loadDeckProgress } from '../../../review/storage';
import { applyCachedRemoteProgress } from '../../../sync/progressSync';
import type { CalendarDay, DeckSummary } from '../contracts';
import { resolveEffectiveOwned } from '../draw/effectiveOwned';
import { countLearned, countNewAvailable } from '../planner/sessionPlanner';
import type { HomeDeckActionHint } from '../selectors/homeSelectors';
import { buildUpcoming, clamp01, isMasteredProgress } from '../selectors/progressSelectors';

export type DeckAction =
  | { kind: 'open'; slug: string }
  | {
      kind: 'install';
      slug: string;
      remoteUrl: string;
      remoteVersion: string | null;
      remoteSha256: string | null;
    }
  | {
      kind: 'update';
      slug: string;
      remoteUrl: string;
      remoteVersion: string | null;
      remoteSha256: string | null;
    }
  | {
      kind: 'trial-start';
      slug: string;
      remoteUrl: string;
      remoteVersion: string | null;
      remoteSha256: string | null;
    }
  | { kind: 'paywall'; slug: string }
  | { kind: 'none'; slug: string };

function isPremiumDeck(deck: DeckSummary): boolean {
  return deck.deckType !== 1 || String(deck.tier ?? '').toLowerCase() === 'premium';
}

function canInstallFromUpdate(updateInfo: UpdateInfo | undefined): updateInfo is UpdateInfo {
  return !!updateInfo?.remoteUrl && typeof updateInfo.remoteVersion === 'string';
}

export type HomeDeckSummarySnapshot = {
  deckSummaries: DeckSummary[];
  updates: Record<string, UpdateInfo>;
  allUpcoming30: CalendarDay[];
  asOfISO: string;
  // Two of the economy floor's three starvation inputs, summed here because
  // this is where they are born -- the per-deck fresh/due numbers are already
  // being computed for the summaries and for syncDailyReminders, and a caller
  // re-deriving them from `deckSummaries` would be a second copy of the
  // "which decks count" rule (skip coming-soon, skip not-installed) that can
  // drift from this one. Deliberately across all decks and not the selected
  // one: a user with work waiting in another deck is not in a dead end, and
  // the floor exists only for dead ends.
  totalDueAllDecks: number;
  totalNewAllDecks: number;
};

// Last remote update map that resolved successfully this session. A cache-first
// Home load (remote: false) reads this instead of hitting the remote-first
// manifest check, so cold start paints from what the last online load already
// learned rather than waiting on the network. Module state is the right scope:
// Home unmounts and remounts across the tab bar, and "last known" must outlive
// it, exactly like the auto-update attempt guard below.
let lastKnownUpdates: Record<string, UpdateInfo> = {};

/** A shallow copy of the last remote update map that resolved this session. */
export function getLastKnownDeckUpdates(): Record<string, UpdateInfo> {
  return { ...lastKnownUpdates };
}

/** Test seam: `lastKnownUpdates` is module state and vitest shares modules within a file. */
export function resetLastKnownDeckUpdatesForTests(): void {
  lastKnownUpdates = {};
}

function toDeckEntriesFromUpdates(rawUpdates: Record<string, unknown>): ManifestDeckEntry[] {
  return Object.entries(rawUpdates ?? {})
    .map(([slug, info]) => ({
      slug,
      title: String((info as any)?.title ?? slug),
      locale: String((info as any)?.locale ?? 'en-US'),
      version: String((info as any)?.remoteVersion ?? 'unknown'),
      deckType: Number((info as any)?.deckType ?? 1),
      tier: (info as any)?.tier ?? null,
      availability: (info as any)?.availability ?? 'live',
      eta: (info as any)?.eta ?? null,
      downloadMode: (info as any)?.downloadMode ?? null,
      totalCards:
        typeof (info as any)?.remoteCardCount === 'number'
          ? (info as any).remoteCardCount
          : undefined,
      buildId: null,
      path: null,
      sha256: null,
      order:
        typeof (info as any)?.order === 'number' ? Number((info as any).order) : undefined,
      retiredAtMs: null,
    }))
    .sort((a, b) => {
      const ao = typeof a.order === 'number' ? a.order : 9999;
      const bo = typeof b.order === 'number' ? b.order : 9999;
      if (ao !== bo) return ao - bo;
      return a.title.localeCompare(b.title);
    });
}

export async function loadHomeDeckSummaries(params: {
  premium: boolean;
  remote?: boolean;
}): Promise<HomeDeckSummarySnapshot> {
  const { premium, remote } = params;
  const now = new Date();
  let updates: Record<string, UpdateInfo> = {};
  let manifestDecks: ManifestDeckEntry[] = [];

  if (remote === false) {
    // Cache-first: reuse the last remote updates and make no manifest check, so
    // Home can paint before any network round-trip. Everything after (the
    // manifest deck list -- already cache-first -- and the per-deck loop) is
    // unchanged.
    updates = getLastKnownDeckUpdates();
  } else {
    try {
      updates = await loadDeckUpdates(premium);
    } catch {
      updates = {};
    }
  }

  try {
    manifestDecks = await listManifestDecks();
  } catch {
    manifestDecks = [];
  }

  const deckEntries =
    manifestDecks.length > 0 ? manifestDecks : toDeckEntriesFromUpdates(updates);

  const allUpcoming30 = buildUpcoming([], now, 30);
  const deckSummaries: DeckSummary[] = [];
  let totalDueAllDecks = 0;
  let totalNewAllDecks = 0;

  for (const entry of deckEntries) {
    const availability = String(entry.availability ?? 'live').toLowerCase();
    if (availability === 'retired') {
      continue;
    }

    if (availability === 'coming') {
      deckSummaries.push({
        slug: entry.slug,
        title: entry.title ?? entry.slug,
        locale: entry.locale ?? 'en-US',
        version: entry.version,
        deckType: entry.deckType ?? 1,
        totalCards: entry.totalCards ?? 0,
        localCards: 0,
        studyCards: 0,
        canStudy: false,
        tier: entry.tier ?? null,
        availability: entry.availability ?? null,
        eta: entry.eta ?? null,
        downloadMode: entry.downloadMode ?? null,
        order: entry.order,
        dueToday: 0,
        plannedToday: 0,
        newToday: 0,
        masteredApprox: 0,
        masteredCount: 0,
        ownedCount: 0,
        percent: 0,
      });
      continue;
    }

    const deck = await getCachedDeck(entry.slug);
    const localCards = deck?.Cards?.length ?? (deck as any)?.TotalCards ?? 0;
    const canStudy = !!deck && localCards > 0;
    const declaredTotal =
      typeof entry.totalCards === 'number' && Number.isFinite(entry.totalCards)
        ? entry.totalCards
        : localCards;

    if (!canStudy) {
      deckSummaries.push({
        slug: entry.slug,
        title: entry.title ?? entry.slug,
        locale: entry.locale ?? 'en-US',
        version: entry.version,
        deckType: entry.deckType ?? 1,
        totalCards: declaredTotal,
        localCards,
        studyCards: localCards,
        canStudy: false,
        tier: entry.tier ?? null,
        availability: entry.availability ?? null,
        eta: entry.eta ?? null,
        downloadMode: entry.downloadMode ?? null,
        order: entry.order,
        dueToday: 0,
        plannedToday: 0,
        newToday: 0,
        masteredApprox: 0,
        masteredCount: 0,
        ownedCount: 0,
        percent: 0,
      });
      continue;
    }

    try {
      await applyCachedRemoteProgress((deck as any).Slug);
    } catch {
      // Keep local-only progress if remote cache fails.
    }

    const progress = await loadDeckProgress(deck as any);
    // One resolve per deck per Home load, served by the drawState read model
    // after the first hit. It has to be per deck: ownership is stored per
    // slug, and a union built from another deck's progress would grandfather
    // uids that mean nothing here.
    const ownedSet = await resolveEffectiveOwned(String((deck as any).Slug), progress);
    const learned = countLearned(progress, ownedSet);
    // F11: "mastered" is stage >= 4, not "reviewed once". `isOwned` in sessionPlanner is
    // private, so the gate is inlined; a studied card is always owned (grandfathered), so
    // this can only ever be <= learned.
    const mastered = progress.filter(
      (item) => (ownedSet === null || ownedSet.has(item.stableUid)) && isMasteredProgress(item),
    ).length;
    // "Fresh" stops meaning "a card in the deck file you have not studied" and
    // starts meaning "a card you hold and have not studied". This is the whole
    // point of the phase and the number that visibly moves: a new account with
    // a 100-card deck installed goes from 100 fresh to however many the last
    // pull granted -- usually 0, which is what hands Home's primary button to
    // the draw (see homeSelectors' nothing_to_learn).
    const fresh = countNewAvailable(progress, ownedSet);
    // Denominator is the collection, not the deck file. Against the deck file
    // a full collection of ten cards out of a hundred reads 10% forever, which
    // describes the shop rather than the user's work. learned + fresh is the
    // owned slice of this deck: every owned card is either studied or not.
    const collectionSize = learned + fresh;
    const denom = Math.max(1, collectionSize);
    const upcoming = buildUpcoming(progress, now, 30, ownedSet);
    const dueToday = upcoming[0]?.count ?? 0;
    totalDueAllDecks += dueToday;
    totalNewAllDecks += fresh;

    for (let i = 0; i < allUpcoming30.length; i++) {
      allUpcoming30[i].count += upcoming[i]?.count ?? 0;
    }

    deckSummaries.push({
      slug: String((deck as any).Slug),
      title: String((deck as any).Title),
      locale: String((deck as any).Locale),
      version: String((deck as any).Version),
      deckType: Number((deck as any).DeckType ?? 1),
      totalCards: declaredTotal,
      localCards,
      studyCards: localCards,
      canStudy: true,
      tier: entry.tier ?? null,
      availability: entry.availability ?? null,
      eta: entry.eta ?? null,
      downloadMode: entry.downloadMode ?? null,
      order: entry.order,
      dueToday,
      plannedToday: dueToday,
      newToday: fresh,
      masteredApprox: learned,
      masteredCount: mastered,
      ownedCount: collectionSize,
      percent: clamp01(learned / denom),
    });
  }

  void syncDailyReminders({ remainingDueCount: totalDueAllDecks, now });
  return {
    deckSummaries,
    updates,
    allUpcoming30,
    asOfISO: now.toISOString(),
    totalDueAllDecks,
    totalNewAllDecks,
  };
}

export function previewDeckAction(input: {
  deck: DeckSummary;
  premium: boolean;
  signedIn: boolean;
  updates: Record<string, UpdateInfo>;
}): HomeDeckActionHint {
  const { deck, premium, signedIn, updates } = input;
  const availability = String(deck.availability ?? 'live').toLowerCase();
  if (availability === 'coming') return 'none';

  const updateInfo = updates[deck.slug];
  const premiumDeck = isPremiumDeck(deck);

  if (!deck.canStudy) {
    if (canInstallFromUpdate(updateInfo)) {
      if (premiumDeck && !premium) {
        return signedIn ? 'trial-start' : 'paywall';
      }
      return 'install';
    }
    return premiumDeck && !premium ? 'paywall' : 'open';
  }

  if (updateInfo?.hasUpdate && canInstallFromUpdate(updateInfo)) {
    return 'update';
  }

  return 'open';
}

export async function resolveDeckAction(input: {
  deck: DeckSummary;
  premium: boolean;
  signedIn: boolean;
  updates: Record<string, UpdateInfo>;
}): Promise<DeckAction> {
  const { deck, premium, signedIn, updates } = input;

  const availability = String(deck.availability ?? 'live').toLowerCase();
  if (availability === 'coming') {
    return { kind: 'none', slug: deck.slug };
  }

  const updateInfo = updates[deck.slug];
  const premiumDeck = isPremiumDeck(deck);

  if (!deck.canStudy) {
    if (canInstallFromUpdate(updateInfo)) {
      if (premiumDeck && !premium) {
        if (!signedIn) {
          return { kind: 'paywall', slug: deck.slug };
        }
        return {
          kind: 'trial-start',
          slug: deck.slug,
          remoteUrl: updateInfo.remoteUrl!,
          remoteVersion: updateInfo.remoteVersion,
          remoteSha256: updateInfo.remoteSha256,
        };
      }

      return {
        kind: 'install',
        slug: deck.slug,
        remoteUrl: updateInfo.remoteUrl!,
        remoteVersion: updateInfo.remoteVersion,
        remoteSha256: updateInfo.remoteSha256,
      };
    }

    return premiumDeck && !premium
      ? { kind: 'paywall', slug: deck.slug }
      : { kind: 'open', slug: deck.slug };
  }

  if (updateInfo?.hasUpdate && canInstallFromUpdate(updateInfo)) {
    return {
      kind: 'update',
      slug: deck.slug,
      remoteUrl: updateInfo.remoteUrl!,
      remoteVersion: updateInfo.remoteVersion,
      remoteSha256: updateInfo.remoteSha256,
    };
  }

  return { kind: 'open', slug: deck.slug };
}

export async function executeDeckAction(action: DeckAction): Promise<{ activeSlug: string }> {
  const ensureActive = async (slug: string): Promise<{ activeSlug: string }> => {
    await setActiveDeckSlug(slug);
    return { activeSlug: slug };
  };

  switch (action.kind) {
    case 'open':
      return ensureActive(action.slug);

    case 'install':
    case 'update':
    case 'trial-start': {
      const ok = await installDeckAndInvalidate(
        action.slug,
        action.remoteUrl,
        action.remoteVersion,
        action.remoteSha256,
      );
      if (!ok) {
        throw new Error(`deck_action_failed:${action.kind}`);
      }
      return ensureActive(action.slug);
    }

    case 'paywall': {
      const stored = await loadActiveDeckSlug();
      return { activeSlug: stored ?? action.slug };
    }

    case 'none':
    default:
      return { activeSlug: action.slug };
  }
}

export async function loadDeckUpdates(
  premium: boolean,
): Promise<Record<string, UpdateInfo>> {
  const updates = await checkManifestForUpdates(premium);
  // Remember the last successful remote map so a later cache-first load
  // (remote: false) can reuse it without a network round-trip.
  lastKnownUpdates = updates;
  return updates;
}

/** =========================
 *  Free-deck auto-update
 *  ========================= */

export type AutoUpdateCandidate = {
  slug: string;
  remoteUrl: string;
  remoteVersion: string;
  remoteSha256: string | null;
};

export type AutoUpdateRun = {
  slug: string;
  /** Resolves true when the installer reports success; never rejects. */
  done: Promise<boolean>;
};

// One attempt per slug per app session. The installer is idempotent (it joins
// an in-flight install for the same key and short-circuits when the installed
// buildId already matches), so this guard is not about correctness -- it is
// what stops a deck that fails to download from being retried on every Home
// focus, and what lets a failed attempt fall back to the visible chip instead
// of a silent loop. Module state is the right scope: Home unmounts and
// remounts across the tab bar, and "this session" must outlive it.
const autoUpdateAttempted = new Set<string>();

function isFreeDeck(deck: DeckSummary): boolean {
  return !isPremiumDeck(deck);
}

// Pure so the selection rule has a unit test of its own: a free, installed,
// live deck whose manifest buildId differs from the installed one and that the
// manifest can actually serve (url + version). Premium decks are excluded on
// purpose -- a non-premium account's "update" would be a preview swap, which
// is a decision for the paywall flow, never something Home does unasked.
export function selectAutoUpdateCandidates(params: {
  deckSummaries: DeckSummary[];
  updates: Record<string, UpdateInfo>;
}): AutoUpdateCandidate[] {
  const { deckSummaries, updates } = params;
  const out: AutoUpdateCandidate[] = [];
  for (const deck of deckSummaries) {
    if (!deck.canStudy) continue;
    if (!isFreeDeck(deck)) continue;
    const availability = String(deck.availability ?? 'live').toLowerCase();
    if (availability !== 'live') continue;
    const info = updates[deck.slug];
    if (!info?.hasUpdate) continue;
    if (!canInstallFromUpdate(info)) continue;
    const remoteVersion = String(info.remoteVersion ?? '').trim();
    if (!remoteVersion) continue;
    if (info.installedVersion != null && String(info.installedVersion) === remoteVersion) continue;
    out.push({
      slug: deck.slug,
      remoteUrl: info.remoteUrl!,
      remoteVersion,
      remoteSha256: info.remoteSha256 ?? null,
    });
  }
  return out;
}

/**
 * Kicks off the installer for every candidate not yet attempted this session
 * and returns the runs it started, without awaiting them: Home renders the
 * "updating" chip from the returned slugs and refreshes when each settles.
 *
 * Deliberately calls installDeckAndInvalidate and not executeDeckAction: the latter
 * also makes the deck active, and a background update must not move the
 * user's selection. Owned cards and review progress live under their own
 * slug-scoped keys that the installer never touches (only a retire purges
 * them), which is what makes applying the update unasked safe.
 */
export function autoApplyFreeDeckUpdates(params: {
  deckSummaries: DeckSummary[];
  updates: Record<string, UpdateInfo>;
}): AutoUpdateRun[] {
  const runs: AutoUpdateRun[] = [];
  for (const candidate of selectAutoUpdateCandidates(params)) {
    if (autoUpdateAttempted.has(candidate.slug)) continue;
    autoUpdateAttempted.add(candidate.slug);
    const done = Promise.resolve()
      .then(() =>
        installDeckAndInvalidate(
          candidate.slug,
          candidate.remoteUrl,
          candidate.remoteVersion,
          candidate.remoteSha256,
        ),
      )
      .then((ok) => ok === true)
      .catch(() => false);
    runs.push({ slug: candidate.slug, done });
  }
  return runs;
}

export function hasAutoUpdateBeenAttempted(slug: string): boolean {
  return autoUpdateAttempted.has(slug);
}

/** Test seam: the per-session guard is module state and vitest shares modules within a file. */
export function resetAutoUpdateAttemptsForTests(): void {
  autoUpdateAttempted.clear();
}
