// The user-facing FAQ shown on the Help tab. Every fact here is pulled
// from the shipping economy, not the design deck: 1 pull per new card
// learned (first Hard+ rating, R1) and 1 pull a day for clearing today's
// due cards (R2), both settled in sessionRewards.ts, 3 starter pulls (rewardWallet.ts),
// the 1-pull daily floor (economyFloor.ts), pity after 10 Commons
// (pity.ts), uniform-no-duplicate draws, light-only UI (app.json), iOS
// only. Wording follows home-review-and-launch-copy §2.9 version A and
// stays inside its red lines.

export type FaqEntry = { q: string; a: string };

export const FAQ_LIST: readonly FaqEntry[] = [
  {
    q: 'How do I earn pulls?',
    a: "Every new card you learn earns 1 pull the first time you rate it Hard or better, and clearing all of today's due cards earns 1 more, once a day. New accounts start with 3 starter pulls, and if you have no cards left to study and no pulls, a 1-pull daily floor keeps you going. Pulls are never sold.",
  },
  {
    q: 'Why is Draw locked?',
    a: "Draw locks when you have no pulls to spend. Learn a new card to earn one, or wait for the daily floor pull if you have nothing left to study.",
  },
  {
    q: 'What is pity?',
    a: "After 10 Commons in a row, your next pull is Rare or better, as long as the pack still has a Rare or Legendary you don't own. Every other draw is a uniform random pick from the cards you're still missing, so there are no duplicates.",
  },
  {
    q: 'Why is a card locked in the Library?',
    a: "You study the cards you've drawn. A locked card is one you haven't pulled yet; anything you already studied stays open.",
  },
  {
    q: 'Does it work offline?',
    a: 'Yes. Installed decks and your progress live on this phone. Signing in adds cloud backup.',
  },
  {
    q: 'Is there an Android version?',
    a: "iOS only right now. There's no Android date yet, and I'd rather not promise one until I can keep it.",
  },
  {
    q: 'Is there a dark mode?',
    a: 'Not yet. The app is light-only today.',
  },
  {
    q: 'Are the cards AI-generated?',
    a: "I draft with AI assistance, then rewrite and check every card myself before it ships. I'm one person, so mistakes happen. If you find one, tell me through Support and I'll patch it.",
  },
];
