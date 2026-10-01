# csharp-basics — R23 build report (2026-10-02)

217 cards: 90 Q/A, 127 MCQ (59%); junior 95 (44%), d3 5; code snippets 62 (compile 16, error:CS0304 1, error:CS0834 1, error:CS1061 1, error:CS1612 1, error:CS1996 1, error:CS8345 1, error:CS8418 1, error:CS8917 1, fragment 22, run 16).
Sources: learn.microsoft.com 217.
MCQ whose correct option is the longest: 15/127. Outdated answers used: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].

| TOPIC | cards/budget | Q/A | MCQ | junior | code (question or answer) | dropped in review |
|---|---|---|---|---|---|---|
| 1.1 Types and Memory | 14/14 | 4 | 10 | 9 | 4 | 0 |
| 1.2 OOP and Interfaces | 12/12 | 5 | 7 | 8 | 4 | 0 |
| 1.3 Nullability | 8/8 | 2 | 6 | 5 | 2 | 0 |
| 1.4 Generics, Delegates and Lambdas | 10/10 | 3 | 7 | 4 | 4 | 0 |
| 1.5 Collections | 10/10 | 5 | 5 | 6 | 3 | 0 |
| 1.6 LINQ | 14/14 | 5 | 9 | 7 | 4 | 0 |
| 1.7 Exceptions | 8/8 | 4 | 4 | 5 | 2 | 0 |
| 1.8 Modern C# (10-12) | 12/12 | 2 | 10 | 5 | 3 | 0 |
| 2.1 Async and Task | 16/16 | 6 | 10 | 6 | 4 | 0 |
| 2.2 Concurrency and Thread Safety | 6/6 | 3 | 3 | 1 | 2 | 0 |
| 3.1 GC and IDisposable | 10/10 | 5 | 5 | 5 | 3 | 0 |
| 3.2 BCL: HttpClient, JSON, Time | 11/10 | 5 | 6 | 3 | 3 | 0 |
| 4.1 Hosting, Configuration and Options | 10/10 | 4 | 6 | 4 | 4 | 0 |
| 4.2 Dependency Injection | 12/12 | 6 | 6 | 5 | 3 | 0 |
| 4.3 Middleware Pipeline | 8/8 | 4 | 4 | 3 | 2 | 0 |
| 4.4 Minimal APIs, Controllers, Filters | 12/12 | 5 | 7 | 6 | 3 | 0 |
| 4.5 Auth and CORS | 5/6 | 2 | 3 | 1 | 1 | 1 |
| 5.1 EF Core Querying and Tracking | 14/14 | 6 | 8 | 4 | 4 | 0 |
| 5.2 Transactions and Indexes | 6/6 | 4 | 2 | 2 | 3 | 0 |
| 6.1 Unit and Integration Testing | 11/12 | 4 | 7 | 4 | 2 | 1 |
| 7.1 Design Principles | 8/8 | 6 | 2 | 2 | 2 | 0 |

Checks: all passed

## How it was built

Spec: `docs/csharp-deck-r23-spec-2026-10-02.md` (owner decisions 2026-10-02: .NET 8 / C# 12 baseline with
version-neutral wording, about 218 cards in 21 topics, the 81 old `c-*` cards retired). Every agent ran on the
owner's Claude subscription as a headless `claude -p` call (170 calls); no API key was used.

1. **Sources.** 200+ Microsoft Learn pages were stored as the text a reader sees under the 8.0 view (Learn pages
   carry every version in one HTML; blocks tagged for other versions were removed).
2. **Outline** per topic, then one overlap critic across all 21 outlines.
3. **Draft** per topic, gated by: the repo lint, word and option limits, a .NET 9+ API deny-list, a verbatim
   quote check against the stored 8.0 text, every code snippet compiled or run on the .NET 8.0.413 SDK
   (run / compile / expected compiler error / fragment with a hidden harness), and near-duplicate detection.
4. **Two independent reviewers** per topic: one checks support and correctness, one tries to refute every card.
   Up to two repair rounds, each re-reviewed by both. A card that still fails is dropped.
5. **Assembly**: topic order 1.1 → 7.1, d1 Q/A first, so the first five cards (R22 starter lesson) are
   friendly Q/A. Two cards were added afterwards for outdated answers #14 and #15, through the same gate and
   both reviewers.
6. **Spot check** by the supervisor (below).

Dropped in review (could not be repaired to pass both reviewers): asp-auth-06 (topic 45), net-test-07 (topic 61).

## Supervisor spot check

Sample: 2 cards per TOPIC (42 of 217), drawn with random.Random(23) from the assembled deck.
Each card read in full: claim correct for .NET 8 / C# 12, quote supports the key claim, MCQ key and every WHY, code output/compile behaviour, interview value.

| uid | verdict | note |
|---|---|---|
| net-types-05 | correct |  |
| net-types-13 | correct |  |
| net-oop-01 | correct |  |
| net-oop-02 | correct |  |
| net-null-04 | correct |  |
| net-null-05 | correct |  |
| net-generics-07 | correct |  |
| net-generics-09 | correct |  |
| net-coll-03 | correct |  |
| net-coll-06 | correct |  |
| net-linq-04 | correct |  |
| net-linq-12 | correct |  |
| net-exc-04 | correct |  |
| net-exc-05 | correct |  |
| net-modern-01 | correct |  |
| net-modern-04 | correct |  |
| net-async-15 | correct |  |
| net-async-16 | correct |  |
| net-conc-01 | correct |  |
| net-conc-06 | correct | correct for .NET 8; the quoted Learn sentence says 'If you're using an older version of .NET' because .NET 9 added System.Threading.Lock, which is accurate context |
| net-gc-02 | correct |  |
| net-gc-08 | correct |  |
| net-bcl-01 | correct |  |
| net-bcl-07 | correct |  |
| asp-host-07 | correct |  |
| asp-host-09 | correct |  |
| asp-di-01 | correct |  |
| asp-di-06 | correct |  |
| asp-mw-04 | correct |  |
| asp-mw-07 | correct | .NET 8 IExceptionHandler fallback with AddProblemDetails verified against the 8.0 error-handling page |
| asp-api-01 | correct |  |
| asp-api-10 | correct |  |
| asp-auth-02 | correct | explicit UseAuthorization/UseAuthentication calls disable WebApplication's auto-added auth middleware, so the order bug is real |
| asp-auth-03 | correct |  |
| ef-query-04 | correct |  |
| ef-query-10 | correct |  |
| ef-tx-03 | correct |  |
| ef-tx-04 | correct |  |
| net-test-06 | correct |  |
| net-test-11 | correct |  |
| net-design-06 | correct |  |
| net-design-07 | correct |  |

Result: 42/42 correct; error rate 0% in every TOPIC (threshold 5%). No topic re-run.

## MCQ conversion (owner decision, 2026-10-02)

The owner asked to lean further toward multiple choice. Each of the 130 Q/A cards was assessed: a classifier
proposed 110 conversions and an independent skeptic upheld 40. The other 70 would have become giveaway or
strawman MCQs (explain-why, trade-off and multi-part answers stay Q/A: in an interview they must be said out loud).
The 40 were converted in place (same uid, so learner progress is kept), passed the gate (lint, verbatim quote,
.NET 8 snippets), and both reviewers (support, refute) with up to two repair rounds; none had to be reverted.
Result: 90 Q/A + 127 MCQ (59 percent). The first five cards of the file are d1 Q/A so the R22 starter lesson
still teaches before it tests.

Supervisor spot check of the conversions (10 of 40, random.Random(59)): asp-api-07, asp-api-09, asp-host-02, ef-query-05, net-async-08, net-bcl-02, net-generics-02, net-null-02, net-oop-02, net-types-01: 10/10 correct.
