// The user-facing FAQ shown on the Help tab. Every answer states what the
// shipping app does (R24B contract §4), in the plain words of §1: draws belong
// to the pack that earned them (deckWallet.ts), 1 per new card learned and 1 a
// day for clearing that pack's due cards (sessionRewards.ts), 5 the first time
// a pack is opened and 5 at the end of the starter lesson (DECK_BOOTSTRAP_GRANT),
// 60 saved + 5 waiting per pack, a 1-draw daily floor per starved pack
// (economyFloor.ts), the rare guarantee after 10 Commons (draw/), opening up to
// 5 cards at once (drawBatch.ts), no repeat draws, iOS only. No score,
// no claim of an offline first run without the bundled starter cards, and no
// claim that the developer personally checks or spot-checks cards.
//
// 2026-10-14 three decks: the decks are named in the app's order (AWS
// fundamentals, SAA-C03, Claude; content/hiddenDecks.ts) and the hidden C# deck
// is not mentioned. Only SAA-C03 and Claude ship starter cards
// (content/starter), so the offline answer names those two. No card counts:
// they change with every deck build.

export type FaqEntry = { q: string; a: string };

export const FAQ_LIST: readonly FaqEntry[] = [
  {
    q: 'How do I earn draws?',
    a: "Learn a new card to earn a draw for its pack: the first time you finish it, by tapping Got it on a new card or answering Remembered, Hard, Good or Easy, or by getting a multiple-choice card right. Clearing all of that pack's due cards adds one more, once a day. Every pack gets 5 draws the first time you open it, and your first lesson ends with 5 draws for its pack. A pack saves up to 60 draws, plus 5 extra draws waiting. Draws are never sold.",
  },
  {
    q: 'Why is Draw locked?',
    a: "Draw locks when the pack you picked has no draws to spend. Learn one of that pack's cards to earn a draw. If the pack has nothing left to study and no draws, it gets 1 free draw a day.",
  },
  {
    q: 'When is a rare card guaranteed?',
    a: "After 10 Commons in a row, the next card is Rare or better, so a rare card is guaranteed within 11 cards while the pack still has a Rare or Legendary you don't own. There are no repeat draws: a card you have drawn never comes up again. Open up to 5 cards at once, or just 1: you only spend draws for the cards you receive.",
  },
  {
    q: 'What do I study?',
    a: 'Three free decks: AWS Architect Basics (the basics behind SAA-C03, in English with a built-in Chinese translation), AWS Associate Architect (SAA-C03, in English) and Claude Developer Foundations (CCDV-F across 8 domains, in English). Multiple-choice cards in the SAA-C03 deck explain every wrong option. Reviews are scheduled with FSRS, the open-source spaced-repetition algorithm, never more than 90 days out, and a card is Mastered once its next review is 15 or more days away. The app is iOS only.',
  },
  {
    q: 'Why is a card locked in the Library?',
    a: "You study the cards in your collection. A locked card is one you haven't drawn yet; anything you already studied stays open.",
  },
  {
    q: 'Does it work offline? Do I need an account?',
    a: 'The first cards of the SAA-C03 and Claude decks are in the app, so a first lesson on either works offline; AWS Architect Basics downloads the first time your phone is online. The full deck downloads when your phone is online, and after that you can study offline. An account is optional: signing in adds cloud backup, Report a card and the Premium subscription. Premium is for future premium decks; there is nothing premium to unlock yet.',
  },
  {
    q: 'How are the cards made?',
    a: 'Cards are drafted with AI assistance from official documentation and checked by automated checks and AI review passes. If a card looks wrong, sign in and use Report a problem. The sources are AWS and Anthropic documentation, and you can also tell me through Support.',
  },
];

// R24B contract §2: shown as the Help screen's footer (and in the App Store
// description).
export const FAQ_DISCLAIMER: readonly [string, string] = [
  'Not official exam material and not an exam simulator.',
  'AWS is a trademark of Amazon.com, Inc. Claude and Anthropic are trademarks of Anthropic, PBC. DeveloperCards is not affiliated with, sponsored by, or endorsed by Amazon or Anthropic.',
];
