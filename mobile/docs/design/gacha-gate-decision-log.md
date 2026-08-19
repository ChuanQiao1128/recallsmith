# Gacha ownership gate — decision log

Decisions taken while shipping the ownership gate ("you study what you draw")
across mobile phases 0–5. Each entry records what was decided, what the
alternative was, and what would make us revisit it.

This is a log, not a plan. Nothing here is a TODO; every entry describes the
state the code is in as of this branch. The current product spec remains
`mobile/gacha-v7.md`.

---

## D1 — Migration is a standing rule, not a one-shot

**Decided.** The gate reads `effectiveOwned = owned ∪ already-studied`,
recomputed on every read (`src/features/gacha/draw/effectiveOwned.ts`).

**Alternative rejected.** Walk every deck once at upgrade time, fold
learned-but-undrawn cards into the owned set, then let the gate read `owned`
alone. Cheaper per read, and wrong against the fleet we have: 1.4.0 clients
are still in the field and still ungated, so progress for never-drawn cards
keeps arriving through `progressSync` after migration day. A one-shot
migration seals the door behind whatever existed on that day and locks every
later arrival out of its own history.

**Revisit when.** No ungated client has synced in a full release cycle. Then
the union becomes a no-op and can be dropped for a plain `owned` read.

---

## D2 — Economy floor: one pull when starved, idempotent per day

**Decided.** When owned-new = 0 **and** due = 0 **and** the wallet holds 0
pulls, grant exactly 1 pull, at most once per local day
(`src/features/gacha/rewards/economyFloor.ts`).

**Why it exists.** The gate creates a deadlock it cannot escape on its own:
pulls are earned by clearing a route, a route needs owned cards, and owned
cards come from pulls. Home's own view model names the trap — kind
`nothing_to_learn` with draw state `locked`, which falls through to "Open
library" over a library of silhouettes.

**Placement: the Home load chain, not `loadHomeDeckSummaries`.** `refreshHome`
is the one point in the app where all three inputs are in hand at the same
instant. Granting inside the summaries load would put the write on the far
side of the `Promise.all` from the wallet read that renders it, so the load
that granted a pull would still draw "Clear today's route to unlock pulls" —
the screen telling the user they are stuck on the load that unstuck them. The
two counting inputs are summed in `deckActionResolver` (where the per-deck
numbers are born, so the "which decks count" rule has one home) and travel on
the snapshot as `totalNewAllDecks` / `totalDueAllDecks`.

**Grant size: 1.** The smallest amount that reopens the loop. More would make
starvation the cheapest way to farm pulls, which is the failure on the other
side.

**Starvation is global, not per selected deck.** A user with work waiting in
another deck is not in a dead end.

**Absent counts do not grant.** A count that is not a number is read as "not
starved", never as zero: zero is evidence the user has no work, `undefined` is
the absence of evidence, and a floor that pays out on absence pays out exactly
when a caller forgot to count.

**Three conditions, no fourth.** An account with no deck installed satisfies
all three vacuously and is granted anyway. "Must have a studiable deck" would
read as tidier and would withhold the pull from the one user whose next act is
to install a deck and want one.

**Idempotency: one key holding the last day paid out.** Written before the
wallet, same ordering (and same reasoning) as the session-reward dedupe in
`rewardWallet.ts`: a crash between the two writes costs one pull rather than
arming a second grant.

**Accepted cost.** The day marker is a local day key, so moving the device
clock backwards permits one extra grant per change. The ceiling is one pull,
which is strictly more work than just studying, so it does not justify a
server round-trip.

**Revisit when.** Telemetry shows the floor firing on more than a marginal
share of daily Home loads — that would mean the gate is starving ordinary
users rather than catching an edge, and the fix belongs in pull earn rates,
not here.

---

## D3 — Deviation: Home's primary CTA bypasses the Challenge screen

**Spec.** `gacha-v7.md` §3.6.2 requires that Home's primary CTA can only lead
to `ChallengeScreen` ("从 Home 主 CTA 不会进入 DeckScreen（只能进
ChallengeScreen）").

**Shipped.** `HomeScreen.handlePrimaryCta` navigates straight to
`SessionCard` for the `challenge` nav kind. `ChallengeScreen` still exists and
is still reachable from the bottom Review tab and from deep links; what it
lost is its place in the middle of the main daily path.

**Why it stands.** The route-preview interstitial answers "what will today's
run look like", but the user pressing the primary button has already decided
to study. `SessionCard` does its own deck/route/progress loading, so the
interstitial buys a screen of latency and a second tap for information the
session header repeats. Phase 0 (#11) explicitly decided to leave the Challenge
screen as-is rather than spend the gate work on re-litigating this.

**Consequence, stated plainly.** The spec line above is currently false of the
main path, and any test asserting it would be asserting the spec rather than
the product. The integration test that covers this
(`tests/integration/home-cta-target.test.tsx`) pins the *shipped* destination.

**Revisit when.** The route preview earns its place — e.g. it starts showing
something the session header cannot (difficulty mix, boss preview, a choice
the user actually makes).

---

## D4 — Deviation: the settlement celebration chain is unlit

**Spec.** v6/v7 describe a celebration chain after a cleared session:
settlement → mastery celebration / collection milestone / mastery milestone.

**Shipped.** The screens exist and are routable, but they are shells.
`SettlementScreen` renders `MOCK_SETTLEMENT` and `buildMockSessionCards()`
rather than the session that just finished, and reaches the celebration
screens through manual secondary buttons ("Celebrate mastery", "Open
collection milestone") rather than by any real condition being met.
`MasteredCelebrationScreen` says so in its own body copy: "This is the v6
shell for the higher-energy mastery moment."

**Why it stands.** Lighting the chain means deciding what actually triggers
each celebration (which mastery step, which collection tier, how often), and
those thresholds are economy design, not wiring. Doing it inside the gate work
would have shipped guesses at the thresholds along with the gate, and a
celebration that fires on the wrong condition is worse than one that does not
fire: it teaches the user a rule that is not the rule.

**Consequence, stated plainly.** A user who clears a session sees settlement
numbers that are not theirs. This is the oldest deviation in the list and the
one most visible to a real user.

**Revisit when.** The thresholds are decided. That is a separate piece of work
from the gate and should carry its own issue; it needs `SettlementScreen` fed
from the real session before any celebration can be triggered honestly.
