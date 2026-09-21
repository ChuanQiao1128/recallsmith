// AsyncStorage-backed "has this phone seen the MCQ coach line" flag.
// The key is device-global on purpose (no per-user prefix, unlike draw state) — familiarity
// with the new card type belongs to the phone, not the account. Fail-open: any error, garbage
// or a slow read counts as "seen", so nobody is ever stuck behind the hint. The 250 ms budget
// matters because the screen reads on mount and must not wait on storage. Nothing is memoised in
// memory: storage is the only source of truth, so a remembered flag would leak across cases.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MCQ_COACH_READ_TIMEOUT_MS, MCQ_COACH_SEEN_KEY } from './mcqConstants';

export { MCQ_COACH_SEEN_KEY, MCQ_COACH_READ_TIMEOUT_MS } from './mcqConstants';

/** true when the key holds '1'; any error, garbage or a read slower than MCQ_COACH_READ_TIMEOUT_MS → true ("seen": nobody is ever stuck behind the line). */
export function readMcqCoachSeen(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (seen: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(seen);
    };
    try {
      // Race the read against the budget; a hang resolves "seen" rather than blocking the line.
      timer = setTimeout(() => done(true), MCQ_COACH_READ_TIMEOUT_MS);
      AsyncStorage.getItem(MCQ_COACH_SEEN_KEY).then(
        (raw) => done(raw !== null),
        () => done(true),
      );
    } catch {
      done(true);
    }
  });
}

/** Writes '1'. Never throws. */
export async function markMcqCoachSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(MCQ_COACH_SEEN_KEY, '1');
  } catch {
    /* swallowed: storage stays the source of truth; the next read sees whatever is stored */
  }
}
