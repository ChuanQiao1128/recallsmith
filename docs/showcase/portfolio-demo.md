# RecallSmith portfolio demo plan (2 min 55 s)

**Audience:** hiring reviewers for .NET/AWS full-stack roles. **Purpose:** show the actual guest/offline learning flow in the isolated Simulator, then connect it to isolated publish acceptance and separately documented operations. This is a script, not a recorded video. The app is branded DeveloperCards; RecallSmith is the repository and project name.

| Time | Screen and action | Narration |
| --- | --- | --- |
| 0:00–0:14 | Start on the actual DeveloperCards Home screen. Briefly show the RecallSmith repository name in an end card or editor tab. | “RecallSmith is my personal spaced-repetition project. The learner app is branded DeveloperCards. I build it alone, with AI tools assisting parts of the work. This clip follows a guest lesson through a local reward, then shows separate backend acceptance evidence.” |
| 0:14–0:30 | In the dedicated isolated iOS 18.5 Simulator QA app, start the bundled SAA-C03 lesson. Show the lesson counter and offline notice on the first card. | “This run starts as a guest from the bundled starter pack. The app can open the lesson offline, without fetching content from a server.” |
| 0:30–0:55 | Tap **Show answer**, pause on the answer, then tap **Got it**. Repeat the actual controls through the five-card lesson. If trimming or speeding up repeated cards, show a visible time-compressed label. | “The lesson asks me to recall first, then reveal the answer and mark the card learned. Completing five cards follows the normal local lesson flow.” |
| 0:55–1:18 | Show lesson completion, open **Draw**, spend one draw, perform the visible native swipe and stop on the real draw result with four draws left. | “Completing the lesson grants its five bootstrap draws. I spend one through the local draw flow. The result changes the collection, and four draws remain.” |
| 1:18–1:38 | Return Home, terminate and relaunch the same isolated app, then show Home with the reward pack ready, four draws and the saved-on-device status. | “After relaunch, the local lesson and draw state are still there. The status says it is saved on this device and asks the guest to sign in to sync. This recording does not demonstrate sign-in or production sync.” |
| 1:38–2:00 | Show the isolated publish journey summary, then the corresponding authoring handler, worker, database assertion and mobile importer source. | “A separate acceptance journey edits a card, publishes through the real handlers against disposable PostgreSQL, redelivers the captured job, rebuilds a manifest and installs downloaded bytes with the actual mobile importer.” |
| 2:00–2:20 | Show the publish journey's explicit boundaries: synthetic identity, queue/S3/network/storage adapters and the injected manifest rebuild delegate. | “The journey uses synthetic identity and local adapters. Its worker calls manifest rebuild unconditionally, so it does not verify the default freshness and debounce decision. It is business-path evidence, not a deployed end-to-end test.” |
| 2:20–2:39 | Show the publish metric contract and 27 October SLO review. Point to replay limitations and retained targets. | “Publish metrics are best-effort handler events, not a complete job ledger. The SLO review kept the 95 percent within two seconds sync target and existing guards. This observation cannot prove one source version, end-to-end speed, sync success or actual cost.” |
| 2:39–2:55 | Show the approved CD restore-point summary and the dated database restore drill. End on links to the three engineering cases. | “CD restores changed code and web assets after a new smoke failure; database recovery is separate. The recorded restore is one drill, not a recovery guarantee. The repository links each case to its evidence and limits.” |

## Recording notes

- The three real screenshots in the root README are unedited captures from an isolated iOS 18.5 iPhone 16 Simulator run, using the current JavaScript bundle in a reused QA native shell. They are not production or physical-device evidence.
- Use the dedicated isolated QA app and its existing local journey evidence. Do not create or publish demo data in production.
- Keep the offline/guest state visible. Do not present an authenticated session, paid purchase, cross-device sync or production publish as part of this demo.
- If repeated card actions are sped up, label the cut as time-compressed. Keep screenshots genuine and leave the actual controls visible at least once.
- No video has been recorded for this document. The root README links to the current QA screenshots; this plan does not claim that recording exists.

## Sources

- Native path and limits: [native journey](../qa/career-readiness-20261026/native-journey.md).
- Isolated publish acceptance and adapter boundaries: [publish journey](../qa/career-readiness-20261026/publish-journey.md).
- Replay metrics and SLO decisions: [publish metric contract](../qa/career-readiness-20261026/publish-metrics.md), [SLO review](../qa/career-readiness-20261026/slo-review-20261027.md), and [operations observation](../qa/career-readiness-20261026/operations.md).
- Integrated test status: [verification tracker](../qa/career-readiness-20261026/verification.md).
- UI actions and local session behavior: `mobile/src/screens/SessionCardScreen.tsx`, `mobile/src/screens/DrawScreen.tsx`, `mobile/src/screens/DrawResultScreen.tsx`, `mobile/src/screens/HomeScreen.tsx`.
- Backend publish and recovery: `src_C/Vpc/Authoring/Publish.cs`, `src_C/Worker/Services/PublishJobProcessor.cs`, `.github/workflows/cd.yml`, `scripts/cd/restore-point.sh`, `infra/RUNBOOK.md`.
