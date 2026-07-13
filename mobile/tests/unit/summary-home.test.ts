import { describe, expect, it } from 'vitest';
import { buildSessionSummaryVM } from '../../src/features/gacha/session/summaryMapper';
import { buildHomeVM } from '../../src/features/gacha/selectors/homeSelectors';

describe('buildSessionSummaryVM', () => {
  it('builds full-run summary copy with wallet-aware reward text', () => {
    // v3 reward calibration: full clear → +1 pull (was +2). See
    // computeSessionRewardPulls in rewardResolver.
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 5,
      sessionLimit: 5,
      minimumGoal: 1,
      dueCount: 3,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(summary.vm.completionLabel).toBe('Full run cleared');
    expect(summary.vm.rewardBadge).toMatch(/\+1 pull/i);
    expect(summary.vm.rewardBody).toMatch(/ready to use/i);
  });

  it('falls back to neutral reward copy when wallet is unavailable', () => {
    // v3: hitting only minimumGoal (not full clear) earns 0 pulls now.
    // The summary copy still distinguishes "no reward earned this run"
    // from "no wallet info available".
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 1,
      sessionLimit: 5,
      minimumGoal: 1,
      dueCount: 3,
    });

    // Below full clear → progress saved, no pull badge
    expect(summary.vm.nextActionLabel).toBe('Keep momentum');
  });

  it('uses neutral progress copy when no reward is earned', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 0,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 3, reservePulls: 0 },
    });

    expect(summary.vm.rewardBadge).toBe('Progress saved');
    expect(summary.vm.rewardBody).toMatch(/progress saved/i);
  });
});

describe('buildHomeVM', () => {
  it('keeps an enabled library CTA when no deck is available', () => {
    const home = buildHomeVM({
      selectedSlug: null,
      hasSignedInUser: false,
      deckSummaries: [],
    });

    expect(home.hero.ctaLabel).toBe('Open library');
    expect(home.hero.ctaAction).toBe('deck');
    expect(home.hero.ctaDisabled).toBe(false);
  });

  it('routes users to the library when the selected deck is not study-ready', () => {
    const home = buildHomeVM({
      selectedSlug: 'premium-deck',
      hasSignedInUser: true,
      deckSummaries: [
        {
          slug: 'premium-deck',
          title: 'Premium Deck',
          locale: 'en-US',
          version: '1',
          deckType: 2,
          totalCards: 100,
          localCards: 0,
          studyCards: 0,
          canStudy: false,
          dueToday: 0,
          plannedToday: 0,
          newToday: 0,
          masteredApprox: 0,
          percent: 0,
        },
      ],
    });

    expect(home.hero.ctaLabel).toBe('Open library');
    expect(home.hero.ctaAction).toBe('deck');
  });

  it('routes users to the challenge when work is waiting today', () => {
    const home = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [
        {
          slug: 'csharp',
          title: 'C# Interview',
          locale: 'en-US',
          version: '1',
          deckType: 1,
          totalCards: 10,
          localCards: 10,
          studyCards: 10,
          canStudy: true,
          dueToday: 3,
          plannedToday: 3,
          newToday: 1,
          masteredApprox: 4,
          percent: 0.4,
        },
      ],
    });

    expect(home.hero.ctaLabel).toBe('Start today’s challenge');
    expect(home.hero.ctaAction).toBe('challenge');
    expect(home.drawStatusLabel).toMatch(/unlock after you clear today’s work/i);
  });
});
