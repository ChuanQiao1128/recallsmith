# Database restore drill — 2026-10-03T21:25:43Z

Script: `infra/scripts/dr-restore-drill.sh` (enterprise audit DR-01). Run as `devcards-admin-mfa/owner-admin`.

| Step | Result |
|---|---|
| Source | `developercards` (db.t4g.micro, PostgreSQL 17.9, encrypted, PITR, 14-day backups) |
| Restore point | latest restorable time at request: 2026-10-03T21:17:40+00:00 |
| Restore started → instance available | 2026-10-03T21:25:43Z → 2026-10-03T21:51:53Z (**27 min**) |
| App on the restored DB, answers compared | 2026-10-03T21:52:08Z (**RTO 27 min** end to end) |
| Applied migrations (prod / restored) | `{"applied":45,"latest":45}` / `{"applied":45,"latest":45}` |
| Decks and cards (prod / restored)¹ | `{"decks":3,"cards":1029,"fingerprint":"YXdzLXNhYS1jMDNA"}` / `{"decks":3,"cards":1029,"fingerprint":"YXdzLXNhYS1jMDNA"}` |
| Verdict | **PASS** |
| RPO | measured: the newest restorable point was **8 min 3 s** behind the request (RDS uploads transaction logs about every 5 minutes, so expect 5–10 min) |
| Cleanup | throwaway function and instance deleted by the drill's EXIT trap (no final snapshot) |

Restored instance and function used the production subnets, security groups and execution role, so the drill also
proves the network path and the credentials survive a restore. No learner data left the account and nothing in the
report is per-user.

¹ This first run's fingerprint was a 16-character base64 prefix of the sorted `slug@version` list, which only covers
the first deck or two; deck count, card total and migration set matched as well. The script now uses the first 16 hex
characters of a SHA-256 over the whole list.

Times are UTC (the drill ran 2026-10-04 10:25–10:52 NZDT). Instance class db.t4g.micro restores ~1 GB of data in about
26 minutes; RTO for a real incident adds DNS/config cut-over (point `PGHOST` of core-vpc and worker at the new endpoint
through `src_C/deploy.sh`, RUNBOOK §13).
