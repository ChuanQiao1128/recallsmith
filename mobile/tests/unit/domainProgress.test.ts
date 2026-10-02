import { describe, expect, it } from 'vitest';
import type { CardExport } from '../../src/types/deckExport';
import type { CardProgress } from '../../src/review/model';
import type { MistakeEntry } from '../../src/features/gacha/mistakes/mistakeBook';
import { DOMAINS, domainsForDeck } from '../../src/features/domains/examDomains';
import { computeDomainProgress, OTHER_DOMAIN_KEY, OTHER_DOMAIN_TITLE } from '../../src/features/domains/domainProgress';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const DAY = 86_400_000;

let order = 0;
function card(uid: string, topic: string | null | undefined): CardExport {
  order += 10;
  return { StableUid: uid, Question: `Q ${uid}`, Difficulty: 1, OrderInDeck: order, Topic: topic };
}

/** Learned, not due, below mastery. */
function learned(uid: string): CardProgress {
  return { stableUid: uid, stage: 1, lastReviewedAt: NOW.getTime() - DAY, nextReviewAt: NOW.getTime() + DAY };
}
function mastered(uid: string): CardProgress {
  return { stableUid: uid, stage: 5, lastReviewedAt: NOW.getTime() - DAY, nextReviewAt: NOW.getTime() + 10 * DAY };
}
function due(uid: string): CardProgress {
  return { stableUid: uid, stage: 2, lastReviewedAt: NOW.getTime() - 5 * DAY, nextReviewAt: NOW.getTime() - 1000 };
}
function unlearned(uid: string): CardProgress {
  return { stableUid: uid, stage: 0, nextReviewAt: 0 };
}
function mistake(deckSlug: string, uid: string): MistakeEntry {
  return {
    deckSlug,
    stableUid: uid,
    topic: null,
    wrongCount: 1,
    firstWrongAt: NOW.getTime() - DAY,
    lastWrongAt: NOW.getTime() - DAY,
    lastOutcome: 'again',
    correctStreak: 0,
    resolvedAt: null,
  };
}

// Labels copied byte-for-byte from content/decks/FORMAT.md §5.
const AWS_LABELS = [
  '1.1 Secure access',
  '1.2 Secure workloads',
  '1.3 Data security controls',
  '2.1 Loosely coupled architectures',
  '2.2 HA and fault tolerance',
  '3.1 High-performing storage',
  '3.2 Elastic compute',
  '3.3 High-performing databases',
  '3.4 Scalable network',
  '3.5 Data ingestion and transformation',
  '4.1 Cost-optimized storage',
  '4.2 Cost-optimized compute',
  '4.3 Cost-optimized database',
  '4.4 Cost-optimized network',
  'D1 services',
  'D2 services',
  'D3 services',
  'D4 services',
];
const CCDVF_LABELS = [
  'D1 Agents & workflows',
  'D2 Applications & integration',
  'D3 Claude Code',
  'D4 Eval, testing & debugging',
  'D5 Model selection & optimization',
  'D6 Prompt & context engineering',
  'D7 Security & safety',
  'D8 Tools & MCP',
];
const CSHARP_LABELS = [
  '1.1 Types and Memory',
  '1.2 OOP and Interfaces',
  '1.3 Nullability',
  '1.4 Generics, Delegates and Lambdas',
  '1.5 Collections',
  '1.6 LINQ',
  '1.7 Exceptions',
  '1.8 Modern C# (10-12)',
  '2.1 Async and Task',
  '2.2 Concurrency and Thread Safety',
  '3.1 GC and IDisposable',
  '3.2 BCL: HttpClient, JSON, Time',
  '4.1 Hosting, Configuration and Options',
  '4.2 Dependency Injection',
  '4.3 Middleware Pipeline',
  '4.4 Minimal APIs, Controllers, Filters',
  '4.5 Auth and CORS',
  '5.1 EF Core Querying and Tracking',
  '5.2 Transactions and Indexes',
  '6.1 Unit and Integration Testing',
  '7.1 Design Principles',
];

function domainKeyOf(slug: string, topic: string): string | null {
  return domainsForDeck(slug).find((d) => d.match(topic))?.key ?? null;
}

describe('examDomains', () => {
  it('defines the four SAA-C03 domains with exam weights, in exam order', () => {
    expect(DOMAINS['aws-saa-c03'].map((d) => [d.key, d.title, d.examWeight])).toEqual([
      ['d1', 'Design Secure Architectures', '30%'],
      ['d2', 'Design Resilient Architectures', '26%'],
      ['d3', 'Design High-Performing Architectures', '24%'],
      ['d4', 'Design Cost-Optimized Architectures', '20%'],
    ]);
  });

  it('maps every AWS label to its domain, service cards included', () => {
    const expected: Record<string, string> = {
      '1.1 Secure access': 'd1',
      '1.2 Secure workloads': 'd1',
      '1.3 Data security controls': 'd1',
      '2.1 Loosely coupled architectures': 'd2',
      '2.2 HA and fault tolerance': 'd2',
      '3.1 High-performing storage': 'd3',
      '3.2 Elastic compute': 'd3',
      '3.3 High-performing databases': 'd3',
      '3.4 Scalable network': 'd3',
      '3.5 Data ingestion and transformation': 'd3',
      '4.1 Cost-optimized storage': 'd4',
      '4.2 Cost-optimized compute': 'd4',
      '4.3 Cost-optimized database': 'd4',
      '4.4 Cost-optimized network': 'd4',
      'D1 services': 'd1',
      'D2 services': 'd2',
      'D3 services': 'd3',
      'D4 services': 'd4',
    };
    for (const label of AWS_LABELS) expect([label, domainKeyOf('aws-saa-c03', label)]).toEqual([label, expected[label]]);
  });

  it('defines one CCDV-F domain per D1..D8 label, titled by the text after "Dn ", with the plan weights', () => {
    expect(DOMAINS['claude-ccdv-f'].map((d) => [d.key, d.title, d.examWeight])).toEqual([
      ['d1', 'Agents & workflows', '14.7%'],
      ['d2', 'Applications & integration', '33.1%'],
      ['d3', 'Claude Code', '3.1%'],
      ['d4', 'Eval, testing & debugging', '2.6%'],
      ['d5', 'Model selection & optimization', '16.8%'],
      ['d6', 'Prompt & context engineering', '11.0%'],
      ['d7', 'Security & safety', '8.1%'],
      ['d8', 'Tools & MCP', '10.6%'],
    ]);
    CCDVF_LABELS.forEach((label, i) => expect(domainKeyOf('claude-ccdv-f', label)).toBe(`d${i + 1}`));
  });

  it('maps the csharp 1.x..7.x labels onto seven interview areas without weights', () => {
    expect(DOMAINS['csharp-basics'].map((d) => [d.key, d.title, d.examWeight])).toEqual([
      ['c1', 'C# language', undefined],
      ['c2', 'Async and concurrency', undefined],
      ['c3', 'Runtime and libraries', undefined],
      ['c4', 'ASP.NET Core', undefined],
      ['c5', 'EF Core', undefined],
      ['c6', 'Testing', undefined],
      ['c7', 'Design', undefined],
    ]);
    for (const label of CSHARP_LABELS) {
      expect([label, domainKeyOf('csharp-basics', label)]).toEqual([label, `c${label[0]}`]);
    }
  });

  it('matches by prefix only, so neighbours and look-alikes do not leak across domains', () => {
    expect(domainKeyOf('aws-saa-c03', '10.1 Something')).toBeNull();
    expect(domainKeyOf('aws-saa-c03', 'D5 services')).toBeNull();
    expect(domainKeyOf('aws-saa-c03', 'IAM')).toBeNull();
    expect(domainKeyOf('claude-ccdv-f', 'D10 Extra')).toBeNull();
    expect(domainKeyOf('claude-ccdv-f', 'd1 agents & workflows')).toBeNull();
    expect(domainKeyOf('csharp-basics', '8.1 Career')).toBeNull();
  });

  it('has no domains for an unknown deck', () => {
    expect(domainsForDeck('some-other-deck')).toEqual([]);
  });
});

describe('computeDomainProgress', () => {
  it('counts total, collected, learned, mastered, due and mistakes per AWS domain', () => {
    const cards = [
      card('a1', '1.1 Secure access'),
      card('a2', 'D1 services'),
      card('b1', '2.2 HA and fault tolerance'),
      card('b2', 'D2 services'),
      card('b3', '  D2 services  '),
      card('c1', '3.3 High-performing databases'),
      card('d1', '4.4 Cost-optimized network'),
    ];
    const progress = [learned('a1'), mastered('a2'), due('b1'), mastered('b2'), unlearned('b3'), due('d1')];
    const owned = new Set(['a1', 'a2', 'b1', 'b2', 'c1']);
    const mistakes = [mistake('aws-saa-c03', 'b1'), mistake('aws-saa-c03', 'b2'), mistake('other-deck', 'a1')];

    const out = computeDomainProgress('aws-saa-c03', cards, progress, owned, mistakes, NOW);

    expect(out.map((d) => d.key)).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(out[0]).toEqual({
      key: 'd1',
      title: 'Design Secure Architectures',
      examWeight: '30%',
      total: 2,
      collected: 2,
      learned: 2,
      mastered: 1,
      dueNow: 0,
      mistakes: 0,
      uids: ['a1', 'a2'],
    });
    expect(out[1]).toMatchObject({
      key: 'd2',
      total: 3,
      collected: 2,
      learned: 2,
      mastered: 1,
      dueNow: 1,
      mistakes: 2,
      uids: ['b1', 'b2', 'b3'],
    });
    expect(out[2]).toMatchObject({ key: 'd3', total: 1, collected: 1, learned: 0, mastered: 0, dueNow: 0, mistakes: 0 });
    expect(out[3]).toMatchObject({ key: 'd4', total: 1, collected: 0, learned: 1, dueNow: 1, examWeight: '20%' });
  });

  it('treats a null owned gate as everything collected', () => {
    const cards = [card('x1', 'D3 Claude Code'), card('x2', 'D3 Claude Code')];
    const out = computeDomainProgress('claude-ccdv-f', cards, [], null, [], NOW);
    expect(out).toEqual([
      expect.objectContaining({ key: 'd3', title: 'Claude Code', examWeight: '3.1%', total: 2, collected: 2, learned: 0 }),
    ]);
  });

  it('orders exam domains first, then unmatched topics by label, then Other last', () => {
    const cards = [
      card('u1', null),
      card('t10', '10.2 Later topic'),
      card('d8', 'D8 Tools & MCP'),
      card('t2', '2.1 Extra'),
      card('u2', '   '),
      card('d1', 'D1 Agents & workflows'),
      card('u3', undefined),
      card('t10b', '10.2 Later topic'),
    ];
    const out = computeDomainProgress('claude-ccdv-f', cards, [learned('u1'), learned('t10b')], null, [], NOW);
    expect(out.map((d) => [d.key, d.title, d.examWeight, d.total])).toEqual([
      ['d1', 'Agents & workflows', '14.7%', 1],
      ['d8', 'Tools & MCP', '10.6%', 1],
      ['topic:2-1-extra', '2.1 Extra', null, 1],
      ['topic:10-2-later-topic', '10.2 Later topic', null, 2],
      [OTHER_DOMAIN_KEY, OTHER_DOMAIN_TITLE, null, 3],
    ]);
    expect(OTHER_DOMAIN_TITLE).toBe('Other');
    expect(out[3]).toMatchObject({ learned: 1, uids: ['t10', 't10b'] });
    expect(out[4]).toMatchObject({ learned: 1, uids: ['u1', 'u2', 'u3'] });
  });

  it('groups every card of an unknown deck by its own topic', () => {
    const cards = [card('k1', 'Kubernetes'), card('k2', 'Docker'), card('k3', 'Kubernetes'), card('k4', null)];
    const out = computeDomainProgress('some-other-deck', cards, [mastered('k3')], new Set(['k1']), [], NOW);
    expect(out.map((d) => [d.title, d.total, d.collected, d.mastered])).toEqual([
      ['Docker', 1, 0, 0],
      ['Kubernetes', 2, 1, 1],
      ['Other', 1, 0, 0],
    ]);
  });

  it('omits exam domains with no cards and keeps uids in deck order', () => {
    const cards = [
      { ...card('late', '7.1 Design Principles'), OrderInDeck: 900 },
      { ...card('early', '7.1 Design Principles'), OrderInDeck: 1 },
      card('lang', '1.6 LINQ'),
    ];
    const out = computeDomainProgress('csharp-basics', cards, [], null, [], NOW);
    expect(out.map((d) => [d.key, d.title, d.examWeight, d.uids])).toEqual([
      ['c1', 'C# language', null, ['lang']],
      ['c7', 'Design', null, ['early', 'late']],
    ]);
  });

  it('counts a mistake once per card and only for this deck', () => {
    const cards = [card('m1', '5.1 EF Core Querying and Tracking'), card('m2', '5.2 Transactions and Indexes')];
    const mistakes = [
      mistake('csharp-basics', 'm1'),
      mistake('csharp-basics', 'm1'),
      mistake('aws-saa-c03', 'm2'),
      mistake('csharp-basics', 'gone'),
    ];
    const out = computeDomainProgress('csharp-basics', cards, [], null, mistakes, NOW);
    expect(out).toEqual([expect.objectContaining({ key: 'c5', total: 2, mistakes: 1 })]);
  });

  it('returns an empty list for an empty deck', () => {
    expect(computeDomainProgress('aws-saa-c03', [], [], null, [], NOW)).toEqual([]);
  });
});
