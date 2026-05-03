import { describe, expect, it } from 'vitest';
import { buildSettlementVm } from '../../src/features/gacha/settlement/settlementVm';
import { buildMockSessionCards } from '../../src/mock/session';

describe('settlement vm', () => {
  it('builds reward and mastery summaries from ratings', () => {
    const cards = buildMockSessionCards(['draw-1', 'draw-2']);
    const vm = buildSettlementVm({
      deckTitle: 'C# Interview',
      cards,
      ratings: [
        { stableUid: 'draw-1', rating: 'good' },
        { stableUid: 'draw-2', rating: 'easy' },
      ],
    });

    expect(vm.title).toContain('C# Interview');
    expect(vm.pullsAwarded).toBeGreaterThan(0);
    expect(vm.masteredCount).toBeGreaterThan(0);
  });
});
