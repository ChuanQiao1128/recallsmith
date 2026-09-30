# M06 notes: Content Intelligence live scores exclude focus-run practice events

## Change

- `src_C/Vpc/Authoring/ContentIntelligence.cs:173`: the `event_scored` CTE's WHERE gains one line,
  `and coalesce(e.review_stage, '') <> 'focus_practice'`. It sits right after `and e.rating is not null`
  and right before `{mcqFilter}`. It is written in the raw-string template, not in the `mcqFilter` string, so both
  the MCQ-filter variant (`BuildLiveSql(true)`) and the migration-018 fallback (`BuildLiveSql(false)`) carry it.
  Every later CTE reads only `event_scored`, so practice events leave every output metric.
- Why `coalesce`: `e.review_stage <> 'focus_practice'` evaluates to NULL when the stage is NULL, and WHERE
  drops NULL rows. That form would silently remove every event from pre-Z07 clients, which send no stage.
  `coalesce(e.review_stage, '')` maps NULL to the empty string, so those events stay.
- The only other edit is one `///` doc-comment sentence above `BuildLiveSql`. No other SQL line, column,
  parameter, snapshot query or response field changed.

## Red-before-green

New class `ContentIntelligenceFocusPracticeTests`, run with
`dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter FullyQualifiedName~ContentIntelligenceFocusPracticeTests`.

On the unmodified `ContentIntelligence.cs`:

- `PracticeEvents_LeaveEveryCardMetricUnchanged`: FAILED,
  `deck A card 1: reviewCount 16, expected 9 real reviews (practice events counted?)`.
- `CardWithOnlyPracticeEvents_IsAbsentFromCards`: FAILED,
  `Assert.DoesNotContain() Failure: Filter matched in collection` (the practice-only card Y was listed).
- `NullFirstAndRepeatReviewStages_StillCount`: PASSED (no practice events; control).
- `FallbackVariantWithoutMcqColumn_AlsoExcludesPracticeEvents`: FAILED,
  `Assert.DoesNotContain() Failure: Filter matched in collection` (card Y listed by the no-MCQ-column fallback).

After the change: all four PASSED. `dotnet test --filter FullyQualifiedName~ContentIntelligence`: 19 passed, 0 failed.

## Unchanged

`ContentIntelligenceMcqTests` (4 tests) and `ContentIntelligenceFreshnessTests` are green and byte-identical.
They seed no `focus_practice` rows, so the new predicate is a no-op for their data. No other test file,
project file, migration or route changed.

## Supervisor follow-up

- The Snowflake snapshot job `snowflake/001_content_intelligence_setup.sql` (`:73,109`) reads `review_stage`
  without a filter, so it still counts practice events. The snapshot serves `days` 30/90 while it is fresh (48 h).
  Before the next snapshot import, either add the same filter there
  (`coalesce(review_stage, '') <> 'focus_practice'`) or confirm the snapshots are stale (> 48 h, so the live path
  is served).
- Deploy order: M06 goes out before the runtime-1.8.0 OTA (M00 §9.1).
