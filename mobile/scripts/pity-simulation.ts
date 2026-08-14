// Run: node scripts/pity-simulation.ts   (Node >= 22.18 strips the types)
//
// Why this exists: the pity counter used to advance once per selectDrawCards
// CALL, so threshold = 10 meant "10 cards" to a single-draw player and "100
// cards" to a ten-draw player. Probability intuition is unreliable at this
// scale, so this measures what the two playstyles actually pay. It is now the
// evidence that the per-card rewrite worked, not just the evidence that the
// old rule was unfair.
// The draw rule is re-implemented here instead of imported so the script runs
// under bare `node`: poolSelection.ts imports without file extensions, which
// plain ESM cannot resolve. Keep it in step with poolSelection.selectDrawCards.
//
// BEFORE (counter per call, reset on LEG only):
//   single-draw player: mean 9.46 cards to a first LEG, never worse than 11.
//   ten-draw  player:   mean 30 cards, p90 60, p99 80, and the guarantee never
//                       fired once: 10 calls costs 110 cards and the deck only
//                       holds 100, so the safety net was deck exhaustion.
//
// AFTER (counter per revealed card, reset on any RAR+), same 100k runs:
//   single-draw: first RAR+ mean 3.21 cards (max 11) | first LEG mean 22.23
//                revealed / 22.23 paid, p90 46, p99 72
//   ten-draw:    first RAR+ mean 3.22 cards (max 11) | first LEG mean 22.29
//                revealed / 27.15 paid, p90 47, p99 72
// Read the "revealed" columns: 22.23 vs 22.29, a gap inside Monte Carlo noise
// (SE is about 0.07 at 100k trials), because the counter no longer knows how
// cards were grouped into pulls. The ten-draw player's only remaining premium
// is granularity, about 5 cards, the unrevealed tail of the pull that
// contained the LEG. That is the price of buying ten at a time, not a penalty
// the pity rule imposes.
//
// The first-LEG mean moved 9.46 -> 22.23 for single-draw players, and that is
// a real nerf worth stating plainly: the old counter reset only on a LEG, so
// it was a hidden 10-pull LEGENDARY guarantee that no label ever claimed. The
// label always said RAR+, so these are the numbers it was describing all
// along. What the player gains is the run-length promise, identical for both
// playstyles: at most 10 commons in a row. That is what "first RAR+ max 11"
// reports (10 commons, then the guaranteed card).

const THRESHOLD = 10;
const TRIALS = 100_000;
// 70 COM / 27 RAR / 3 LEG mirrors the pool odds in src/mock/draw.ts, written
// as a deck composition because the real selector samples uniformly from the
// missing pool: rarity comes from what is left in the deck, never from a roll.
const DECK: string[] = Array.from({ length: 100 }, (_, i) => (i < 3 ? 'LEG' : i < 30 ? 'RAR' : 'COM'));

type Run = {
  actions: number;
  // Cards revealed up to and including the first LEG: the fair per-card cost.
  revealedToLeg: number;
  // Cards the player paid for, rounded up to whole pulls: what the wallet saw.
  paidToLeg: number;
  revealedToRarePlus: number;
};

function runToFirstLegendary(drawCount: number): Run {
  const missing = DECK.slice();
  let pity = 0;
  let actions = 0;
  let revealed = 0;
  let revealedToRarePlus = 0;
  let sawRarePlus = false;

  while (missing.length > 0) {
    actions += 1;
    let pulled = 0;

    for (let slot = 0; slot < drawCount && missing.length > 0; slot += 1) {
      let index = -1;
      if (pity >= THRESHOLD) {
        index = missing.indexOf('LEG');
        if (index < 0) index = missing.indexOf('RAR');
      }
      if (index < 0) index = Math.floor(Math.random() * missing.length);

      const card = missing.splice(index, 1)[0];
      revealed += 1;
      pulled += 1;
      pity = card === 'COM' ? Math.min(pity + 1, THRESHOLD) : 0;

      if (!sawRarePlus && card !== 'COM') {
        sawRarePlus = true;
        revealedToRarePlus = revealed;
      }
      if (card === 'LEG') {
        // The rest of this pull is still paid for, so paid rounds up to the
        // whole action while revealed stops at the card that ended the run.
        const paid = revealed - pulled + Math.min(drawCount, pulled + missing.length);
        return { actions, revealedToLeg: revealed, paidToLeg: paid, revealedToRarePlus };
      }
    }
  }
  return { actions, revealedToLeg: revealed, paidToLeg: revealed, revealedToRarePlus };
}

function report(label: string, drawCount: number): void {
  const revealed: number[] = [];
  const paid: number[] = [];
  const toRarePlus: number[] = [];
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const run = runToFirstLegendary(drawCount);
    revealed.push(run.revealedToLeg);
    paid.push(run.paidToLeg);
    toRarePlus.push(run.revealedToRarePlus);
  }
  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * p)];
  // Reduce rather than Math.max(...xs): 100k arguments overflows the stack.
  const max = (xs: number[]) => xs.reduce((best, x) => (x > best ? x : best), 0);
  console.log(
    `${label}: first RAR+ mean ${mean(toRarePlus).toFixed(2)} cards (max ${max(toRarePlus)}) | ` +
      `first LEG mean ${mean(revealed).toFixed(2)} revealed / ${mean(paid).toFixed(2)} paid, ` +
      `p90 ${pct(revealed, 0.9)} p99 ${pct(revealed, 0.99)}`,
  );
}

report('single-draw player (drawCount=1)', 1);
report('ten-draw player  (drawCount=10)', 10);
