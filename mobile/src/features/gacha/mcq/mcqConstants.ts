// mobile/src/features/gacha/mcq/mcqConstants.ts
// Pure copy / testID / budget catalogue for the MCQ card type (D02, plan §5.2/§5.6).
// No imports: nothing here reaches react, storage, a clock or randomness.

export const MCQ_FAST_MS = Object.freeze({ upToFourOptions: 20_000, fiveOrSix: 30_000 });   // plan §5.2
export const MCQ_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;   // by DISPLAYED position, never by key
export function mcqLetter(index: number): string { return MCQ_LETTERS[index] ?? '?'; }
export const MCQ_COACH_SEEN_KEY = 'recallsmith:mcq:coach-seen:v1';   // device-global (ceremonyPrefs pattern), no user scoping
export const MCQ_COACH_READ_TIMEOUT_MS = 250;
export const MCQ_COPY = Object.freeze({
  kindChip: { single: 'Multiple choice', two: 'Choose 2', three: 'Choose 3' },
  stemHint: 'Decide on your answer before you look at the options.',
  showOptions: 'Show options',
  showFullStem: 'Show full question',
  sure: 'Sure',
  unsure: 'Not sure',
  dontKnow: "I don't know",
  confidenceHint: 'How confident are you?',
  overLimit: 'Deselect one first',
  bannerCorrect: 'Correct',
  bannerWrong: 'Not this time',
  rowCorrectPicked: 'Correct',
  rowCorrectMissed: 'You missed this one',
  rowWrongPicked: 'Your pick',
  rowWhyNot: 'Why not?',
  sectionExplanation: 'EXPLANATION',
  sectionQualifier: 'WHY THE QUALIFIER MATTERS',
  sectionUsage: 'REAL USAGE',
  sectionCode: 'CODING SAMPLE',
  next: 'Next',
  finishRun: 'Finish run',
  redeal: "Back again — let's see if it stuck",
  coach: "New card type. Decide first, then reveal the options. Sure / Not sure tells the scheduler how confident you were; I don't know skips the guess and shows the explanations.",
  coachDismiss: 'Got it',
  faceMark: 'MC',                                   // Library tile + DrawResult featured mark
  faceMarkPick: (n: number) => `MC · pick ${n}`,    // requiredCount ≥ 2
  detailChip: 'Multiple choice',
  detailChipPick: (n: number) => `Multiple choice · pick ${n}`,
});

/** requiredCount → kind chip label (gap #4): >= 3 → three, === 2 → two, else (0, 1, NaN) → single. */
export function mcqKindChip(requiredCount: number): string {
  if (requiredCount >= 3) return MCQ_COPY.kindChip.three;
  if (requiredCount === 2) return MCQ_COPY.kindChip.two;
  return MCQ_COPY.kindChip.single;
}

export function mcqSelectedCount(k: number, n: number): string {
  return `${k} of ${n} selected`;
}

export function mcqBannerPartial(k: number, n: number): string {
  return `You knew ${k} of ${n}`;
}

export function mcqQualifierBody(qualifier: string): string {
  return `The stem asked for the ${qualifier} option. Several options would work; the one that best satisfies that phrase wins.`;
}

export function mcqOptionA11yLabel(index: number, total: number, text: string): string {
  return `Option ${mcqLetter(index)} of ${total}: ${text}`;
}

/** Accessibility label of a wrong-unpicked row's "Why not?" toggle (review 2026-09-22 #6): one label per
 *  displayed position so VoiceOver does not read five identical buttons. Letter by DISPLAYED index. */
export function mcqWhyNotA11yLabel(index: number): string {
  return `Why not option ${mcqLetter(index)}`;
}

/** How long the inline over-limit hint stays on screen after an ignored tap (review 2026-09-22 #5). */
export const MCQ_OVER_LIMIT_HINT_MS = 1_500;

/** VoiceOver announcement for a tap beyond requiredCount on a choose-N card (review 2026-09-22 #5). The
 *  visible hint stays MCQ_COPY.overLimit; the announcement adds the count so the rule is audible. */
export function mcqOverLimitAnnouncement(requiredCount: number): string {
  return `Pick ${requiredCount} answers — deselect one first`;
}

export function mcqPicksLine(picks: { landed: number; answered: number }): string {
  return picks.landed === 0
    ? `0 of ${picks.answered} picks landed — they're all back in 10 minutes`
    : `${picks.landed} of ${picks.answered} picks landed`;
}

export const MCQ_TEST_IDS = Object.freeze({
  body: 'mcq-review-body', kindChip: 'mcq-kind-chip', stem: 'mcq-stem', qualifier: 'mcq-qualifier', stemHint: 'mcq-stem-hint',
  showFullStem: 'mcq-show-full-stem', option: (key: string) => `mcq-option-${key}`, optionLetter: (key: string) => `mcq-option-letter-${key}`,
  overLimitHint: 'mcq-over-limit-hint', verdictBanner: 'mcq-verdict-banner', scheduleLine: 'mcq-schedule-line',
  why: (key: string) => `mcq-why-${key}`, whyToggle: (key: string) => `mcq-why-toggle-${key}`,
  sectionExplanation: 'mcq-section-explanation', sectionQualifier: 'mcq-section-qualifier', sectionUsage: 'mcq-section-usage', sectionCode: 'mcq-section-code',
  redealBanner: 'mcq-redeal-banner',
  dock: 'review-rating-bar', dockHint: 'mcq-dock-hint', selectedCount: 'mcq-selected-count',
  showOptions: 'mcq-show-options', submitSure: 'mcq-submit-sure', submitUnsure: 'mcq-submit-unsure', dontKnow: 'mcq-dont-know', next: 'mcq-next',
  coachLine: 'mcq-coach-line', coachDismiss: 'mcq-coach-dismiss',
  summaryPicks: 'session-summary-picks',
  drawFeaturedKind: 'draw-result-featured-kind', cardDetailKind: 'card-detail-kind-chip', libraryKind: (uid: string) => `library-card-kind-${uid}`,
});
