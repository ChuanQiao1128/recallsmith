export const LIBRARY_SNAPSHOT = {
  poolId: 'csharp',
  title: 'C# Interview',
  ownedCount: 115,
  dueCount: 6,
  masteredCount: 24,
  cards: [
    { id: 'card-1', keyword: 'Dependency Injection', rarity: 'RAR', tag: 'oop', mastery: 'learning' },
    { id: 'card-2', keyword: 'Middleware order', rarity: 'LEG', tag: 'aspnet-core', mastery: 'mastered' },
    { id: 'card-3', keyword: 'ConfigureAwait', rarity: 'RAR', tag: 'async-await', mastery: 'new' },
  ],
};

export const FILTER_META = {
  rarity: ['COM', 'RAR', 'LEG'],
  tags: ['oop', 'aspnet-core', 'async-await', 'testing'],
  mastery: ['new', 'learning', 'mastered'],
  audience: ['junior', 'both', 'all'],
};

export const TAG_BREAKDOWN = [
  { tag: 'oop', owned: 14, total: 20 },
  { tag: 'aspnet-core', owned: 12, total: 18 },
  { tag: 'async-await', owned: 9, total: 14 },
  { tag: 'testing', owned: 7, total: 12 },
];
