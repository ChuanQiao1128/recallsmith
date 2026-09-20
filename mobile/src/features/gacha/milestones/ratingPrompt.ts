import AsyncStorage from '@react-native-async-storage/async-storage';

// R7 — one store-review request per install, ever. The store-review package
// ships in the binary (B01) but is optional at runtime and absent from tests,
// so it is loaded through a guarded dynamic import() inside a function — never a
// static `import … from` and never a CommonJS require. Under this repo's vitest
// a dynamic import() is intercepted by the test's module factory, whereas a
// CommonJS require would bypass the mock (see B00-contracts §2.15).

export const RATING_PROMPT_KEY = 'recallsmith:rating-prompt:v1';
export const RATING_STREAK_DAYS = 7;
/** DrawResult waits this long after mount before asking (the Pokedex pill and the featured spring are done). */
export const RATING_PROMPT_DELAY_MS = 1500;
export type RatingTrigger = 'first-legendary' | 'streak-7';
export type RatingPromptState = { requestedAt: number; trigger: RatingTrigger } | null;
export type RatingPromptOutcome = 'requested' | 'already' | 'unavailable' | 'failed';

type StoreReviewModule = {
  isAvailableAsync: () => Promise<boolean>;
  requestReview: () => Promise<void>;
};

const KNOWN_TRIGGERS: readonly RatingTrigger[] = ['first-legendary', 'streak-7'];

/** Pure: true only when nothing has been recorded (state === null). `trigger` is accepted for symmetry/logging. */
export function shouldRequestRating(state: RatingPromptState, trigger: RatingTrigger): boolean {
  void trigger;
  return state === null;
}

/** Pure: 'first-legendary' when hasLegendary, else 'streak-7' when currentDailyStreak >= RATING_STREAK_DAYS, else null. */
export function resolveRatingTrigger(input: { hasLegendary: boolean; currentDailyStreak: number }): RatingTrigger | null {
  if (input.hasLegendary) return 'first-legendary';
  if (input.currentDailyStreak >= RATING_STREAK_DAYS) return 'streak-7';
  return null;
}

/** Pure: JSON with a finite requestedAt >= 0 and a known trigger → state; anything else → null. */
export function parseRatingPromptState(raw: string | null): RatingPromptState {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const requestedAt = record.requestedAt;
    const trigger = record.trigger;
    if (typeof requestedAt !== 'number' || !Number.isFinite(requestedAt) || requestedAt < 0) return null;
    if (typeof trigger !== 'string' || !KNOWN_TRIGGERS.includes(trigger as RatingTrigger)) return null;
    return { requestedAt, trigger: trigger as RatingTrigger };
  } catch {
    return null;
  }
}

async function loadStoreReview(): Promise<StoreReviewModule | null> {
  try {
    const mod = (await import('expo-store-review')) as
      | (Partial<StoreReviewModule> & { default?: Partial<StoreReviewModule> })
      | undefined;
    const isAvailableAsync = mod?.isAvailableAsync ?? mod?.default?.isAvailableAsync;
    const requestReview = mod?.requestReview ?? mod?.default?.requestReview;
    return typeof isAvailableAsync === 'function' && typeof requestReview === 'function'
      ? { isAvailableAsync, requestReview }
      : null;
  } catch {
    return null;
  }
}

/** Never throws — resolves to an outcome on every path. */
export async function maybeRequestRating(trigger: RatingTrigger): Promise<RatingPromptOutcome> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(RATING_PROMPT_KEY);
  } catch {
    // Fail closed: a storage fault must not risk a second prompt later.
    return 'failed';
  }
  const state = parseRatingPromptState(raw);
  if (!shouldRequestRating(state, trigger)) return 'already';
  const review = await loadStoreReview();
  if (!review) return 'unavailable';
  try {
    // 'unavailable' writes nothing, so the one chance is kept for a device where
    // the sheet can actually appear.
    if (!(await review.isAvailableAsync())) return 'unavailable';
    // Record BEFORE awaiting the request, so a rejected OS call still counts as
    // consumed and can never lead to a second prompt.
    await AsyncStorage.setItem(RATING_PROMPT_KEY, JSON.stringify({ requestedAt: Date.now(), trigger }));
    await review.requestReview();
    return 'requested';
  } catch {
    return 'failed';
  }
}
