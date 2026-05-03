import type { MockHomeState, MockPoolOverview } from './types';

export const MOCK_HOME_STATES: Record<MockHomeState, { title: string; helper: string }> = {
  'new-user': {
    title: 'Your first run is ready',
    helper: 'Start with a small daily dose, then let draw and review build the loop.',
  },
  active: {
    title: 'Today\'s route is ready',
    helper: 'Clear one node for momentum or finish the full route for a cleaner close.',
  },
  'clear-day': {
    title: 'You are clear for today',
    helper: 'Use Draw or Library as support loops while pressure is light.',
  },
  'reward-ready': {
    title: 'Reward pulls are waiting',
    helper: 'Spend reward pulls after your study route, not before it.',
  },
  backlog: {
    title: 'Backlog is building',
    helper: 'Take the smaller route or split the catch-up across a few days.',
  },
  dormant: {
    title: 'Welcome back',
    helper: 'We can start with a softer route and bring cards back without pressure.',
  },
  churned: {
    title: 'Fresh start is available',
    helper: 'Reset the schedule, keep the collection, and rebuild rhythm from today.',
  },
  paused: {
    title: 'This pool is paused',
    helper: 'Resume when you want this pool to rejoin the daily route.',
  },
};

export const MOCK_POOLS: MockPoolOverview[] = [
  {
    id: 'csharp',
    title: 'C# Interview',
    ownedCount: 115,
    dueToday: 6,
    masteredCount: 24,
    streakLabel: '🔥 4 · 🔥 Wk 2',
  },
  {
    id: 'aws',
    title: 'AWS SAA',
    ownedCount: 18,
    dueToday: 0,
    masteredCount: 2,
    streakLabel: 'Launches on day 15',
  },
];
