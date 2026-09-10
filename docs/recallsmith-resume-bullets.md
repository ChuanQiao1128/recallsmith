# RecallSmith / DeveloperCards · Resume Project Bullets

| Item | Value |
| --- | --- |
| Target roles | Intermediate Full-stack Engineer; Full-stack + Agent Engineer |
| Last reviewed | 2026-09-11 |
| Current variant | Content Intelligence in production; authoring agent not yet deployed |
| Claim rule | Use past tense only for behaviour that is deployed and supported by retained evidence |

## Current resume version

**RecallSmith / DeveloperCards** — Independent product · React Native/TypeScript, React, C#/.NET, PostgreSQL, AWS · iOS App Store

1. Cut production ingest handler p50 by 49% (37.1 → 18.8 ms) after profiling showed three surrounding PostgreSQL exchanges took 30.6 ms versus 19.9 ms for the six-CTE event insert; collapsed four round trips into one atomic seven-CTE statement.

2. Prevented a pre-release settlement defect that would deduct 10 earned pull credits while returning only four cards, then released v1.5.0 through an App Store phased rollout starting at 1%.

3. Built a production content-intelligence pipeline that triages reviewed card revisions as productively challenging or possibly unclear, comparing rating and dwell-time signals with same-deck baselines at the same declared difficulty and applying absolute repeat-failure thresholds.

4. Used targeted mutations to validate new regression tests across the mobile app, web console and .NET backend, exposing a UI test that stayed green while its asserted value was discarded in the API layer.

## Post-agent replacement

Replace only bullet 3 after the agent is deployed and every capability gate below has passed:

> Extended the production content-intelligence pipeline with a read-and-propose-only agent that prioritises existing cards from behaviour-derived diagnostics; its identity cannot mutate or publish content, and source-version-bound proposals require deterministic validation plus human approval.

The replacement is not valid until all of these are true:

- The agent uses a dedicated identity or proposal-only endpoint.
- Its database role can read cards and insert proposals, but cannot insert, update or delete cards or initiate publication.
- The model has no arbitrary HTTP, SQL, card-mutation or publication tool.
- Every proposal is stored separately and bound to the source card ID, expected version and relevant field hash.
- A human-only apply endpoint re-reads the source, detects stale proposals and atomically applies the accepted change with compare-and-swap protection.
- Integration tests prove the agent identity is denied at the card create, update and publish boundaries, including direct database attempts where applicable.

## Production evidence gate

Keep enough evidence to answer the first follow-up question without reconstructing history during interview preparation.

| Resume claim | Evidence to retain | Accuracy boundary |
| --- | --- | --- |
| 37.1 → 18.8 ms | Production handler timing samples, benchmark method and the 4 → 1 database-exchange evidence | Handler timing produced the latency result; database statement logs and TCP observation established the exchange count |
| Ten pulls for four cards | Pre-fix reproduction, fixing commit and regression test | These were earned pull credits, not money, and the defect was caught before release |
| 1% phased rollout | App Store Connect version/build, start date, phased-release state, monitored stop criteria and final ramp result | `1%` refers to the first phased-release stage, not a hard cap on all devices |
| Content Intelligence | Authenticated production response or console screenshot with timestamp and non-demo deck data | It is heuristic triage, not proof that wording caused poor learning outcomes |
| Mutation checks | The deliberate mutation, the previously surviving test suite and the new regression test that kills it | Do not claim that all tests in the repository were mutation-tested |
| Agent capability boundary | Deployed tool registry, dedicated-role policy, proposal/apply audit trail and negative integration tests | A prompt instruction or missing UI button is not a security boundary |

## Content Intelligence verification

Before retaining the word `production` in bullet 3, inspect the live Content Intelligence page and record:

- reviewed revisions from decks other than `content-intelligence-demo`;
- distinct production learners in the selected window;
- the count with `review_count >= 30`;
- counts for `Possibly Unclear`, `Productive Challenge` and `Needs More Data`;
- the query window, timestamp and deployed build/version.

The interview description should remain explicit about the limit:

> It is a heuristic triage system, not a causal judgement. Revisions below 30 reviews remain Needs More Data; currently X of Y reviewed revisions clear that confidence gate.

## Optional product-metric replacement

If the production usage numbers are substantial and clean, replace bullet 4 with a user-outcome bullet in this shape:

> X unique learners completed Y production reviews across Z cards in the last 90 days.

Use this only after excluding demo decks, test users, synthetic seed data, retries/replays and non-production environments. Do not present a large event count without its unique-learner count. If the learner count is small, retain the mutation-testing bullet.

## CV variant control

- Current variant: the four bullets under **Current resume version**.
- Post-agent variant: the same document with only bullet 3 replaced by **Post-agent replacement**.
- Record the variant and submission date for every application.
- A later resume may truthfully add a newly deployed capability; variants must not disagree about facts that were already fixed at the same submission date.
