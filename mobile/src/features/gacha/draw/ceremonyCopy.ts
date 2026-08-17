export type CeremonyPhase = 'warmup' | 'focus' | 'reveal';
export type MultiCeremonyPhase = 'orbit' | 'charge' | 'stabilize';
export type CeremonyRarity = 'COM' | 'RAR' | 'LEG' | 'RAR+' | 'COM+';

export const CEREMONY_COPY = {
  motionHint: 'Reduced motion on',
  cardBackLabel: 'Reward card',
  primaryCta: 'Show result',
  pityBonus: 'Pity bonus rare or better',
  handoffCue: {
    single: 'Your card is ready',
    multi: 'Draws are ready',
  },
  single: {
    meta: 'Single pull ceremony',
    revealHint: 'Reveal coming up',
    cardHint: 'One card only. Ready for the next study run',
    featuredPrefix: 'Single-pull spotlight',
    title: {
      warmup: 'Drawing one card...',
      focus: 'Almost there...',
      reveal: 'Your card',
    },
    body: {
      warmup: 'One reward card is getting ready for your next study run.',
      focus: 'The reveal finishes in a moment.',
      reveal: 'This reward is ready for review when you are.',
    },
    phaseCue: {
      warmup: 'Drawing started',
      focus: 'Reveal coming up',
      reveal: 'Card shown',
    },
  },
  multi: {
    meta: 'Reward draw ceremony',
    finalHint: 'The highlight is ready. The spread follows.',
    featuredPrefix: 'Featured reward',
    title: {
      orbit: 'Drawing 10 cards...',
      charge: 'Hold for the highlight...',
      stabilize: 'Lining up your draws...',
    },
    body: {
      orbit: 'Your ten-card reward is getting ready.',
      charge: 'The highlight takes the center.',
      stabilize: 'Your draw is ready to review.',
    },
    phaseCue: {
      orbit: 'Drawing started',
      charge: 'Highlight coming up',
      stabilize: 'Results ready soon',
    },
  },
  rarity: {
    LEG: 'Legendary',
    RAR: 'Rare',
    COM: 'Common',
    'RAR+': 'Rare or better',
    'COM+': 'Common or better',
  },
} as const;

export const CEREMONY_COPY_V9 = {
  swipe: {
    title: 'Swipe to open',
    body: 'Drag the pack to start the reveal.',
  },
  approach: {
    title: 'Pack inbound',
    body: 'Your pack is moving into focus.',
    rareTitles: {
      COM: 'Pack inbound',
      RAR: 'Rare inbound',
      LEG: 'Legendary inbound',
    },
  },
  hold: {
    title: 'Hold steady',
    body: 'The reveal is loading.',
  },
  'tear-flip': {
    title: 'Opening carousel',
    body: 'Ten cards are spinning into place.',
  },
  'flash-reveal': {
    title: 'Card revealed',
    body: 'The featured card is visible. Final settle comes next.',
  },
  settle: {
    title: 'Cards in place',
    body: 'Tap to see your draw.',
  },
} as const;

const CEREMONY_TEAR_FLIP_SINGLE = {
  title: 'Opening reveal',
  body: 'Your card is spinning into place.',
} as const;

const CEREMONY_CARDS_ON_TABLE = {
  title: 'Tap to reveal',
  body: 'Tap each card to flip it.',
} as const;

type CeremonyPhaseV9 = keyof typeof CEREMONY_COPY_V9;
// Caller can also pass the new 'cards-on-table' phase which lives outside the V9 table.
type CeremonyPhaseExtended = CeremonyPhaseV9 | 'cards-on-table';

export function getCeremonyPhaseCopy(phase: CeremonyPhaseExtended, isMulti: boolean) {
  if (phase === 'tear-flip') {
    return isMulti ? CEREMONY_COPY_V9['tear-flip'] : CEREMONY_TEAR_FLIP_SINGLE;
  }
  if (phase === 'cards-on-table') {
    return CEREMONY_CARDS_ON_TABLE;
  }
  return CEREMONY_COPY_V9[phase];
}

export function getCeremonyRarityLabel(rarity: CeremonyRarity) {
  return CEREMONY_COPY.rarity[rarity];
}
