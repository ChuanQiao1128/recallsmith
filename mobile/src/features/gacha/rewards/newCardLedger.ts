import AsyncStorage from '@react-native-async-storage/async-storage';

import { formatDateKey } from '../../../review/model';
import type { CardProgress } from '../../../review/model';
import { getUserScopedKey } from '../../../review/storage';
import { ANON_USER_SCOPE_PREFIX } from '../draw/drawStateStore';
import { isLearnedProgress } from '../selectors/progressSelectors';

/** Base key; resolved key is getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`) →
 *  `devcards:u:{sub}:recallsmith:newCardPullPaidUids:<slug>`. The doc's literal
 *  `newCardPullPaidUids:<slug>` appears verbatim; the `recallsmith:` family prefix is the one every
 *  economy key carries (rewardWallet.ts:19-24, economyFloor.ts:25). */
export const NEW_CARD_LEDGER_PREFIX = 'recallsmith:newCardPullPaidUids:';

/** Per-partition, per-slug "seeded" marker (C00 §6, 2026-09-21 addendum, decision 1). Resolved key is
 *  getUserScopedKey(`${NEW_CARD_LEDGER_SEEDED_PREFIX}${slug}`). Its PRESENCE is what "this partition has
 *  been seeded" means; the ledger key's presence no longer implies it, because anon adoption writes the
 *  user ledger before the user partition has ever settled a rating. Value: a small JSON record of when
 *  the seed ran and how many learned cards it backfilled (informational only). */
export const NEW_CARD_LEDGER_SEEDED_PREFIX = 'recallsmith:newCardPullSeeded:';

/** stableUid → paidAtMs. 0 = backfilled: the card was already learned when the ledger was first
 *  seeded on this partition, so it never pays (pre-OTA policy, C00 §6 #3). */
export type NewCardLedger = Record<string, number>;

export type NewCardLedgerSeed = { seededAtMs: number; backfilled: number };

// Own-key test: `uid in ledger` would also answer true for inherited names ('constructor',
// 'toString'), which a stableUid never is in practice but a property test is entitled to try.
function hasUid(ledger: NewCardLedger, uid: string): boolean {
  return Object.prototype.hasOwnProperty.call(ledger, uid);
}

// A stored value is only trusted where it is a JSON object of finite, non-negative
// numbers; every other shape (array, string, null, NaN, negative) reads as an empty
// ledger. Garbage never throws here -- the caller that wants to fail closed does so on
// a storage error, not on a corrupt value (a corrupt value reads as an empty, present
// ledger; whether it is re-seeded is decided by the seeded marker, not by the value).
function parseLedger(raw: string): NewCardLedger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: NewCardLedger = {};
  for (const [uid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[uid] = value;
    }
  }
  return out;
}

// The marker's presence is the fact; its value is a best-effort record. Any unparseable
// or odd-shaped value still reads as "seeded" with zeroed fields, so a corrupt marker can
// never cause a second seed (which would be the only way to make a paid card pay again).
function parseSeed(raw: string): NewCardLedgerSeed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { seededAtMs: 0, backfilled: 0 };
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return { seededAtMs: 0, backfilled: 0 };
  const rec = parsed as Record<string, unknown>;
  const seededAtMs = typeof rec.seededAtMs === 'number' && Number.isFinite(rec.seededAtMs) && rec.seededAtMs >= 0 ? rec.seededAtMs : 0;
  const backfilled = typeof rec.backfilled === 'number' && Number.isFinite(rec.backfilled) && rec.backfilled >= 0 ? rec.backfilled : 0;
  return { seededAtMs, backfilled };
}

/** { ledger, present }. present=false when the key is absent. Throws on a storage error (callers
 *  fail closed). A corrupt value reads as { ledger: {}, present: true }. `present` describes the KEY,
 *  not seeded-ness -- see readNewCardLedgerSeed for that. */
export async function readNewCardLedger(slug: string): Promise<{ ledger: NewCardLedger; present: boolean }> {
  const key = await getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`);
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return { ledger: {}, present: false };
  return { ledger: parseLedger(raw), present: true };
}

/** The seeded marker for this partition and slug, or null when the partition has never been seeded.
 *  Throws on a storage error (callers fail closed). */
export async function readNewCardLedgerSeed(slug: string): Promise<NewCardLedgerSeed | null> {
  const key = await getUserScopedKey(`${NEW_CARD_LEDGER_SEEDED_PREFIX}${slug}`);
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return null;
  return parseSeed(raw);
}

/** Marker present → the current ledger is returned unchanged. Marker absent → every entry of `progress`
 *  where isLearnedProgress (progressSelectors.ts:16-18) is unioned INTO the existing ledger as 0
 *  (an existing paidAt value is never overwritten -- anon adoption may already have stamped it), the
 *  ledger is written, THEN the marker is written (ledger first: a kill between the two writes replays
 *  the union on the next call, which is idempotent). Returns the ledger. Throws on storage error. */
export async function seedNewCardLedgerIfAbsent(
  slug: string,
  progress: CardProgress[],
  nowMs: number = Date.now(),
): Promise<NewCardLedger> {
  const seed = await readNewCardLedgerSeed(slug);
  const { ledger } = await readNewCardLedger(slug);
  if (seed != null) return ledger;

  const seeded: NewCardLedger = { ...ledger };
  let backfilled = 0;
  for (const p of progress) {
    if (isLearnedProgress(p) && !hasUid(seeded, p.stableUid)) {
      seeded[p.stableUid] = 0;
      backfilled += 1;
    }
  }
  // Write even when the seed is {} -- an empty deck of learned cards still marks the
  // partition seeded, so a later brand-new card on it pays exactly once.
  const ledgerKey = await getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`);
  await AsyncStorage.setItem(ledgerKey, JSON.stringify(seeded));
  const markerKey = await getUserScopedKey(`${NEW_CARD_LEDGER_SEEDED_PREFIX}${slug}`);
  const marker: NewCardLedgerSeed = { seededAtMs: nowMs, backfilled };
  await AsyncStorage.setItem(markerKey, JSON.stringify(marker));
  return seeded;
}

/** paid=false when the uid is already present (any value, including 0) or storage fails; otherwise
 *  writes ledger[uid] = nowMs FIRST and returns paid=true. Never throws. Does not seed. */
export async function payNewCardIfUnpaid(slug: string, stableUid: string, nowMs: number): Promise<{ paid: boolean; ledger: NewCardLedger }> {
  let ledger: NewCardLedger = {};
  try {
    const read = await readNewCardLedger(slug);
    ledger = read.ledger;
    if (hasUid(ledger, stableUid)) return { paid: false, ledger };
    const next: NewCardLedger = { ...ledger, [stableUid]: nowMs };
    const key = await getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`);
    await AsyncStorage.setItem(key, JSON.stringify(next));
    return { paid: true, ledger: next };
  } catch {
    // Fail closed: a storage error never pays, and never throws into the settle path.
    return { paid: false, ledger };
  }
}

/** Entries with paidAtMs > 0 whose local day (formatDateKey, model.ts:221-226) equals that of `now`. */
export function countPaidOnDay(ledger: NewCardLedger, now: Date): number {
  const today = formatDateKey(now);
  let count = 0;
  for (const paidAtMs of Object.values(ledger)) {
    if (paidAtMs > 0 && formatDateKey(new Date(paidAtMs)) === today) count += 1;
  }
  return count;
}

/** R2 day marker (economyFloor pattern, :114-121): getUserScopedKey(DUE_CLEAR_MARKER_KEY) holds
 *  formatDateKey(now). Returns true and writes the marker only when it differs from today. Never throws
 *  (storage error → false). */
export const DUE_CLEAR_MARKER_KEY = 'recallsmith:due-clear:v1';
export async function markDueClearedIfFirstToday(now: Date): Promise<boolean> {
  const today = formatDateKey(now);
  try {
    const key = await getUserScopedKey(DUE_CLEAR_MARKER_KEY);
    const marker = await AsyncStorage.getItem(key);
    if (marker === today) return false;
    await AsyncStorage.setItem(key, today);
    return true;
  } catch {
    return false;
  }
}

/** A08 mechanism (drawStateStore.ts:332, rewardWallet.ts:208): scans getAllKeys for
 *  `${ANON_USER_SCOPE_PREFIX}${NEW_CARD_LEDGER_PREFIX}` (and the anon seeded markers), unions each
 *  slug's anon ledger into the user ledger (user value wins on a uid present in both), writes the user
 *  ledger, then removes the anon marker and the anon key (copy-then-clear). It never creates the USER
 *  partition's seeded marker: the user partition seeds itself (backfilling the account's already-learned
 *  cards) on its first settled rating, which is the only moment the account's progress is known. The anon
 *  marker is removed so a later signed-out period re-seeds from the anon progress instead of paying its
 *  adopted cards a second time. No-op while signed out. Never throws. The R2 marker is NOT adopted
 *  (C00 §6 #4). */
export type AnonLedgerAdoption = { ledgerDecks: number; uidsAdded: number };
export async function adoptAnonNewCardLedger(): Promise<AnonLedgerAdoption> {
  const result: AnonLedgerAdoption = { ledgerDecks: 0, uidsAdded: 0 };
  try {
    // Signed out: the current partition IS the anon partition, nothing to adopt into.
    const userScope = await getUserScopedKey('');
    if (userScope.startsWith(ANON_USER_SCOPE_PREFIX)) return result;

    const anonPrefix = `${ANON_USER_SCOPE_PREFIX}${NEW_CARD_LEDGER_PREFIX}`;
    const anonSeededPrefix = `${ANON_USER_SCOPE_PREFIX}${NEW_CARD_LEDGER_SEEDED_PREFIX}`;
    const keys = await AsyncStorage.getAllKeys();
    const slugs = new Set<string>();
    for (const key of keys) {
      if (key.startsWith(anonPrefix)) slugs.add(key.slice(anonPrefix.length));
      else if (key.startsWith(anonSeededPrefix)) slugs.add(key.slice(anonSeededPrefix.length));
    }
    slugs.delete('');

    for (const slug of slugs) {
      const anonKey = `${anonPrefix}${slug}`;
      const anonSeededKey = `${anonSeededPrefix}${slug}`;
      let anonLedger: NewCardLedger = {};
      const anonRaw = await AsyncStorage.getItem(anonKey);
      if (anonRaw != null) anonLedger = parseLedger(anonRaw);

      const { ledger: userLedger } = await readNewCardLedger(slug);
      const merged: NewCardLedger = { ...userLedger };
      let added = 0;
      for (const [uid, paidAtMs] of Object.entries(anonLedger)) {
        // User value wins where the uid is present in both.
        if (!hasUid(merged, uid)) {
          merged[uid] = paidAtMs;
          added += 1;
        }
      }

      // Ledger written first, anon keys removed second (copy-then-clear): a kill between
      // the writes replays the union on the next run, which is idempotent. The anon marker
      // goes before the anon ledger so a kill between those two leaves "ledger, no marker",
      // which the next anon seed unions into rather than "marker, no ledger", which would
      // let the adopted cards pay again on the anon partition.
      if (anonRaw != null) {
        const userKey = await getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`);
        await AsyncStorage.setItem(userKey, JSON.stringify(merged));
      }
      await AsyncStorage.removeItem(anonSeededKey);
      await AsyncStorage.removeItem(anonKey);

      result.ledgerDecks += 1;
      result.uidsAdded += added;
    }
  } catch {
    // Never throw: adoption must not fail sign-in. Return the counts so far.
  }
  return result;
}
