# AWS bilingual authoring: release status

The authoring and release safeguards are implemented. The 337-card release remains blocked by the first actual RAG holdout and evidence-readiness evaluation. There are 337 reviewed learning objectives, including all 334 legacy StableUids; new card bodies and per-card semantic reviews are both **0/337**.

## Actual RAG results — 28 October 2026

The frozen vector profile was evaluated once on 32 positive and eight negative holdout cases. Required-group Recall@8 was **0.7078125** against 0.90; MRR@8 was **0.5911458333** against 0.75. Several themes also missed the 0.75 floor. This observed set is now development/diagnostic material for future revisions and cannot be reused as an unseen test.

The restricted .NET `IChatClient` adapter then executed 14 reader requests and 14 separate-context judge requests through the Codex subscription CLI. All 28 original execution receipts, prompts, schemas, event streams, source packets and decisions were reopened by the verifier. Results: eight of eight negatives refused, one positive refusal, zero wrong-deployment acceptances, and 12 answers rejected for incomplete required coverage or qualifiers. That last category includes supported but incomplete answers; it does not establish 12 fabricated assertions. References are model-reviewed, with **humanLabelCount=0**.

An official local OpenTelemetry collector received all 28 model-execution spans and metrics. Telemetry carries operation/outcome/duration rather than prompt or answer text. This verifies the local authoring model path; it does not attest to a production distributed trace or production reliability.

The full-RAG gate is **FAIL**, and the actual generation gate rejects it. No production card batch, merge, deployment or deck publication has been performed. The compact, non-sensitive measurement export is [first-holdout-summary.json](first-holdout-summary.json); original model/source artifacts remain in the private local workflow control directory.

## Safeguards checked

- Evaluation derives the winner from the frozen original DEV observations and binds reference authority, source files, profile, model cache and the exclusive holdout claim. Consumers validate that claim before reading holdout references or model artifacts. DEV results select a strategy; the numerical acceptance thresholds apply to holdout.
- Console recovery requires server reconciliation, binds all three original request bodies and action IDs, checks the actual dispatched bearer subject, and validates the full backup inventory. Local integrity checks do not authenticate an entirely rewritten recovery file.
- Database initialization/reset is synchronized; temporary test databases close physical connections rather than accumulating idle pools. Production pooling limits remain unchanged. The original source-response ordering assertion is retained.
- Bundled offline draw eligibility uses actual bundle read-back plus account/build/file/install-instance receipts. Replacement cannot overwrite authoritative metadata through attestation, and retired/unknown/corrupt states remain denied. Bilingual front-help remains folded below the question; actual-device and card-content learning outcomes are unverified.

Current local checks passed: backend **3,126**; frontend **1,784** plus lint/build; mobile typecheck, **2,278** unit, **730** integration and smoke; MCP **97** TypeScript tests, build and **6** Python boundary tests. These are scoped software checks, not proof that 337 reviewed cards exist or that the release is live.

A separately versioned next-revision design proposes neutral question facets and structural packing of unchanged official chunks. It requires independent plan review, bounded DEV selection and a genuinely new holdout before another release verdict. No threshold reduction or API/Bedrock fallback is proposed. Full generation, per-card bilingual/evidence review, user simulations, main CI/deployment and CDN/client acceptance remain outstanding.
