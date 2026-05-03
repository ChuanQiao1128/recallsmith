export const MILESTONE_HALL = [
  {
    poolId: 'csharp',
    poolTitle: 'C# Interview',
    badges: [
      { id: 'bronze-collect', title: 'Bronze Collect', unlockedAt: '2026-04-12' },
      { id: 'silver-collect', title: 'Silver Collect', unlockedAt: null },
      { id: 'junior-master', title: 'Junior Master', unlockedAt: '2026-04-18' },
      { id: 'journey-master', title: 'Journey Master', unlockedAt: null },
    ],
  },
];

export const MILESTONE_DETAIL = {
  id: 'bronze-collect',
  title: 'Bronze Collect',
  body: 'Unlock when collection progress reaches the first threshold in a pool.',
  reward: '+3 free pulls',
};

export const MILESTONE_DETAILS_BY_ID = {
  'bronze-collect': {
    id: 'bronze-collect',
    title: 'Bronze Collect',
    body: 'Unlock when collection progress reaches the first threshold in a pool.',
    reward: '+3 free pulls',
  },
  'silver-collect': {
    id: 'silver-collect',
    title: 'Silver Collect',
    body: 'Unlock when collection progress moves beyond the starter shelf and into a meaningful owned-card base.',
    reward: '+5 free pulls',
  },
  'junior-master': {
    id: 'junior-master',
    title: 'Junior Master',
    body: 'Unlock when the first mastery threshold is reached and a real chunk of the pool is no longer fragile recall.',
    reward: 'Hall badge + route prestige',
  },
  'journey-master': {
    id: 'journey-master',
    title: 'Journey Master',
    body: 'Unlock when mastery is stable enough that the pool starts to feel conquered instead of merely reviewed.',
    reward: '+1 premium draw token preview',
  },
} as const;

export const STREAK_MILESTONES = {
  daily: [7, 30, 100],
  weekly: [4, 13, 52],
};
