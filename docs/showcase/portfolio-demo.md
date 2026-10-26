# RecallSmith portfolio demo script (2 min 50 s)

**Audience:** hiring reviewers for .NET/AWS full-stack roles. **Purpose:** show the learner-facing offline sync path, then connect it to backend conflict handling and production recovery. This is a recording plan, not a recorded video. Use genuine app and repository screens; do not add mock metrics or synthetic product results.

| Time | Screen and action | Narration |
| --- | --- | --- |
| 0:00–0:16 | Title card with the RecallSmith repository name. Then show the mobile app's Home screen. | “RecallSmith is a spaced-repetition app for developers. I build and maintain it as a personal project, with AI tools assisting parts of the work. I’ll follow one concern from the learner app through the backend and into operations.” |
| 0:16–0:48 | In the mobile app, tap the home screen's **Review** action and answer a card. Return Home and show `ProgressSyncStatus`. If using an offline recording setup, show the real queued or retry message that the app displays. | “A review is saved locally before sync is scheduled. If the request fails, the queue remains on the device and the home screen reports whether work is waiting or needs a retry. That keeps the learner's local review usable while the connection is unavailable.” |
| 0:48–1:23 | Show `mobile/src/sync/progressSync.ts`, then `src_C/Vpc/Runtime/ProgressEvents.cs` and `src_C/Vpc/Runtime/ProgressMerge.cs`. Use editor search to point to event ids, account-scoped keys and merge behavior. | “The client sends identified review events and can safely replay an event after a lost response. Queue and cursor keys are scoped by the signed-in account. On the server, progress counts add, monotonic facts keep their greatest value, and the fields for the latest review move together. The merge code also documents an exact-millisecond tie that remains arrival-order dependent.” |
| 1:23–1:58 | Show `mobile/src/sync/drawStateSync.ts` at the merge-policy comments, then the engineering case's known-loss paragraph. | “Other state needs a different conflict rule. The collection of owned cards merges by union, while pity and wallet snapshots use last-writer-wins timestamps. Two offline devices spending from the same wallet can lose one device's spends. I kept that limitation explicit; a wallet event ledger would be a larger follow-up.” |
| 1:58–2:25 | Show the CI/CD overview in `.github/workflows/cd.yml`, then `scripts/cd/restore-point.sh` and the automatic rollback section in `infra/RUNBOOK.md`. | “Production delivery builds without AWS credentials, then waits for the production environment approval before using OIDC. The deploy records the aliases and web assets it will change, runs smoke checks, and restores changed targets when a new check fails. Database migrations are separate, so this rollback does not claim to undo database changes.” |
| 2:25–2:42 | Show `docs/ops/dr-restore-drill-2026-10-04.md`, then `docs/qa/career-readiness-20261026/operations.md`. | “A database restore drill recorded a 26-minute restore and an 8-minute restore-point lag on that run. A separate read-only observation sampled sync handler latency, but it spans releases and cannot prove business success or end-to-end speed.” |
| 2:42–2:50 | End card with links to the engineering cases and career assessment. | “The repository includes the implementation references, trade-offs and remaining evidence gaps.” |

## Recording notes

- The script describes an under-three-minute screen recording. No video or new screenshots have been created for this work.
- Use a local or otherwise authorized demo session with an existing deck. Do not create or publish demo content in production just for recording.
- Show the status message the app actually displays. Do not stage a false sync failure or replace the UI with a mock.
- The operations observation is a bounded sample. Keep its date and limitations visible if any number is included.
- If any page or screen is unavailable in the recording environment, show its source file and label the footage accordingly. Do not present source code or a mock screen as a live product result.

## Sources

- Mobile review and sync status: `mobile/src/screens/HomeScreen.tsx`, `mobile/src/screens/SessionCardScreen.tsx`, `mobile/src/features/gacha/components/ProgressSyncStatus.tsx`.
- Client sync: `mobile/src/sync/progressSync.ts`, `mobile/src/sync/drawStateSync.ts`.
- Backend merge: `src_C/Vpc/Runtime/ProgressEvents.cs`, `src_C/Vpc/Runtime/ProgressMerge.cs`, `src_C/Vpc/Runtime/DrawStateSync.cs`.
- Publish processing: `src_C/Vpc/Authoring/Publish.cs`, `src_C/Worker/Services/PublishJobProcessor.cs`.
- Delivery and recovery: `.github/workflows/cd.yml`, `scripts/cd/restore-point.sh`, `scripts/rollback.sh`, `infra/RUNBOOK.md`.
- Dated operations records: `docs/qa/career-readiness-20261026/operations.md`, `docs/ops/dr-restore-drill-2026-10-04.md`.
