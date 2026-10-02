// The user-facing FAQ shown on the Help tab. Every answer states what the
// shipping app does (R24B contract §4), in the plain words of §1: draws belong
// to the pack that earned them (deckWallet.ts), 1 per new card learned and 1 a
// day for clearing that pack's due cards (sessionRewards.ts), 3 the first time
// a pack is opened and 3 at the end of the starter lesson, 60 saved + 5 waiting
// per pack, a 1-draw daily floor per starved pack (economyFloor.ts), the rare
// guarantee after 10 Commons (draw/), no duplicates, iOS only. No score,
// no claim of an offline first run without the bundled starter cards, and no
// claim that the developer personally checks every card.

export type FaqEntry = { q: string; a: string };

export const FAQ_LIST: readonly FaqEntry[] = [
  {
    q: 'How do I earn draws?',
    a: "Learn a new card to earn a draw for its pack: the first time you answer Remembered, Hard, Good or Easy, or get a multiple-choice card right. Clearing all of that pack's due cards adds one more, once a day. Every pack gets 3 draws the first time you open it, and your first lesson ends with 3 draws for its pack. A pack saves up to 60 draws, plus 5 extra draws waiting. Draws are never sold.",
  },
  {
    q: 'Why is Draw locked?',
    a: "Draw locks when the pack you picked has no draws to spend. Learn one of that pack's cards to earn a draw. If the pack has nothing left to study and no draws, it gets 1 free draw a day.",
  },
  {
    q: 'When is a rare card guaranteed?',
    a: "After 10 Commons in a row, the next card is Rare or better, so a rare card is guaranteed within 11 cards while the pack still has a Rare or Legendary you don't own. Every card is drawn from the cards you're still missing, so you never get a duplicate. Open 1 or Open 10: you only spend draws for the cards you receive.",
  },
  {
    q: 'What do I study?',
    a: 'Three free decks, in English: .NET & C# Interview (217 cards for .NET 8 and C# 12, junior to mid, each quoting Microsoft Learn), AWS Associate Architect (371 cards for SAA-C03) and Claude Developer Foundations (441 cards for CCDV-F across 8 domains). Multiple-choice cards in the .NET and AWS decks explain every wrong option. Reviews are scheduled with FSRS, the open-source spaced-repetition algorithm, never more than 90 days out, and a card is Mastered once its next review is 15 or more days away. The app is iOS only.',
  },
  {
    q: 'Why is a card locked in the Library?',
    a: "You study the cards in your collection. A locked card is one you haven't drawn yet; anything you already studied stays open.",
  },
  {
    q: 'Does it work offline? Do I need an account?',
    a: 'The first cards of each deck are in the app, so your first lesson works offline. The full deck downloads when your phone is online, and after that you can study offline. An account is optional: signing in adds cloud backup, Report a card and the Premium subscription. Premium is for future premium decks; there is nothing premium to unlock yet.',
  },
  {
    q: 'How are the cards made?',
    a: 'Cards are drafted with AI assistance from official documentation (AWS, Anthropic and Microsoft Learn), then checked by automated checks and AI review passes, and spot-checked by the developer. Mistakes still happen: if a card looks wrong, use Report a card on it or tell me through Support.',
  },
];

// R24B contract §2: shown as the Help screen's footer (and in the App Store
// description).
export const FAQ_DISCLAIMER: readonly [string, string] = [
  'Not official exam material and not an exam simulator.',
  'AWS is a trademark of Amazon.com, Inc. Claude and Anthropic are trademarks of Anthropic, PBC. .NET and C# are trademarks of Microsoft Corporation. DeveloperCards is not affiliated with, sponsored by, or endorsed by Amazon, Anthropic or Microsoft.',
];
