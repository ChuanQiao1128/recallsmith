# O01 — Bundled starter packs for the three decks (#632)

Contract: R24-00 §2.1 (offline first run, wave o).

## What changed (files)

- `mobile/scripts/content/build-starter-packs.mjs` (new): the generator. Node >= 22, no dependency.
  - Fetches the live manifest at `https://cdn.developercards.app/content/manifest.json`, then each deck's `deck.json` at `<cdn>/<manifest.prefix>/<entry.path>`.
  - Checks each deck.json against the manifest `sha256`.
  - Refuses a deck that is not `tier: free`, `availability: live` and `deckType: 1`.
  - Validates slug, version (must equal buildId), unique stableUids and integer `orderInDeck`.
  - Writes the three packs and `index.ts`, and fails if the packs total 300 KB or more.
- `mobile/src/content/starter/aws-saa-c03.starter.json`, `claude-ccdv-f.starter.json`, `csharp-basics.starter.json` (new, generated).
- `mobile/src/content/starter/index.ts` (new, generated): exports `STARTER_PACKS`, `STARTER_BUILD` and the types `StarterSlug`, `StarterPack`, `StarterPackCard`.
- `mobile/tests/unit/starterPacks.test.ts` (new).

## Exact surface shipped

- Each pack has the flat deck shape `{ slug, title, locale, deckType: 1, version: "<buildId>-starter", totalCards, cards }`.
- `totalCards` is the full deck's count.
- `cards` is the published deck's cards, sorted by `orderInDeck` (ties keep array order, as in `pickStarterUids`) and cut to the shortest prefix that:
  - has at least 30 cards, and
  - reaches the 5th non-MCQ card.

  Each card object is copied verbatim.
- `STARTER_PACKS: Record<StarterSlug, StarterPack>` loads each pack with a static `require('./<slug>.starter.json')`, so the JSON is inlined in the JS bundle and ships by OTA.
- `STARTER_BUILD: Record<StarterSlug, string>` holds the buildId each pack was cut from.

Builds used (live manifest, 2026-10-02):

| slug | buildId | cards / total | non-MCQ in pack |
|---|---|---|---|
| aws-saa-c03 | 20261001T043805Z-7c5e904e | 30 / 371 | 27 |
| claude-ccdv-f | 20261001T043814Z-5364099a | 30 / 441 | 30 |
| csharp-basics | 20261001T230339Z-689d6340 | 30 / 217 | 10 |

The three files total 155,494 bytes, against a 300 KB limit. The live manifest lists csharp-basics as free, live and deckType 1, which resolves the open tier question in facts-offline §4.

When the generator decides where to cut, it counts every card with a non-null `mcq` blob as MCQ. The app instead treats an invalid blob as Q/A (`normalizeMcq`). So the generator's cut can only be longer than needed, never too short.

## How it is tested

`mobile/tests/unit/starterPacks.test.ts` (23 tests) checks:

- Exactly the three slugs are present in `STARTER_PACKS` and `STARTER_BUILD`.
- The three files total less than 300 KB.

For each pack it checks:

- The file parses and deep-equals the bundled module.
- The slug matches, `deckType` is 1, and title and locale are present.
- The version is `<STARTER_BUILD[slug]>-starter` and contains no `/`.
- There are at least 30 cards, and `totalCards >= cards.length`.
- `orderInDeck` is strictly ascending, which makes the pack a contiguous prefix.
- Every card has a unique, non-empty `stableUid`, plus the card fields.
- There are at least 5 non-MCQ cards, judged by `normalizeMcq`.
- `pickStarterUids` on the pack returns 5 uids. The result equals `pickStarterUids` on the prefix through the 5th non-MCQ card, and on every longer prefix, so the full deck gives the same lesson.

The test failed on the base (the module was missing) and passes now.

Commands:

- `cd mobile && npx tsc --noEmit && npx vitest run tests/unit/starterPacks.test.ts`
- `npm run test:unit`

When generating, I also checked the csharp-basics pack against the downloaded build: its cards are exactly the first 30 of the sorted deck.

## Owner steps

- None needed to ship.
- To refresh the packs after a content publish: `cd mobile && node scripts/content/build-starter-packs.mjs`, then commit the regenerated files. Old packs stay valid: the upgrade path (O02) replaces any installed `-starter` deck with the live build. Uids and revisions match as long as the published cards keep them.

## Deferred

- The installer and upgrade path (`starterOffline.ts`, screen hooks) is O02.
- No CI job re-runs the generator, because it needs the network. The packs are a snapshot.
