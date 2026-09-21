import AsyncStorage from '@react-native-async-storage/async-storage';

import { getUserScopedKey, readStoredDeckProgress } from '../../../review/storage';
import { isLearnedProgress } from '../selectors/progressSelectors';
import { REMOTE_PROGRESS_CACHE_KEY_PREFIX } from './progressSettled';

/**
 * "Which cards of this deck does STORAGE say the account has learned, right now?" (C00 §6,
 * 2026-09-21 addendum, decision 4 -- review finding S8.)
 *
 * The R1 ledger seed used to trust the caller's in-memory progress snapshot. The session
 * screen refreshes that snapshot only at load and after each of its own ratings
 * (SessionCardScreen.tsx: setProgress at load and in handleRating), while a remote pull
 * (app_foreground, an empty-outbox background sync) merges into storage behind its back.
 * A seed taken from the stale snapshot backfills only what the snapshot knew, the marker
 * makes that permanent, and every later-arriving learned card then pays R1 on its next
 * hard+. So the SEED path unions the snapshot's learned uids with this storage-fresh view.
 *
 * "The way the screen reads progress at load" is applyCachedRemoteProgress(slug) followed
 * by loadDeckProgress(deck) (SessionCardScreen.tsx:299-303). Both live in frozen files whose
 * import graph (progressSync.ts → expo-crypto / expo-constants / react-native / apiClient /
 * deckRepository → aws-amplify, expo-file-system) is far heavier than a ledger seed should
 * carry, applyCachedRemoteProgress needs a live access token and a DeckExport from the
 * filesystem, and it WRITES the merged progress -- a write this module has no business
 * doing from inside a reward settlement. This reader therefore reads the same two sources
 * those helpers read, without their writes:
 *
 * 1. the stored progress array for the slug in the current partition
 *    (readStoredDeckProgress, review/storage.ts -- the key loadDeckProgress reads), every
 *    entry where isLearnedProgress (progressSelectors.ts);
 * 2. the per-user remote cache `sync:remoteCache:v1:<slug>` (the rows the frozen
 *    progressSync.ts stores verbatim from the server, :1010-1036, and the cache
 *    applyCachedRemoteProgress replays, :1798-1826), every row with `lastReviewedAtMs > 0`.
 *
 * Source 2 is not redundant with source 1. handleRating writes the whole in-memory array back
 * with saveDeckProgress BEFORE it settles the reward (SessionCardScreen.tsx:451-452), so by the
 * time the seed runs, a pull that merged into the progress key mid-session has already been
 * overwritten by the stale snapshot; the cache is the only place the pulled rows still are
 * until the next screen load replays it. The row rule mirrors mergeRemoteIntoLocalProgress
 * (progressSync.ts:1133-1135: a row with lastReviewedAt > 0 lands as lastReviewedAt on the
 * local card, i.e. as learned); a row with no updatedAtMs, which the merge would skip, is still
 * counted here -- that is the under-pay direction, and the seed wants the superset.
 *
 * The two views are returned separately because they are not equally trustworthy about the
 * card being rated. Source 1 already holds THIS rating (the pre-settle save above), so for that
 * one uid it is not a "before" view and the caller drops it, leaving the decision to its own
 * progressBefore. Source 2 is: this device's rating reaches the cache only through a later
 * push and pull, so a cache row for the current card means the account learned it before this
 * rating -- on another device, or on this one before the partition settled -- which is exactly
 * what the backfill exists to record.
 *
 * Anon partition: there is no per-user cache, so source 2 is simply absent.
 *
 * Throws on a storage error (the caller fails closed: no seed, no R1). A corrupt cache value
 * reads as no rows; a corrupt progress value reads as no entries. Read-only.
 */
export type StorageFreshLearned = {
  /** Source 1: uids learned in the stored progress array for the slug (current partition). */
  storedProgress: Set<string>;
  /** Source 2: uids with a reviewed row in the per-user remote cache for the slug. */
  remoteCache: Set<string>;
};

export async function readStorageFreshLearned(slug: string): Promise<StorageFreshLearned> {
  const storedProgress = new Set<string>();
  const stored = await readStoredDeckProgress(slug);
  if (stored != null) {
    for (const p of stored) {
      if (isLearnedProgress(p)) storedProgress.add(p.stableUid);
    }
  }

  const remoteCache = new Set<string>();
  const cacheKey = await getUserScopedKey(`${REMOTE_PROGRESS_CACHE_KEY_PREFIX}${slug}`);
  const rawCache = await AsyncStorage.getItem(cacheKey);
  if (rawCache != null) {
    for (const uid of learnedUidsInRemoteCache(rawCache)) remoteCache.add(uid);
  }

  return { storedProgress, remoteCache };
}

// progressSync.ts:203-209 toMs, minus the floor: null unless a finite positive number (or
// a numeric string -- the server's lastReviewedAtMs is typed number | string | null).
function positiveMs(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** The stableUids of the cached remote rows that describe a reviewed card. Never throws. */
export function learnedUidsInRemoteCache(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

  const out: string[] = [];
  for (const row of Object.values(parsed as Record<string, unknown>)) {
    if (row == null || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const uid = typeof rec.stableUid === 'string' ? rec.stableUid.trim() : '';
    if (!uid) continue;
    if (positiveMs(rec.lastReviewedAtMs) == null) continue;
    out.push(uid);
  }
  return out;
}
