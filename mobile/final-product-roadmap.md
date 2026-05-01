# RecallSmith Mobile · Final Product Roadmap

> Goal: turn the current v6.1-complete mobile rebuild into a fully shippable product, then extend it toward the larger adaptive-learning vision in `gacha.md`.

## 0. Current State Snapshot

Already complete:
- P0-P6 implementation for the v6.1 scope
- Main loop: Home -> Challenge -> SessionCard -> SessionSummary
- Secondary systems: Draw / Library / Settings
- Support systems: Audience preference, manual Fresh Start, streaks, light milestones, reminder plan copy
- Automated gates passing: typecheck, unit, integration, smoke, coverage, npm test

This means the product is no longer blocked by core-loop architecture work.

## 1. Product Completion Strategy

Treat the remaining work as 4 layers, in order:
1. Beta hardening
2. Launch readiness
3. Monetization + live-ops baseline
4. Differentiated adaptive-learning systems from `gacha.md`

Do not jump to advanced adaptive systems until layer 1 and 2 are stable on real devices.

---

## 2. Layer 1 · Beta Hardening (highest priority)

Objective:
Make the current mobile product reliable enough for repeated real-user testing without architectural churn.

### 2.1 Real-device QA matrix

Must test on:
- iPhone simulator fresh install
- iPhone simulator returning user
- one real iPhone fresh install
- one real iPhone returning user
- signed-in and signed-out states
- premium and non-premium states

Critical paths:
- First launch -> Home -> Challenge -> SessionCard -> SessionSummary
- Home -> Draw -> Library
- Settings -> Audience change -> Draw recommendation change
- Settings -> Fresh Start -> Home/Deck refresh
- Kill/reopen app during review and after summary
- Reward/streak/milestone dedupe after revisiting Summary

Exit criteria:
- No blocker found in main loop
- No duplicate reward/streak application
- No broken navigation or empty dead-end CTA

### 2.2 Reliability fixes

Focus areas:
- Summary revisit safety
- app resume / reload state consistency
- reminder preference persistence
- deck install/update edge cases
- auth/premium refresh edge cases
- simulator vs device UI inconsistencies

Exit criteria:
- Main loop works identically across restart/resume scenarios
- Settings changes visibly persist across reopen

### 2.3 Final UX polish for current scope

Polish targets:
- Home: reduce any remaining “toolbox” feel
- Summary: stronger completion/reward/momentum hierarchy
- Draw: better empty/locked/reward-pending states
- Settings: less system wording, more product wording
- Deck/Library: improve scanability of filters/status rows

Exit criteria:
- First 2 screens feel productized, not prototype-like
- Secondary systems feel subordinate to the main loop

Suggested effort:
- 3-6 days

---

## 3. Layer 2 · Launch Readiness

Objective:
Move from “works in development” to “safe to ship to real users.”

### 3.1 Release engineering

Tasks:
- Confirm iOS build/release path in Xcode
- verify app icon, display name, bundle settings, versioning
- verify notification permission prompts and wording
- verify RevenueCat/paywall behavior in release-like flow
- verify production config separation where needed

Exit criteria:
- A release candidate can be built and installed on device
- No dev-only blockers remain

### 3.2 Product analytics + instrumentation

Track at minimum:
- app open
- Home CTA click
- Challenge start
- SessionCard first rating
- Session complete
- Summary return home
- Draw open / draw spend
- Audience change
- Fresh Start trigger
- Paywall open / purchase / restore

Exit criteria:
- Key funnel can be measured end-to-end
- Retention and conversion events are observable

### 3.3 Support / recovery basics

Need:
- basic crash/error logging strategy
- visible failure states for deck install/update/auth sync
- support path from Settings
- internal QA checklist for every build

Exit criteria:
- Failures degrade clearly instead of silently
- Team can diagnose a bad user report

Suggested effort:
- 4-7 days

---

## 4. Layer 3 · Monetization + Live-Ops Baseline

Objective:
Ensure the app is a sustainable product, not just a polished study prototype.

### 4.1 Premium packaging

Tasks:
- finalize free vs premium content boundaries
- tighten premium deck discovery and lock states
- improve paywall entry timing and copy
- validate restore/manage-subscription paths on device

Exit criteria:
- Free user path is useful but clearly bounded
- Premium upgrade path is understandable and non-broken

### 4.2 Content operations

Tasks:
- define deck publishing/update workflow
- verify manifest/update integrity on mobile
- define “starter deck” baseline for first-time success
- define quality bar for deck metadata (difficulty, examples, code quality)

Exit criteria:
- New deck releases can be shipped without app rewrites
- Starter experience is strong enough for first-week retention tests

### 4.3 Reminder/live cadence

Tasks:
- make morning/evening reminder behavior reliable on device
- define minimum live-ops cadence: weekly content push, streak nudges, deck updates
- add light weekly support messaging before full report systems

Exit criteria:
- The app can nudge return behavior consistently
- Content updates are operationally manageable

Suggested effort:
- 4-8 days

---

## 5. Layer 4 · Differentiated Product Vision (from `gacha.md`)

Objective:
Build the real strategic moat after the simplified v6.1 product is stable.

These are the big differentiators already described in `gacha.md`, but not yet fully implemented.

### 5.1 Personal forgetting curve

Build:
- per-user review-history modeling
- adaptive interval tuning beyond the default algorithm
- user-visible weekly feedback about what the system learned

Why it matters:
- This is a real product differentiator vs generic SRS apps

### 5.2 Personal difficulty

Build:
- per-card “your difficulty” separate from global difficulty
- use it in draw recommendations, boss selection, and route packaging

Why it matters:
- Makes the app feel like it understands the user, not just the deck author

### 5.3 Energy calibration

Build:
- lightweight daily energy input (“good / okay / tired”)
- dynamically smaller/larger daily routes
- lower-pressure framing on tired days

Why it matters:
- Strong retention lever; reduces guilt and dropout

### 5.4 Weekly report / adaptive feedback

Build:
- visible explanation of streak, difficulty shifts, topic weakness, and route tuning
- support user trust in the adaptive system

### 5.5 Expanded systems after trust is earned

Later candidates:
- Month Summary
n- richer milestone ceremony
- Mastery Hall
- multi-pool / multi-deck expansion
- pool-specific audience metadata
- more advanced reminder state machine

Important rule:
Do not start these until Layers 1-3 are stable.

Suggested effort:
- 2-6 weeks depending on scope depth

---

## 6. Recommended Execution Order

### Track A · Immediate (next 1-2 weeks)
1. Real-device QA pass
2. Fix blockers and state bugs
3. Final UX polish on Home / Summary / Draw / Settings
4. Release-candidate build on device
5. Add analytics instrumentation

### Track B · Near-term (following 1-2 weeks)
6. Premium/paywall/product packaging cleanup
7. Deck/content ops workflow validation
8. Reminder reliability on physical device
9. Internal release checklist + support flow

### Track C · Strategic (after beta confidence)
10. Personal difficulty system
11. Energy calibration
12. Personal forgetting curve
13. Weekly adaptive report
14. Multi-pool / deeper progression systems

---

## 7. Definition of “Entire Product Complete”

Use three completion bars:

### A. v6.1 complete
Meaning:
- current mobile rebuild is functionally done
Status:
- Achieved

### B. shippable v1 complete
Meaning:
- polished main loop
- reliable on real devices
- monetization path works
- analytics and support basics exist
Status:
- Not yet fully complete

### C. differentiated product complete
Meaning:
- adaptive-learning moat from `gacha.md` is live and user-visible
Status:
- Not started in full

---

## 8. Practical Time Estimate

From today:

### To reach shippable v1
- Best case: 2-3 weeks
- More realistic: 3-5 weeks

### To reach differentiated product vision
- Add another: 2-6 weeks

So “entire product” depends on definition:
- current rebuild finish: done
- ship-ready v1: several more weeks
- full strategic product vision: additional multi-week roadmap

---

## 9. Next Best Action

Do this next, in order:
1. Run a disciplined real-device QA pass
2. Record blockers by severity
3. Fix blockers and polish UX
4. Build a release candidate
5. Only then decide whether the next investment is monetization hardening or adaptive-learning differentiation
