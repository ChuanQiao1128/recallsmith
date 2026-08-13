// Run: node scripts/pity-simulation.ts   (Node >= 22.18 strips the types)
//
// Why this exists: the pity counter in poolSelection.ts advances once per
// selectDrawCards CALL, not once per card revealed. threshold = 10 therefore
// means "10 pulls" to a single-draw player and "10 pulls = 100 cards" to a
// ten-draw player. Probability intuition is unreliable at this scale, so this
// measures what the two playstyles actually pay before their first LEG.
// The draw rule is re-implemented here instead of imported so the script runs
// under bare `node`: poolSelection.ts imports without file extensions, which
// plain ESM cannot resolve.

const THRESHOLD = 10;
const TRIALS = 100_000;
// 70 COM / 27 RAR / 3 LEG mirrors the pool odds in src/mock/draw.ts, written
// as a deck composition because the real selector samples uniformly from the
// missing pool: rarity comes from what is left in the deck, never from a roll.
const DECK: string[] = Array.from({ length: 100 }, (_, i) => (i < 3 ? 'LEG' : i < 30 ? 'RAR' : 'COM'));

function runToFirstLegendary(drawCount: number): { actions: number; cards: number } {
  const missing = DECK.slice();
  let pity = 0;
  let actions = 0;
  let cards = 0;

  while (missing.length > 0) {
    actions += 1;
    const picked: string[] = [];
    let fired = false;

    if (pity >= THRESHOLD) {
      let index = missing.indexOf('LEG');
      if (index < 0) index = missing.indexOf('RAR');
      if (index >= 0) {
        picked.push(missing.splice(index, 1)[0]);
        pity = 0;
        fired = true;
      }
    }
    while (picked.length < drawCount && missing.length > 0) {
      picked.push(missing.splice(Math.floor(Math.random() * missing.length), 1)[0]);
    }

    cards += picked.length;
    if (picked.includes('LEG')) return { actions, cards };
    if (!fired) pity = Math.min(pity + 1, THRESHOLD);
  }
  return { actions, cards };
}

function report(label: string, drawCount: number): void {
  const actions: number[] = [];
  const cards: number[] = [];
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const run = runToFirstLegendary(drawCount);
    actions.push(run.actions);
    cards.push(run.cards);
  }
  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * p)];
  console.log(
    `${label}: mean ${mean(actions).toFixed(2)} actions / ${mean(cards).toFixed(2)} cards | ` +
      `cards p50 ${pct(cards, 0.5)} p90 ${pct(cards, 0.9)} p99 ${pct(cards, 0.99)}`,
  );
}

report('single-draw player (drawCount=1)', 1);
report('ten-draw player  (drawCount=10)', 10);
