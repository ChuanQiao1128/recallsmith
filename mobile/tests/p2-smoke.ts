import * as assert from 'node:assert/strict';
import { buildChallengeRoute } from '../src/features/gacha/planner/sessionBuilder';
import { countDueToday, pickNextCard, planChallengeRoute } from '../src/features/gacha/planner/sessionPlanner';
import { applyRewardToWallet } from '../src/features/gacha/rewards/rewardWallet';
import { resolveSessionReward } from '../src/features/gacha/rewards/rewardResolver';
import { buildSessionSummaryVM } from '../src/features/gacha/session/summaryMapper';
import { buildLibraryVM } from '../src/features/gacha/library/libraryMapper';
import { buildHomeVM } from '../src/features/gacha/selectors/homeSelectors';

const NOW = new Date('2026-04-23T12:00:00.000Z');
const TODAY_MS = NOW.getTime();
const TOMORROW_MS = TODAY_MS + 24 * 60 * 60 * 1000;
const YESTERDAY_MS = TODAY_MS - 24 * 60 * 60 * 1000;

const sampleDeck = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 4,
  Cards: [
    { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Revision: 1 },
    { StableUid: '2', OrderInDeck: 2, Difficulty: 2, Question: 'Q2', Revision: 2 },
    { StableUid: '3', OrderInDeck: 3, Difficulty: 3, Question: 'Q3', Revision: 1 },
    { StableUid: '4', OrderInDeck: 4, Difficulty: 2, Question: 'Q4', Revision: 1 },
  ],
} as any;

const sampleProgress = [
  { stableUid: '1', stage: 0, nextReviewAt: 0 },
  { stableUid: '2', stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: YESTERDAY_MS, lastSeenRevision: 1 },
  { stableUid: '3', stage: 4, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: TOMORROW_MS, lastSeenRevision: 1 },
  { stableUid: '4', stage: 0, nextReviewAt: 0 },
] as any;

const challenge = buildChallengeRoute({
  slug: 'csharp',
  deckTitle: 'C# Interview',
  dueCount: 3,
  newCount: 2,
});
assert.equal(challenge.minimumGoal, 1);
assert.equal(challenge.limit, 4);
assert.equal(challenge.nodes[challenge.nodes.length - 1]?.role, 'boss');
assert.match(challenge.summary, /keep momentum/i);

const maintenanceChallenge = buildChallengeRoute({
  slug: 'csharp',
  deckTitle: 'C# Interview',
  dueCount: 0,
  newCount: 0,
});
assert.equal(maintenanceChallenge.limit, 1);
assert.equal(maintenanceChallenge.nodes[0]?.role, 'warmup');
assert.match(maintenanceChallenge.summary, /maintenance run/i);

const plannedChallenge = planChallengeRoute({
  deck: sampleDeck,
  progress: sampleProgress,
  now: NOW,
});
assert.equal(plannedChallenge.dueCount, 1);
assert.equal(plannedChallenge.newCount, 2);
assert.equal(plannedChallenge.limit, 2);

assert.equal(countDueToday(sampleProgress, NOW), 1);

const reviewDueCard = pickNextCard({
  deck: sampleDeck,
  progress: sampleProgress,
  now: NOW,
  mode: 'review-due',
});
assert.equal(reviewDueCard?.card.StableUid, '2');

const learnNewCard = pickNextCard({
  deck: sampleDeck,
  progress: sampleProgress,
  now: NOW,
  mode: 'learn-new',
});
assert.equal(learnNewCard?.card.StableUid, '1');

const updatedOnlyDeck = {
  ...sampleDeck,
  Cards: [
    { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Revision: 1 },
    { StableUid: '2', OrderInDeck: 2, Difficulty: 2, Question: 'Q2', Revision: 2 },
  ],
} as any;

const updatedOnlyProgress = [
  { stableUid: '1', stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: TOMORROW_MS, lastSeenRevision: 1 },
  { stableUid: '2', stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: TOMORROW_MS, lastSeenRevision: 1 },
] as any;

const mixedUpdatedCard = pickNextCard({
  deck: updatedOnlyDeck,
  progress: updatedOnlyProgress,
  now: NOW,
  mode: 'mixed',
});
assert.equal(mixedUpdatedCard?.card.StableUid, '2');

const mixedFallbackCard = pickNextCard({
  deck: sampleDeck,
  progress: sampleProgress,
  now: NOW,
  mode: 'mixed',
  avoidUid: '2',
});
assert.equal(mixedFallbackCard?.card.StableUid, '2');

const wallet = applyRewardToWallet({ availablePulls: 29, reservePulls: 4 }, 3);
assert.equal(wallet.availablePulls, 30);
assert.equal(wallet.reservePulls, 5);
assert.equal(wallet.appliedToAvailable, 1);
assert.equal(wallet.appliedToReserve, 1);
assert.equal(wallet.dropped, 1);

const fullWallet = applyRewardToWallet({ availablePulls: 30, reservePulls: 5 }, 2);
assert.equal(fullWallet.availablePulls, 30);
assert.equal(fullWallet.reservePulls, 5);
assert.equal(fullWallet.dropped, 2);

const reward = resolveSessionReward({
  sessionDone: 4,
  sessionLimit: 4,
  minimumGoal: 1,
  wallet: { availablePulls: 0, reservePulls: 0 },
});
assert.equal(reward.completedFullRun, true);
assert.equal(reward.rewardPulls, 2);
assert.match(reward.rewardMessage, /\+2 free pulls/i);

const minimumReward = resolveSessionReward({
  sessionDone: 1,
  sessionLimit: 4,
  minimumGoal: 1,
  wallet: { availablePulls: 30, reservePulls: 4 },
});
assert.equal(minimumReward.completedMinimumGoal, true);
assert.equal(minimumReward.completedFullRun, false);
assert.equal(minimumReward.rewardPulls, 1);
assert.match(minimumReward.rewardMessage, /pending in reserve/i);

const summary = buildSessionSummaryVM({
  deckTitle: 'C# Interview',
  sessionDone: 4,
  sessionLimit: 4,
  minimumGoal: 1,
  dueCount: 3,
  wallet: { availablePulls: 0, reservePulls: 0 },
});
assert.equal(summary.vm.completionLabel, 'Full run cleared');
assert.match(summary.vm.rewardBadge, /\+2 pull/i);
assert.match(summary.vm.rewardBody, /ready to use/i);

const summaryWithoutWallet = buildSessionSummaryVM({
  deckTitle: 'C# Interview',
  sessionDone: 1,
  sessionLimit: 4,
  minimumGoal: 1,
  dueCount: 3,
});
assert.match(summaryWithoutWallet.vm.rewardBody, /earned for this run/i);
assert.equal(summaryWithoutWallet.vm.nextActionLabel, 'Keep momentum');

const homeNoDeck = buildHomeVM({
  selectedSlug: null,
  hasSignedInUser: false,
  deckSummaries: [],
});
assert.equal(homeNoDeck.hero.ctaAction, 'none');
assert.equal(homeNoDeck.hero.ctaDisabled, true);

const homeNotReady = buildHomeVM({
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
assert.equal(homeNotReady.hero.ctaLabel, 'Open library');
assert.equal(homeNotReady.hero.ctaAction, 'deck');

const homeWithNoWork = buildHomeVM({
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
      dueToday: 0,
      plannedToday: 0,
      newToday: 0,
      masteredApprox: 4,
      percent: 0.4,
    },
  ],
});
assert.equal(homeWithNoWork.hero.ctaLabel, 'Open library');
assert.equal(homeWithNoWork.hero.ctaAction, 'deck');

const homeWithWork = buildHomeVM({
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
assert.equal(homeWithWork.hero.ctaLabel, 'Start today’s challenge');
assert.equal(homeWithWork.hero.ctaAction, 'challenge');
assert.match(homeWithWork.drawStatusLabel, /unlock after you clear today’s work/i);

const library = buildLibraryVM({
  deck: sampleDeck,
  progress: sampleProgress,
  now: NOW,
});
assert.equal(library.counts.newCount, 2);
assert.equal(library.counts.learningCount, 1);
assert.equal(library.counts.masteredCount, 1);
assert.equal(library.counts.updatedCount, 1);
assert.equal(library.counts.dueTodayCount, 1);
assert.match(library.drawStatusLabel, /due cards/i);

const trialLibrary = buildLibraryVM({
  deck: sampleDeck,
  progress: sampleProgress,
  now: NOW,
  isTrial: true,
  previewTotal: 2,
});
assert.equal(trialLibrary.subtitle, 'Library · Free trial slice');
assert.equal(trialLibrary.counts.updatedCount, 1);

console.log('p2 smoke passed');
