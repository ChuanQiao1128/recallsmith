# D01 — Exam domain definitions and per-domain progress counts (#630)

Contract: `R24-00-contracts.md` §1.1–§1.2. Pure modules only; no screen (that is D02).

## What changed

- `mobile/src/features/domains/examDomains.ts` (new) — `DomainDef { key, title, examWeight?, match }`,
  `DOMAINS: Record<deckSlug, DomainDef[]>`, `domainsForDeck(slug)` (unknown deck → `[]`).
- `mobile/src/features/domains/domainProgress.ts` (new) — `computeDomainProgress(...)`, type
  `DomainProgress`, constants `OTHER_DOMAIN_KEY = 'other'`, `OTHER_DOMAIN_TITLE = 'Other'`.
- `mobile/tests/unit/domainProgress.test.ts` (new) — 13 tests.

## Surface

```ts
computeDomainProgress(
  slug: string,
  cards: readonly CardExport[],
  progress: readonly CardProgress[],
  owned: OwnedGate,                       // Set<string> | null; null = no gate, every card collected
  activeMistakes: readonly MistakeEntry[], // output of activeMistakes(); other decks ignored, one per card
  now: Date = new Date(),                 // for isDue
): DomainProgress[]
// DomainProgress = { key, title, examWeight: string | null, total, collected, learned, mastered,
//                    dueNow, mistakes, uids }  (uids in OrderInDeck order)
```

Domains:

| deck | key | title | examWeight | matches (prefix of the normalised topic) |
|---|---|---|---|---|
| aws-saa-c03 | d1..d4 | Design Secure / Resilient / High-Performing / Cost-Optimized Architectures | 30% / 26% / 24% / 20% | `n.` and `Dn services` |
| claude-ccdv-f | d1..d8 | label text after `Dn ` (FORMAT.md §5.2) | 14.7 / 33.1 / 3.1 / 2.6 / 16.8 / 11.0 / 8.1 / 10.6 % (`docs/ccdv-f-deck-plan-2026-09-21.md:29-36`) | `Dn ` |
| csharp-basics | c1..c7 | C# language, Async and concurrency, Runtime and libraries, ASP.NET Core, EF Core, Testing, Design | none | `n.` |

Ordering: exam domains in exam order (only those with ≥ 1 card), then each unmatched topic as its own group
(key `topic:<topicKey>`, title = the label, sorted with `compareTopicLabels`), then `Other` (untagged cards).
Counts reuse `isLearnedProgress`, `isMasteredProgress` (progressSelectors) and `isDue` (review/model);
topics go through `normalizeTopic` (library/topics.ts).

## Tests

- `cd mobile && npx tsc --noEmit && npx vitest run tests/unit/domainProgress.test.ts` — every FORMAT.md §5
  label of all three decks (AWS `D2 services` → d2, CCDV-F D1..D8, csharp 1.x..7.x), prefix look-alikes
  (`10.1`, `D10`, `D5 services`, case), counts, null gate, mistake dedupe/deck filter, unmatched/untagged
  grouping, ordering, deck-order uids, empty deck.
- Full mobile unit suite run as a regression gate.

## Owner steps

None.

## Deferred / notes for D02

- `examWeight` holds the bare share (`"30%"`); D02 renders it as "30% of the exam" (contract §1.1).
- Exam domains with no cards are omitted rather than shown as "0 of 0".
- learned/mastered/due are not gated by `owned` (the effective owned set already grandfathers every studied
  card); only `collected` uses the gate.
