import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

vi.mock('expo-store-review', () => ({
  isAvailableAsync: vi.fn(async () => true),
  requestReview: vi.fn(async () => {}),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import {
  RATING_PROMPT_KEY,
  maybeRequestRating,
  parseRatingPromptState,
  resolveRatingTrigger,
  shouldRequestRating,
} from '../../src/features/gacha/milestones/ratingPrompt';

describe('ratingPrompt', () => {
  beforeEach(() => {
    store.clear();
    vi.mocked(AsyncStorage.getItem).mockClear();
    vi.mocked(AsyncStorage.setItem).mockClear();
    vi.mocked(AsyncStorage.removeItem).mockClear();
    vi.mocked(StoreReview.isAvailableAsync).mockReset();
    vi.mocked(StoreReview.isAvailableAsync).mockImplementation(async () => true);
    vi.mocked(StoreReview.requestReview).mockReset();
    vi.mocked(StoreReview.requestReview).mockImplementation(async () => {});
  });

  it('shouldRequestRating is true only for a null state', () => {
    expect(shouldRequestRating(null, 'first-legendary')).toBe(true);
    expect(shouldRequestRating({ requestedAt: 1, trigger: 'first-legendary' }, 'first-legendary')).toBe(false);
    expect(shouldRequestRating({ requestedAt: 1, trigger: 'streak-7' }, 'streak-7')).toBe(false);
  });

  it('resolveRatingTrigger prefers first-legendary, then a 7-day streak, else null', () => {
    expect(resolveRatingTrigger({ hasLegendary: true, currentDailyStreak: 0 })).toBe('first-legendary');
    expect(resolveRatingTrigger({ hasLegendary: true, currentDailyStreak: 9 })).toBe('first-legendary');
    expect(resolveRatingTrigger({ hasLegendary: false, currentDailyStreak: 7 })).toBe('streak-7');
    expect(resolveRatingTrigger({ hasLegendary: false, currentDailyStreak: 6 })).toBe(null);
    expect(resolveRatingTrigger({ hasLegendary: false, currentDailyStreak: 0 })).toBe(null);
  });

  it('parseRatingPromptState rejects malformed values', () => {
    expect(parseRatingPromptState(null)).toBe(null);
    expect(parseRatingPromptState('{}')).toBe(null);
    expect(parseRatingPromptState('not json')).toBe(null);
    expect(parseRatingPromptState('{"requestedAt":"x","trigger":"streak-7"}')).toBe(null);
    expect(parseRatingPromptState('{"requestedAt":5,"trigger":"bogus"}')).toBe(null);
    expect(parseRatingPromptState('{"requestedAt":5,"trigger":"first-legendary"}')).toEqual({
      requestedAt: 5,
      trigger: 'first-legendary',
    });
  });

  it('requests a review once per install and records it under RATING_PROMPT_KEY', async () => {
    expect(await maybeRequestRating('first-legendary')).toBe('requested');
    const recorded = parseRatingPromptState(store.get(RATING_PROMPT_KEY) ?? null);
    expect(recorded).toMatchObject({ trigger: 'first-legendary' });
    expect(typeof recorded?.requestedAt).toBe('number');
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);

    expect(await maybeRequestRating('streak-7')).toBe('already');
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable when store review is unavailable and keeps the one chance', async () => {
    vi.mocked(StoreReview.isAvailableAsync).mockImplementation(async () => false);
    expect(await maybeRequestRating('first-legendary')).toBe('unavailable');
    expect(store.has(RATING_PROMPT_KEY)).toBe(false);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();

    vi.mocked(StoreReview.isAvailableAsync).mockImplementation(async () => true);
    expect(await maybeRequestRating('first-legendary')).toBe('requested');
  });

  it('returns failed when storage cannot be read and never throws', async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('read boom'));
    expect(await maybeRequestRating('first-legendary')).toBe('failed');
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });

  it('a review request that throws still counts as consumed', async () => {
    vi.mocked(StoreReview.requestReview).mockImplementation(async () => {
      throw new Error('os boom');
    });
    expect(await maybeRequestRating('first-legendary')).toBe('failed');
    expect(store.has(RATING_PROMPT_KEY)).toBe(true);

    vi.mocked(StoreReview.requestReview).mockImplementation(async () => {});
    expect(await maybeRequestRating('first-legendary')).toBe('already');
  });

  it('returns unavailable when expo-store-review cannot be loaded', async () => {
    vi.resetModules();
    vi.doMock('expo-store-review', () => {
      throw new Error('missing');
    });
    try {
      const mod = await import('../../src/features/gacha/milestones/ratingPrompt');
      expect(await mod.maybeRequestRating('first-legendary')).toBe('unavailable');
      expect(store.has(mod.RATING_PROMPT_KEY)).toBe(false);
    } finally {
      vi.doUnmock('expo-store-review');
      vi.resetModules();
    }
  });
});
