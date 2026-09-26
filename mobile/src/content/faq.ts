// The user-facing FAQ shown on the Help tab. Every fact here is pulled
// from the shipping economy, not the design deck. 1.7, owner option A:
// pulls belong to the pack that earned them. 1 pull per new card learned
// (first Hard+ rating, R1) and 1 pull a day for clearing that pack's due
// cards (R2), both settled per pack in sessionRewards.ts; a 3-pull
// first-visit bootstrap the first time you open a pack (deckWallet.ts,
// replacing the old global starter grant); a 1-pull daily floor per
// starved pack (economyFloor.ts); pity after 10 Commons (pity.ts),
// uniform-no-duplicate draws, light-only UI (app.json), iOS only. Wording
// follows home-review-and-launch-copy §2.9 version A and stays inside its
// red lines.

export type FaqEntry = { q: string; a: string };

export const FAQ_LIST: readonly FaqEntry[] = [
  {
    q: 'How do I earn pulls?',
    a: "Pulls belong to the pack that earned them. Every new card you learn earns 1 pull for that pack the first time you rate it Hard or better, and clearing that pack's due cards earns 1 more for it, once a day. The first time you open a pack you have not drawn from, you get 3 free pulls. If a pack has nothing left to study and no pulls, a 1-pull daily floor keeps it going. Pulls are never sold.",
  },
  {
    q: 'Why is Draw locked?',
    a: "Draw locks when the pack you picked has no pulls to spend. Learn one of that pack's cards to earn a pull, or wait for its daily floor pull if it has nothing left to study.",
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
