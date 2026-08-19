import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

import { buildDrawState, pickDrawPreviewCards } from '../../src/features/gacha/draw/drawState';
import { consumePullsFromWallet, consumePullsFromStoredWallet, saveRewardWalletState } from '../../src/features/gacha/rewards/rewardWallet';

describe('drawState', () => {
  beforeEach(() => {
    store.clear();
  });

  it('marks draw as locked when there are no pulls and due work still exists', () => {
    const state = buildDrawState({
      wallet: { availablePulls: 0, reservePulls: 0 },
      hasTodayWork: true,
    });

    expect(state.state).toBe('locked');
    expect(state.canOpen).toBe(false);
    expect(state.helper).toMatch(/clear today/i);
  });

  it('marks draw as reward-pending when a session just granted pulls', () => {
    const state = buildDrawState({
      wallet: { availablePulls: 2, reservePulls: 0 },
      hasTodayWork: false,
      rewardPending: true,
    });

    expect(state.state).toBe('reward-pending');
    expect(state.canOpen).toBe(true);
  });

  it('prioritizes new cards first when previewing draw results', () => {
    const rows = [
      { stableUid: '3', orderInDeck: 3, question: 'Q3', difficulty: 3, status: 'mastered', statusLabel: 'Mastered', isDueToday: false, isUpdated: false },
      { stableUid: '2', orderInDeck: 2, question: 'Q2', difficulty: 2, status: 'learning', statusLabel: 'Learning', isDueToday: true, isUpdated: true },
      { stableUid: '1', orderInDeck: 1, question: 'Q1', difficulty: 1, status: 'new', statusLabel: 'New', isDueToday: false, isUpdated: false },
    ] as any;

    const picks = pickDrawPreviewCards(rows, 2);
    expect(picks.map((item: any) => item.stableUid)).toEqual(['1', '2']);
  });

  it('prioritizes cards outside the collection ahead of owned ones', () => {
    // 'missing' only exists once a caller gates the library rows, and it has to
    // outrank 'new': a preview of a draw should show what a pull could still
    // give you, and an owned-but-unstudied card is not that.
    const rows = [
      { stableUid: '1', orderInDeck: 1, question: 'Q1', difficulty: 1, status: 'new', statusLabel: 'New', isMissing: false, isDueToday: false, isUpdated: false },
      { stableUid: '2', orderInDeck: 2, question: 'Q2', difficulty: 2, status: 'missing', statusLabel: 'Missing', isMissing: true, isDueToday: false, isUpdated: false },
    ] as any;

    expect(pickDrawPreviewCards(rows, 1).map((item: any) => item.stableUid)).toEqual(['2']);
  });

  it('marks draw as wallet-full-with-reserve when reserve is waiting behind a full wallet', () => {
    const state = buildDrawState({
      wallet: { availablePulls: 30, reservePulls: 2 },
      hasTodayWork: false,
    });

    expect(state.state).toBe('wallet-full-with-reserve');
    expect(state.canOpen).toBe(true);
    expect(state.helper).toMatch(/reserve/i);
  });

  it('keeps draw locked when no active pool is available even with pulls in wallet', () => {
    const state = buildDrawState({
      wallet: { availablePulls: 2, reservePulls: 0 },
      hasTodayWork: false,
      hasActivePool: false,
    });

    expect(state.state).toBe('locked');
    expect(state.canOpen).toBe(false);
    expect(state.ctaLabel).toBe('View library');
  });
});

describe('consumePulls', () => {
  it('spends one available pull and backfills from reserve', () => {
    const result = consumePullsFromWallet({ availablePulls: 30, reservePulls: 2 }, 1);

    expect(result.wallet).toEqual({ availablePulls: 30, reservePulls: 1 });
    expect(result.spent).toBe(1);
    expect(result.promotedFromReserve).toBe(1);
  });

  it('spends from stored wallet state', async () => {
    await saveRewardWalletState({ availablePulls: 2, reservePulls: 0 });
    const result = await consumePullsFromStoredWallet(1);

    expect(result.wallet).toEqual({ availablePulls: 1, reservePulls: 0 });
    expect(result.spent).toBe(1);
  });

  it('does not treat reserve pulls as immediately spendable for a single open action', () => {
    const result = consumePullsFromWallet({ availablePulls: 5, reservePulls: 5 }, 10);

    expect(result.spent).toBe(5);
    expect(result.wallet).toEqual({ availablePulls: 5, reservePulls: 0 });
  });
});
