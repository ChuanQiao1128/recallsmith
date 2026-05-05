import type { MockDrawCard } from '../features/gacha/draw/pity';
import { buildMockDrawResult } from '../features/gacha/draw/pity';

export const POOL_ODDS = {
  csharp: { com: 0.7, rar: 0.27, leg: 0.03 },
  aws: { com: 0.7, rar: 0.27, leg: 0.03 },
} as const;

const CSHARP_POOL: MockDrawCard[] = [
  {
    stableUid: 'draw-1',
    question: 'What problem does dependency injection solve?',
    difficulty: 2,
    rarity: 'RAR',
    tag: 'Architecture',
  },
  {
    stableUid: 'draw-2',
    question: 'How does ASP.NET Core middleware ordering affect requests?',
    difficulty: 3,
    rarity: 'LEG',
    tag: 'ASP.NET Core',
  },
  {
    stableUid: 'draw-3',
    question: 'When should you prefer IQueryable over IEnumerable?',
    difficulty: 2,
    rarity: 'RAR',
    tag: 'LINQ',
  },
  {
    stableUid: 'dose-2',
    question: 'What does ConfigureAwait(false) change?',
    difficulty: 2,
    rarity: 'COM',
    tag: 'Async / await',
  },
  {
    stableUid: 'dose-3',
    question: 'Why can DbContext lifetime cause hidden production bugs?',
    difficulty: 3,
    rarity: 'LEG',
    tag: 'EF Core',
  },
];

const AWS_POOL: MockDrawCard[] = [
  {
    stableUid: 'draw-aws-1',
    question: 'When should you choose SQS over SNS?',
    difficulty: 2,
    rarity: 'RAR',
    tag: 'AWS Messaging',
  },
  {
    stableUid: 'draw-aws-2',
    question: 'Why does IAM explicit deny override allow?',
    difficulty: 3,
    rarity: 'LEG',
    tag: 'AWS IAM',
  },
  {
    stableUid: 'draw-aws-3',
    question: 'What problem does Auto Scaling solve for burst traffic?',
    difficulty: 1,
    rarity: 'COM',
    tag: 'AWS Compute',
  },
];

export const MOCK_DRAW_RESULTS = buildMockDrawResult({
  poolId: 'csharp',
  odds: POOL_ODDS.csharp,
  sourceCards: CSHARP_POOL,
  pityBefore: 8,
});

/** @deprecated use commitDraw from features/gacha/draw */
export function buildPoolDrawResult(poolId: string, pityBefore: number = 0, drawCount: number = 10) {
  const normalized = poolId === 'aws' ? 'aws' : 'csharp';
  return buildMockDrawResult({
    poolId: normalized,
    odds: POOL_ODDS[normalized],
    sourceCards: normalized === 'aws' ? AWS_POOL : CSHARP_POOL,
    pityBefore,
    drawCount,
  });
}
