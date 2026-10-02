/**
 * Exam domains per deck (R24 contract §1.1).
 *
 * A domain groups a deck's TOPIC labels (content/decks/FORMAT.md §5) under the exam's own outline. `match`
 * receives the topic already normalised by library/topics.ts (trimmed, never empty) and compares it
 * byte-for-byte by prefix, so the labels must stay exactly as FORMAT.md spells them.
 *
 * `examWeight` is the exam's published share of the domain ("30%"), an exam fact rather than a learner
 * number; the screen shows it as "30% of the exam". Decks without published weights leave it out.
 */
export type DomainDef = {
  key: string;
  title: string;
  examWeight?: string;
  match: (topic: string) => boolean;
};

function startsWithAny(...prefixes: string[]): (topic: string) => boolean {
  return (topic) => prefixes.some((prefix) => topic.startsWith(prefix));
}

/** SAA-C03 exam guide: task statements `n.x` plus the `Dn services` cards of the same domain. */
function awsDomain(n: number, title: string, examWeight: string): DomainDef {
  return { key: `d${n}`, title, examWeight, match: startsWithAny(`${n}.`, `D${n} services`) };
}

/** CCDV-F: one label per domain, `Dn <title>`; weights from docs/ccdv-f-deck-plan-2026-09-21.md:29-36. */
function ccdvfDomain(n: number, title: string, examWeight: string): DomainDef {
  return { key: `d${n}`, title, examWeight, match: startsWithAny(`D${n} `) };
}

/** .NET interview deck: area `n` holds the `n.x` topics. No exam, so no weights. */
function csharpArea(n: number, title: string): DomainDef {
  return { key: `c${n}`, title, match: startsWithAny(`${n}.`) };
}

export const DOMAINS: Record<string, DomainDef[]> = {
  'aws-saa-c03': [
    awsDomain(1, 'Design Secure Architectures', '30%'),
    awsDomain(2, 'Design Resilient Architectures', '26%'),
    awsDomain(3, 'Design High-Performing Architectures', '24%'),
    awsDomain(4, 'Design Cost-Optimized Architectures', '20%'),
  ],
  'claude-ccdv-f': [
    ccdvfDomain(1, 'Agents & workflows', '14.7%'),
    ccdvfDomain(2, 'Applications & integration', '33.1%'),
    ccdvfDomain(3, 'Claude Code', '3.1%'),
    ccdvfDomain(4, 'Eval, testing & debugging', '2.6%'),
    ccdvfDomain(5, 'Model selection & optimization', '16.8%'),
    ccdvfDomain(6, 'Prompt & context engineering', '11.0%'),
    ccdvfDomain(7, 'Security & safety', '8.1%'),
    ccdvfDomain(8, 'Tools & MCP', '10.6%'),
  ],
  'csharp-basics': [
    csharpArea(1, 'C# language'),
    csharpArea(2, 'Async and concurrency'),
    csharpArea(3, 'Runtime and libraries'),
    csharpArea(4, 'ASP.NET Core'),
    csharpArea(5, 'EF Core'),
    csharpArea(6, 'Testing'),
    csharpArea(7, 'Design'),
  ],
};

/** The deck's domains in exam order; an unknown deck has none and groups by topic only. */
export function domainsForDeck(slug: string): DomainDef[] {
  return Object.prototype.hasOwnProperty.call(DOMAINS, slug) ? DOMAINS[slug] : [];
}
