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

/** stableUid → paidAtMs. 0 = backfilled: the card was already learned when the ledger was first
 *  created on this partition, so it never pays (pre-OTA policy, C00 §6 #3). */
export type NewCardLedger = Record<string, number>;

// A stored value is only trusted where it is a JSON object of finite, non-negative
// numbers; every other shape (array, string, null, NaN, negative) reads as an empty
// ledger. Garbage never throws here -- the caller that wants to fail closed does so on
// a storage error, not on a corrupt value (a corrupt value reads as an empty, present
// ledger and is deliberately never re-seeded, C00 §2.2).
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

/** { ledger, present }. present=false when the key is absent. Throws on a storage error (callers
 *  fail closed). A corrupt value reads as { ledger: {}, present: true } (never re-seeded). */
export async function readNewCardLedger(slug: string): Promise<{ ledger: NewCardLedger; present: boolean }> {
  const key = await getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`);
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return { ledger: {}, present: false };
  return { ledger: parseLedger(raw), present: true };
}

/** present → returned unchanged. absent → written as { [uid]: 0 } for every entry of `progress`
 *  where isLearnedProgress (progressSelectors.ts:16-18), then returned. Throws on storage error. */
export async function seedNewCardLedgerIfAbsent(slug: string, progress: CardProgress[]): Promise<NewCardLedger> {
  const { ledger, present } = await readNewCardLedger(slug);
  if (present) return ledger;

  const seeded: NewCardLedger = {};
  for (const p of progress) {
    if (isLearnedProgress(p)) seeded[p.stableUid] = 0;
  }
  // Write even when the seed is {} -- an empty deck of learned cards still marks the
  // partition seeded, so a later brand-new card on it pays exactly once.
  const key = await getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`);
  await AsyncStorage.setItem(key, JSON.stringify(seeded));
  return seeded;
}

/** paid=false when the uid is already present (any value, including 0) or storage fails; otherwise
 *  writes ledger[uid] = nowMs FIRST and returns paid=true. Never throws. Does not seed. */
export async function payNewCardIfUnpaid(
  slug: string,
  stableUid: string,
  nowMs: number,
): Promise<{ paid: boolean; ledger: NewCardLedger }> {
  let ledger: NewCardLedger = {};
  try {
    const read = await readNewCardLedger(slug);
    ledger = read.ledger;
    if (stableUid in ledger) return { paid: false, ledger };
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
 *  `${ANON_USER_SCOPE_PREFIX}${NEW_CARD_LEDGER_PREFIX}`, unions each slug's anon ledger into the user
 *  ledger (user value wins on a uid present in both), writes the user ledger, then removes the anon key
 *  (copy-then-clear). No-op while signed out. Never throws. The R2 marker is NOT adopted (C00 §6 #4). */
export type AnonLedgerAdoption = { ledgerDecks: number; uidsAdded: number };
export async function adoptAnonNewCardLedger(): Promise<AnonLedgerAdoption> {
  const result: AnonLedgerAdoption = { ledgerDecks: 0, uidsAdded: 0 };
  try {
    // Signed out: the current partition IS the anon partition, nothing to adopt into.
    const userScope = await getUserScopedKey('');
    if (userScope.startsWith(ANON_USER_SCOPE_PREFIX)) return result;

    const anonPrefix = `${ANON_USER_SCOPE_PREFIX}${NEW_CARD_LEDGER_PREFIX}`;
    const keys = await AsyncStorage.getAllKeys();
    const slugs = keys
      .filter((key) => key.startsWith(anonPrefix))
      .map((key) => key.slice(anonPrefix.length))
      .filter((slug) => slug.length > 0);

    for (const slug of slugs) {
      const anonKey = `${anonPrefix}${slug}`;
      let anonLedger: NewCardLedger = {};
      const anonRaw = await AsyncStorage.getItem(anonKey);
      if (anonRaw != null) anonLedger = parseLedger(anonRaw);

      const { ledger: userLedger } = await readNewCardLedger(slug);
      const merged: NewCardLedger = { ...userLedger };
      let added = 0;
      for (const [uid, paidAtMs] of Object.entries(anonLedger)) {
        // User value wins where the uid is present in both.
        if (!(uid in merged)) {
          merged[uid] = paidAtMs;
          added += 1;
        }
      }

      // Ledger written first, anon key removed second (copy-then-clear): a kill between
      // the two writes replays the union on the next run, which is idempotent.
      const userKey = await getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`);
      await AsyncStorage.setItem(userKey, JSON.stringify(merged));
      await AsyncStorage.removeItem(anonKey);

      result.ledgerDecks += 1;
      result.uidsAdded += added;
    }
  } catch {
    // Never throw: adoption must not fail sign-in. Return the counts so far.
  }
  return result;
}
