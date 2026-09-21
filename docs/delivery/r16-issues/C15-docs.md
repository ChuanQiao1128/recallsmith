# C15 — Docs: content-delivery-v3 / console-import-plan additions, MCQ plan migration numbers → 019/020, economy amendment landing, pointer lines (`docs`)

Prose only, seven files, no code. After C01–C14 have merged, the repo's living docs still describe the pre-Wave-C world: the MCQ plan names the mcq migration `018_cards_mcq.sql` (the tree ships `018_cards_topic.sql` + `019_cards_mcq.sql`) and registers that name as not-on-disk, `docs/content-delivery-v3.md` says a card has 9 fields, `docs/console-import-plan.md` knows no `TOPIC:` / `OPT:` / `WHY:` / `QUALIFIER:` markers, the two docs the economy amendment superseded carry no pointer to it, the launch copy still sells "1 pull per full clear" and a 30+5 wallet, and the Wave C wave-end checklist forgets the Snowflake re-run. C15 fixes exactly those sentences with minimal, dated, in-place edits (history lines stay), keeps every top-level `docs/*.md` green under `frontend/tests/docsPaths.test.ts`, and confirms (read-only) that the economy amendment's checklist landed in code.

## Context

Base of the wave is `delivery/r16-c-economy` (== `main@52594fe`). Your worktree is cut after C01–C14 merged (C00 §4: C15 deps C01, C09, +C14 — the last in the serial queue), so the code you document is already on your tree; the six docs below are untouched by every other Wave C issue except `docs/delivery-wave-1.6-plan-2026-09-19.md` (C11 deleted its `:229` bullet — nothing above `:121` moved). Every line number below was read on the base tree on 2026-09-21 and holds on your tree.

What the docs say today, and what the tree does:

- `docs/mcq-card-type-plan-2026-09-18.md` (500 lines). `:64` heading "### 3.1 PostgreSQL（新迁移 `src_C/Vpc/Db/Migrations/018_cards_mcq.sql`，一条语句）"; `:402` (Phase 1 row) "迁移 018" and "（WhenWritingNull，最后一个属性）"; `:415` "| DB | 018 迁移一列 | `src_C/Vpc/Db/Migrations/018_cards_mcq.sql` | S |"; `:376`, `:406`, `:429` say "迁移 019" for the Phase 5 snapshot column; `:96` (§3.3) "作为**最后一个**属性追加，现有 9 个键的字节保持一致："; `:112` (§3.4) starts "`mcq` 缺席 = Q/A。"; `:375` (§7 Phase 3) derives `answer_mode` from "card_format + app_version ≥ 1.6.0"; `:495-500` is the doc's single `<!-- paths-not-on-disk -->` block with three bullets, the third (`:499`) being `src_C/Vpc/Db/Migrations/018_cards_mcq.sql`. Tree: `src_C/Vpc/Db/Migrations/` ends at `017_cards_keyset_index.sql` on base; C05 added `018_cards_topic.sql`, C08 added `019_cards_mcq.sql` (C00 §0, §6 #1). `CardExportData` (`src_C/Worker/S3/IS3DeckUploader.cs:50-61`, 9 properties on base) gained `Topic` (C05) and then `Mcq` after it (C09) — so "the last property" is now "after `Topic`" (C00 §6 #2). `answer_mode` is keyed on `client_features` (C13's Snowflake expression, C00 §2.12 / §6 #9), never on `app_version`. Phase 5's snapshot column is migration 020, outside the wave.
- `docs/content-delivery-v3.md` (124 lines, English). `:30-31` card JSON shape `{ stableUid, orderInDeck, difficulty, question, explanation, codeLanguage, codeSnippet, realWorldUsage, revision }`; `:50` "ANY of the 9 card fields differing"; `:111` "`POST /api/v1/admin/db/migrate` (superadmin) → applies 011." Tree: `DeckDiff.CardChanged` (`src_C/Worker/Content/DeckDiff.cs:60-71` on base, 9 compares) now also compares `Topic` (ordinal) and `Mcq` via `DeckDiff.McqEquals` (`JsonNode.DeepEquals`) — 11 fields (C09 also bumps the `:17` comment to 11). Both new export properties carry `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` because `ContentJson.Options` (`src_C/Worker/Content/ContentJson.cs:11-15`) has no null-ignore, so a deck with neither serializes byte-for-byte as before (C00 §0 "Byte-identical artifacts").
- `docs/console-import-plan.md` (87 lines, Chinese, dated 2026-08). `:16` "**服务端零改动**" (true in 2026-08 — stays as history); rules list `:41-46`; field map `:44-45` "Q → question,A → explanation, CODE → codeSnippet+codeLanguage,USAGE → realWorldUsage。"; §四 验收 `:81-87` (four numbered items, `:85` "同一文件再导一次 → 全部 unchanged"). Tree after C06/C11: `frontend/src/lib/deckImport.ts` has `TOPIC_MARKER`, `OPT_MARKER`, `WHY_MARKER`, `QUALIFIER_MARKER`, `COMPARABLE_FIELDS` ending `…, 'realWorldUsage', 'topic', 'mcq'`, issue codes `BAD_TOPIC` / `DUPLICATE_TOPIC` / the `MCQ_*` family (`frontend/src/lib/mcqRules.ts`); `frontend/src/lib/deckImportRunner.ts` sends `topic` and `mcq` (explicit `null` clears) and stops on `SERVER_NOT_READY_MCQ` (C00 §2.8.2, §2.11).
- `docs/gacha-acquisition-learning-loop-plan.md` (687 lines). `:29` is 裁决 6 ("当前奖励政策保持“真实 full clear 得 1 抽”…"), inside the numbered list `:24-30`; `:384` is 不变量 4 ("当前奖励规则唯一：full clear +1；minimumGoal 不改变抽数。"), inside the list `:380-388`. Neither line cites the economy doc today (`grep -c 'docs/economy-v2-learn-to-earn-2026-09-19.md'` → 0).
- `mobile/gacha-v7.md` (681 lines; under `mobile/`, so NOT scanned by docsPaths). `:94` "v6.1 §2 “唯一规则真表”继续有效，v7 不引入新规则、不修改阈值。具体含义：", `:95` blank, `:98` bullet "Free pull cap：30 主钱包 + 5 reserve；超过 35 才不发…". Tree after C01: `mobile/src/features/gacha/constants.ts:9` `FREE_PULL_CAP = 60` (`FREE_PULL_OVERFLOW_CAP = 5` unchanged).
- `docs/home-review-and-launch-copy-2026-09-17.md` (574 lines). Live marketing copy stating the old rule or the old cap: `:159` (Promotional text, table row with a length cell `| 166 |`, limit ≤170), `:165` (App Store description sentence "clear today's 1–5 card review, earn one pull"), `:174` ("Fully clear the day's route and one pull lands in your wallet"), `:178` ("up to 30 pulls plus a 5-pull reserve"), `:204` (short post "Finish today's review (1–5 cards), get one pull", its `（267 字符）` header at `:202`), `:208` ("30+5 wallet … 1 pull per full clear", header `（249 字符）` at `:206`), `:222` ("clear the route, earn the next pull", multi-line post, header `（265 字符）` at `:218`), `:243` ("每天清完 1–5 张复习就得 1 抽"), `:247` and `:341` ("钱包上限 30 抽 + 5 抽备用"), `:259` ("只能靠今天学完那几张"), `:275` ("fully clearing today's review"), `:279` ("caps at 30 pulls plus a 5-pull reserve"), `:303` ("Clear the day's route and you earn one pull … earn one per cleared day"), `:321` ("earned only by clearing the day's route"), `:323` ("at one pull per cleared day"), `:337` ("全部清完得 1 抽"), `:364` (video script 7–10s row: "the route (3 cards) clears and the wallet ticks up +1" / caption "Clear today's route, 1–5 cards. +1 pull."), `:376` (FAQ: "clearing today's review (+1)"). Red-line table §2.10 `:399-425`: row `:413` `| 部分完成也给抽 / 每场 2 抽 | full clear = 1，否则 0 | "1 pull per fully cleared review" |`. History that STAYS byte-identical: `:39` (diagnosis), `:52` F5, `:56` F9, `:57` F10, `:79-80` (ASCII mock), `:411` (the "30 抽硬保底" row is about pity, not the cap) and — above all — `:407`, the `"no AI anywhere"` row, whose 为什么 cell holds one of the six driver-banned terms (C00 §0 do-not-touch list). The short-post character counts follow python `len()` of the quoted body; a multi-line post counts its `> ` lines joined by `\n` (header `:218` = 265 today).
- `docs/delivery-wave-1.6-plan-2026-09-19.md:121` `**Wave C 结束你要做的**：后端打包部署 + 生产库跑 018/019 → 两个卡组重新发布并**字节 diff**…` — no Snowflake step, although C13 rewrote `snowflake/001_content_intelligence_setup.sql` (views / dynamic tables are `create or replace`; there is no runner in the repo, the owner applies it by hand, `snowflake/README.md`).
- `docs/economy-v2-learn-to-earn-2026-09-19.md` (66 lines) is the signed rule table (§2 R1–R10 `:24-35`, §3 4' `:41-45`, §5 checklist `:54-60`, §6 three `[x]`). You do NOT edit it. Its §5 is the "landing checklist" of this issue's title: R1/R2/R5 tests (C01), summary copy (C01), Home locked copy (C03), launch copy (this issue), Content Intelligence unaffected (C13 partitions by `answer_mode`; Q/A scoring unchanged).

What C00 decided for C15 (`docs/delivery/r16-issues/C00-contracts.md` §1.3 last paragraph, §2.14, §5 "docsPaths", §6 #1/#2/#9/#12/#20): the exact edit list below; migration names 018 topic / 019 mcq / 020 Phase 5; the registered `018_cards_mcq.sql` bullet is **deleted, never renumbered** (a registered path that exists fails rule (b) of `frontend/tests/docsPaths.test.ts:169-184`); pointer lines are added, history is never rewritten; C15 never cites the surviving old-rule strings in code (`ChallengeScreen.tsx:31` "+2 free pulls", `libraryMapper.ts:216`, `DrawScreen.tsx`, `DrawResultScreen.tsx` — §6 #20). Every top-level `docs/*.md` is scanned by `frontend/tests/docsPaths.test.ts` (`:85-131`: readdir non-recursive; CITATION = backtick + `(frontend|mobile|src_C|pg-layer|snowflake|docs|\.github)/[A-Za-z0-9._/-]+?` + optional `:N` / `:N-M` + backtick; rule (a) `:153-166` cited ⇒ on disk or registered; rule (b) `:170-184` registered ⇒ NOT on disk; only the first block per doc is parsed, entries are `- path` bullets).

Two places where C00's own list is incomplete, resolved here (the wave driver was told): (1) C00 §1.3 says "no other top-level `docs/*.md`" while §2.14's last bullet edits `docs/delivery-wave-1.6-plan-2026-09-19.md:121` — the specific edit list wins, so that file IS in scope for that one line. (2) C00 §2.14 names five launch-copy lines (`:159`, `:165`, `:275`, `:303`, `:323`) plus `:208` / `:413`; economy-v2 §5 `:59` says **all** old-rule launch copy changes, and C00 §0 forbids any copy line stating a rule outside R1–R10 — so the other live-copy lines listed above (`:174`, `:178`, `:204`, `:222`, `:243`, `:247`, `:259`, `:279`, `:321`, `:337`, `:341`, `:364`, `:376`) are in scope too; the verify pins their old strings gone.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables; the do-not-touch list names `:407`), §1.3 (last paragraph — C15's file list), §2.14 (verbatim edit list), §5 (verify conventions, "docsPaths" bullet), §6 #1, #2, #9, #12, #20.
2. `docs/economy-v2-learn-to-earn-2026-09-19.md:1-66` (whole; §2 R1–R10 and §5 are what you document).
3. `docs/mcq-card-type-plan-2026-09-18.md:62-113` (§3.1–3.4), `:372-379` (§7), `:397-431` (§9 table + 改动清单), `:493-500` (the exemption block).
4. `docs/content-delivery-v3.md:21-58` (§Contract, §New artifacts), `:108-115` (§Deployment).
5. `docs/console-import-plan.md:1-87` (whole).
6. `docs/gacha-acquisition-learning-loop-plan.md:22-31`, `:378-389`.
7. `mobile/gacha-v7.md:80-103` (§2.1–2.2).
8. `docs/home-review-and-launch-copy-2026-09-17.md:154-200` (§2.3 App Store), `:200-262` (§2.4–2.5 short posts), `:262-355` (§2.6–2.7 long posts), `:355-398` (§2.8 video, §2.9 FAQ), `:399-425` (§2.10 red lines). Read `:35-60` and `:79-80` once so you recognise the history rows you must not touch.
9. `docs/delivery-wave-1.6-plan-2026-09-19.md:101-121` (Wave C table + the wave-end line).
10. `frontend/tests/docsPaths.test.ts:85-131`, `:150-200` (the regex and the two rules your edits must satisfy).
11. On your tree (post C01–C14), to confirm the code you are describing: `src_C/Vpc/Db/Migrations/018_cards_topic.sql`, `src_C/Vpc/Db/Migrations/019_cards_mcq.sql`, `src_C/Worker/S3/IS3DeckUploader.cs` (`CardExportData`: `Topic`, then `Mcq`), `src_C/Worker/Content/DeckDiff.cs` (`McqEquals`, the `:17` comment), `frontend/src/lib/deckImport.ts` (the four markers, `COMPARABLE_FIELDS`), `frontend/src/lib/deckImportRunner.ts` (`SERVER_NOT_READY_MCQ`), `snowflake/001_content_intelligence_setup.sql` (`answer_mode`, `client_features`), `mobile/src/sync/clientCapabilities.ts`, `mobile/src/features/gacha/constants.ts:9`. Where the shipped code differs from C00, document the code and say so in your PR summary — do not edit code.

## Constraints

- **Scope (the ONLY files that may change):** `docs/mcq-card-type-plan-2026-09-18.md`, `docs/content-delivery-v3.md`, `docs/console-import-plan.md`, `docs/gacha-acquisition-learning-loop-plan.md`, `mobile/gacha-v7.md`, `docs/home-review-and-launch-copy-2026-09-17.md`, `docs/delivery-wave-1.6-plan-2026-09-19.md` (one line). Nothing under `mobile/src`, `mobile/tests`, `frontend/src`, `frontend/tests`, `src_C`, `snowflake`; no other top-level `docs/*.md` (in particular NOT `docs/economy-v2-learn-to-earn-2026-09-19.md`, NOT `docs/release-1.6.0-plan-2026-09-19.md` — both already say 018 topic / 019 mcq / 020); no new files; no `snowflake/README.md` (C13 owns it).
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. C15 has no exception.
- **OTA rule:** `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json` are byte-identical (`"expo-updates": "~29.0.15"`, `"version": "1.6.0"` stay). No dependency, no native module, no `npm install` / `npm ci` / `dotnet restore`, no network.
- **Minimal, in-place, dated edits — no reflow, no reformat, no re-wrapping of untouched lines.** Diff budgets the verify enforces: loop-plan exactly `2 added / 0 deleted`; gacha-v7 exactly `1 / 0`; wave plan exactly `1 / 1`; MCQ plan ≤ 12 / ≤ 12; content-delivery-v3 ≤ 8 added / ≤ 4 deleted; console-import-plan ≤ 30 added / ≤ 3 deleted; launch copy ≤ 27 added / ≤ 25 deleted.
- **docsPaths:** every path you write in backticks with a top-level prefix (`docs/…`, `frontend/…`, `mobile/…`, `src_C/…`, `snowflake/…`) must exist on disk. Prefer bare file names (`018_cards_topic.sql`, `DeckDiff.cs`) for anything you are not sure of; never cite a planned/absent file; never add a `paths-not-on-disk` block to a doc that has none; the MCQ plan keeps exactly ONE block whose entries after your edit are exactly `docs/aws-saa-mcq-authoring-guide.md` and `snowflake/002_mcq_marts.sql` (both still absent). Refer to the Wave C contract in prose ("Wave C C00 §6 #2"), not as a backticked `docs/delivery/r16-issues/…` path.
- **Banned literals:** the six driver-banned terms (B00 §0; C00 §0 deliberately does not spell them, nor does this brief) must not appear in any line you add — say "work around", "sidestep", "sensor", "guard". Concretely: never touch, quote or paraphrase the 为什么 cell of the `"no AI anywhere"` row at `docs/home-review-and-launch-copy-2026-09-17.md:407`; the verify checks that row is neither removed nor even a context line of your diff. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff (there is no code, so this is trivially true — keep it so).
- **Content:** never copy ExamTopics / SAA-C03 dump content. The two §4.3 example cards of the MCQ plan are referenced by uid only (`aws-sqs-order-buffer-mcq-01`, `aws-s3-compliance-copy-mcq-02`); do not paste their text into any doc.
- **Numbers and rules come only from** economy-v2 §2 (R1–R10) / §3 (4') and C00 (cap 60 + 5, migrations 018/019/020, 11 card fields, the envelope keys `clientFeatures` / `updateId` → payload `client_features` / `update_id`). Do not invent thresholds; do not write a rule that is not in that table (e.g. no "per-day new-card limit", no "pulls for correct answers").
- **Language:** each doc keeps its language — Chinese docs get Chinese additions (technical identifiers stay English), `docs/content-delivery-v3.md` is English; in the launch-copy doc an English line stays English and a Chinese line stays Chinese.
- **History stays:** the lines named "history" in Context are byte-identical; `docs/console-import-plan.md:16` "服务端零改动" stays; MCQ plan Phase rows keep their structure (only the numbers/phrases named below change).
- **Tests:** none are written or changed (C00 §3 lists nothing for C15; no property test applies to a docs issue). `frontend/tests/docsPaths.test.ts` and `frontend/tests/rootReadmePaths.test.ts` are the only tests that read these files and must stay green.
- **Budget:** 30 minutes of worker time. Do the MCQ plan first (it is the one that can go red in someone else's gate), the launch copy last.

## Changes required

Text inside a fenced block is to be typed exactly as shown — the backticks inside the fences are part of the doc text. "Pinned" means the verify greps it with `-F`.

1. **`docs/mcq-card-type-plan-2026-09-18.md`** — migration numbers, property order, `answer_mode` key.
   a. `:64` heading becomes exactly:
      ```text
      ### 3.1 PostgreSQL（新迁移 `src_C/Vpc/Db/Migrations/019_cards_mcq.sql`，一条语句）
      ```
   b. `:96` (§3.3) `作为**最后一个**属性追加，现有 9 个键的字节保持一致：` becomes:
      ```text
      在 `Topic` 之后追加（`Topic` 由 Wave C 的 C05 先落地，C00 §6 #2）；现有 9 个键与 `topic` 的字节保持一致：
      ```
      Pinned: `在 `Topic` 之后追加` (the eight characters 在, space, backtick-Topic-backtick, space, 之后追加).
   c. `:112` (§3.4, the line that begins `` `mcq` 缺席 = Q/A。``) — prepend this clause so the line starts with it and continues with the existing text:
      ```text
      有 `topic`（Wave C C05）时它排在 `revision` 之后、`mcq` 之前；
      ```
      Pinned: `排在 `revision` 之后、`mcq` 之前`.
   d. `:375` (§7 Phase 3) — replace the parenthetical `（card_format + app_version ≥ 1.6.0）` with:
      ```text
      （`card_format = 'mcq'` 且事件信封 `client_features` 含 `'mcq'` 时为 `'mcq'`，否则 `'qa'`；`client_features` / `update_id` 由 C14 的信封字段 `clientFeatures` / `updateId` 落到 outbox payload，Snowflake 用 `array_contains('mcq'::variant, client_features)` 判断——不再看 `app_version`）
      ```
      The rest of the sentence (`user_baseline`, `expected_by_difficulty`, the four Q/A rules, "MCQ · Not Assessed") is unchanged. Pinned: `client_features` present; `app_version ≥ 1.6.0` gone.
   e. Renumbering: `:376` `迁移 019 给快照表加可空列` → `迁移 020 给快照表加可空列`; `:406` `迁移 019` → `迁移 020`; `:429` `迁移 019` → `迁移 020`. Phase 1 row `:402`: `迁移 018` → `迁移 019`, and `（WhenWritingNull，最后一个属性）` → `（WhenWritingNull，`Topic` 之后）`. `:415` becomes exactly:
      ```text
      | DB | 019 迁移一列 | `src_C/Vpc/Db/Migrations/019_cards_mcq.sql` | S |
      ```
      After this the doc contains `迁移 020` three times, `迁移 019` once (on the Phase 1 row), and never `迁移 018`, `018_cards_mcq`, `最后一个属性`.
   f. `:499` — delete the bullet line `     - src_C/Vpc/Db/Migrations/018_cards_mcq.sql` from the `<!-- paths-not-on-disk … -->` block. Do NOT renumber it to 019 (that file exists on your tree; rule (b) would go red). The block's other two bullets and its explanatory line stay; there is still exactly one block.
   Nothing else in this doc changes (the §4.3 cards, §5–§6, §8, §10–§13 are untouched).

2. **`docs/content-delivery-v3.md`** — the contract gains the two optional keys.
   a. `:31` becomes the first line below, and the second line is added directly under it (a nested bullet, indented two spaces):
      ```text
        `{ stableUid, orderInDeck, difficulty, question, explanation, codeLanguage, codeSnippet, realWorldUsage, revision, topic?, mcq? }`
        - `topic?` (string; Wave C 2026-09: server C05, mobile C07) and `mcq?` (object in the MCQ plan §3.2 shape; server C08 → C09) are optional, omitted when null (`JsonIgnoreCondition.WhenWritingNull` on `CardExportData`), appended last in that order. A deck with neither serializes byte-identically to the 9-field shape; the golden `CardJson` in `ContentSerializationContractTests.cs` is unchanged.
      ```
      Pinned: `revision, topic?, mcq? }`, `omitted when null`, `appended last in that order`.
   b. `:50` `ANY of the 9 card fields differing;` becomes:
      ```text
      ANY of the 11 card fields differing (`DeckDiff.CardChanged`: `topic` by ordinal string compare, `mcq` by `DeckDiff.McqEquals` = `JsonNode.DeepEquals`, so PG jsonb spacing alone never marks a card updated);
      ```
      Pinned: `11 card fields`, `DeckDiff.McqEquals`; `9 card fields` gone.
   c. `:111` `→ applies 011.` becomes (bare file names, no directory — they are not citations):
      ```text
      → applies 011; Wave C's `018_cards_topic.sql` (`cards.topic`) and `019_cards_mcq.sql` (`cards.mcq`) are applied as 018/019 via the same runner.
      ```
      Keep the following parenthesis "(Deploy order is safe either way: …)" as is. Pinned: `018/019 via the same runner`.
   The status banner `:3-9` and everything else stay (2026-07 history).

3. **`docs/console-import-plan.md`** — markers, field map, a dated addendum, one acceptance item.
   a. After `:46` (`- orderInDeck = …`) append two rule bullets:
      ```text
      - `TOPIC: <text>`（2026-09 增补，可选，每卡最多一次，紧跟 `## <stableUid> | d<0-4>` 头之后、`Q:` 之前；去空白后 1–80 字符，否则 `BAD_TOPIC`；第二次出现 `DUPLICATE_TOPIC`，以第一条为准）。
      - `OPT: <a–f>[ *]` / `WHY:` / `QUALIFIER:`（2026-09 增补，MCQ 卡：`OPT: a` 开一个选项段、`OPT: c *` 标正确项，每个错误项必须有 `WHY:` 段；`OPT:` 载荷不合法报 `MCQ_BAD_OPT_LINE` 且绝不粘进上一段）。语法与全部校验码见 `docs/mcq-card-type-plan-2026-09-18.md` §4.1–4.5。
      ```
   b. `:44-45` field map: after `USAGE → realWorldUsage` and before the closing `。` add `,TOPIC → topic,OPT / WHY / QUALIFIER → mcq`. Pinned: `TOPIC → topic`, `QUALIFIER → mcq`.
   c. Append a new section at the end of the file (after §四), 6–12 lines, whose heading is exactly:
      ```text
      ## 五、2026-09 增补（Wave C：topic 列 + MCQ 卡型）
      ```
      It states: §范围纪律 `:16` "服务端零改动" was the 2026-08 baseline and stays as history; Wave C changed the server — `cards.topic` (migration 018, C05) and `cards.mcq` (migration 019, C08); the importer's markers (`TOPIC:` C06; `OPT:` / `WHY:` / `QUALIFIER:` C11) with loose marker matching and strict payload validation; issue codes `BAD_TOPIC` / `DUPLICATE_TOPIC` and the `MCQ_*` family, all blocking (the non-blocking warning tier is still Phase 4 / Wave D); `COMPARABLE_FIELDS` order `…, 'realWorldUsage', 'topic', 'mcq'` with `mcq` compared through a normalised JSON string (server `null` == file absent); the runner sends `topic` and `mcq` on create/update (explicit `null` clears) and, when the first MCQ write's echo lacks `mcq`, reports `SERVER_NOT_READY_MCQ` and writes nothing further (protection against migration 019 / the Lambda not being deployed); round-trip order per card `header, TOPIC:, QUALIFIER:, Q:, OPT: (… *), WHY:, A:, CODE:, USAGE:`. Pinned: the heading, `SERVER_NOT_READY_MCQ`, `BAD_TOPIC`, `'topic'`, `'mcq'`.
   d. §四 `:81-87`: after item 4 add:
      ```text
      5. 把 `docs/mcq-card-type-plan-2026-09-18.md` §4.3 的两张示例卡（`aws-sqs-order-buffer-mcq-01`、`aws-s3-compliance-copy-mcq-02`）追加到 AWS 文件 → 预览全绿 → 导入成功；**同一文件再导一次 → 全部 unchanged，零写入**。
      ```
      Pinned: both uids; `全部 unchanged` now appears ≥ 2 times.
   Title `:1`, `:16`, §二–§三 are untouched.

4. **`docs/gacha-acquisition-learning-loop-plan.md`** — two pointer lines, nothing else (numstat exactly `2 0`).
   a. Directly after `:29` (裁决 6) insert one line (three leading spaces so the numbered list is not broken):
      ```text
         > 2026-09-21：裁决 6 已由 `docs/economy-v2-learn-to-earn-2026-09-19.md` §2（R1–R10，学一张赚一抽）替换；本条保留为历史。
      ```
   b. Directly after `:384` (不变量 4) insert one line:
      ```text
         > 2026-09-21：不变量 4 已由 `docs/economy-v2-learn-to-earn-2026-09-19.md` §3 的不变量 4' 替换；本条保留为历史。
      ```
   Result: the pointer for 裁决 6 is the new `:30`, the pointer for 不变量 4 is the new `:386`; `:29` and the old `:384` (now `:385`) are byte-identical. Do not touch the other "full clear" sentences (`:69`, `:300`, `:371`, `:397`, `:507`, `:545`, `:554`, `:574-575` on base) — history.

5. **`mobile/gacha-v7.md`** — one pointer line (numstat exactly `1 0`). Directly after `:94` insert:
   ```text
   > 2026-09-21：经济规则以 `docs/economy-v2-learn-to-earn-2026-09-19.md` §2 为准（rules R1–R10, cap 60+5）；下面 "30 主钱包 + 5 reserve" 一条保留为历史，不再生效。
   ```
   The bullet at old `:98` (now `:99`) stays byte-identical. Pinned on the new `:95`: the economy path, `R1–R10`, `cap 60+5`.

6. **`docs/home-review-and-launch-copy-2026-09-17.md`** — live copy moves to R1/R2/R4; history untouched. Pinned phrases: `learn a new card, earn a pull` (any capitalisation; ≥ 5 occurrences after your edit — 0 today) and `one pull per new card learned`. Recommended wordings (keep them unless a line limit forces a trim; the old strings in parentheses must be gone):
   a. `:159` row becomes exactly (old: "Clear a short daily review, earn a pull"; the length cell must equal the text's `len()` and be ≤ 170):
      ```text
      | Promotional text（≤170） | Two free decks: 81 C# / .NET interview cards, 154 scenario-style AWS SAA-C03 cards. Learn a new card, earn a pull, rip a pack. Never a dupe, never for sale. | 156 |
      ```
   b. `:165` → "…The loop in one sentence: learn a new card, earn a pull, rip a pack, and what you draw becomes what you study." (old: "clear today's 1–5 card review, earn one pull").
   c. `:174` (old: "Fully clear the day's route"):
      ```text
      • Pulls are earned, never sold. Learn a new card, earn a pull: the first time you rate a card Hard, Good or Easy, one pull lands in your wallet, no claim button. Clearing everything due for the day adds one more, once a day. New players start with 3 pulls, so the first pack opens in seconds.
      ```
   d. `:178` (old: 30):
      ```text
      • Your wallet holds up to 60 pulls plus a 5-pull reserve. If you ever have nothing left to study and no pulls, you get 1 pull a day.
      ```
   e. `:204` → "…you can't buy pulls. Learn a new card, earn a pull, rip a pack. Every card is one you don't own yet…" (old: "Finish today's review (1–5 cards), get one pull"); then set the `（N 字符）` count at `:202` to the new `len()` of the quoted body (≤ 280).
   f. `:208` → "…with the actual numbers (60+5 wallet, 10-Common pity, 3 starter pulls, one pull per new card learned). 1/" (old: "30+5 wallet", "1 pull per full clear"); recount `:206`.
   g. `:222` → "…Open a pack, study what you drew, learn a new card, earn the next pull. 1–5 cards a day, …" (old: "clear the route, earn the next pull"); recount `:218` (the `> ` lines of that post, `> ` stripped, joined with `\n`, a bare `>` line counting as empty — 265 today).
   h. `:243` → "…抽数不卖，只能靠学：每学会一张新卡赚一抽（第一次评到 Hard 以上就算学会），清空当天到期再加一抽。卡池里只有…" (old: "每天清完 1–5 张复习就得 1 抽").
   i. `:247` and `:341` → `钱包上限 60 抽 + 5 抽备用` (old: 30).
   j. `:259` → "…抽数买不到，只能靠学会新卡。" (old: "只能靠今天学完那几张").
   k. `:275` (old: "fully clearing today's review"):
      ```text
      - Pulls can't be bought. Learn a new card, earn a pull: the first time you rate a card Hard, Good or Easy, one pull lands, and clearing everything due for the day adds one more, once a day. You start with 3 pulls so the first pack opens in seconds.
      ```
   l. `:279` (old: 30):
      ```text
      - The wallet caps at 60 pulls plus a 5-pull reserve, and if you hit zero pulls with nothing left to study, the app grants 1 a day.
      ```
   m. `:303` → "…they come out of card packs. Learn a new card, earn a pull. Rip the foil, … Pulls cannot be bought; you start with 3 and earn one per new card learned, plus one a day for clearing what's due." (old: "Clear the day's route and you earn one pull", "earn one per cleared day").
   n. `:321` → "…pulls are earned only by learning new cards (you start with 3)…" (old: "earned only by clearing the day's route").
   o. `:323` → "One honest note on pacing: at one pull per new card learned, the deck reveals itself at the pace you actually learn it, not in a weekend. …" (old: "at one pull per cleared day").
   p. `:337` (old: "全部清完得 1 抽"):
      ```text
      - 每天一条 1–5 张的复习路线，按实际到期量生成。每学会一张新卡得 1 抽，清空当天到期再得 1 抽，新手送 3 抽。
      ```
   q. `:364` (video 7–10s row; old: "the route (3 cards) clears", "Clear today's route, 1–5 cards. +1 pull."):
      ```text
      | 7–10s | Review tab. A C# card with a code snippet; thumb taps Good on a new card and the wallet ticks up +1 with no claim button, next card, Easy. | Learn a new card, earn a pull. Pulls can't be bought. |
      ```
   r. `:376` (FAQ) → "…the only ways to get them are learning a new card (+1 each, on its first Hard, Good or Easy), clearing everything due for the day (+1, once a day), the 3-pull starter grant and a 1-pull daily floor when you've run out of both cards and pulls. …" (old: "clearing today's review (+1)").
   s. `:413` row becomes the first line below, and the second line is a NEW row directly after it (old cells "full clear = 1，否则 0" and "1 pull per fully cleared review" are gone):
      ```text
      | 部分完成也给抽 / 每场 2 抽 | R1：每张新卡首次 hard/good/easy +1；R2：清空当天到期卡每天 +1 一次；正确率与 minimumGoal 不改变抽数 | "one pull per new card learned" |
      | full clear +1 / "1 pull per cleared review" | 2026-09-21 起由 R1/R2 替换（`docs/economy-v2-learn-to-earn-2026-09-19.md` §2） | "learn a new card, earn a pull" |
      ```
   Untouched: `:39`, `:52`, `:56`, `:57`, `:79-80`, `:407` (never in your diff, not even as context — edit nothing from `:404` to `:410`), `:411`, `:463`, every other line.

7. **`docs/delivery-wave-1.6-plan-2026-09-19.md:121`** — one line changes (numstat exactly `1 1`): directly after `生产库跑 018/019` insert this clause (with its leading and trailing arrows the line then reads `…后端打包部署 + 生产库跑 018/019 → owner 重跑 Snowflake …）→ 两个卡组重新发布并**字节 diff**…`):
   ```text
    → owner 重跑 Snowflake `snowflake/001_content_intelligence_setup.sql`（C13 改了投影与 mart；views / dynamic tables 都是 create or replace，重跑即生效）
   ```
   Pinned: `owner 重跑 Snowflake `snowflake/001_content_intelligence_setup.sql``.

8. **Landing check (read-only, no edits).** Confirm on your tree and state the result in your PR summary: `mobile/src/features/gacha/constants.ts` has `export const FREE_PULL_CAP = 60;` (C01); `mobile/tests/unit/rewards.test.ts` no longer contains `only full clear earns pulls` (C01 deleted the trio with its comment); `mobile/src/features/gacha/selectors/homeSelectors.ts` contains `Learn a new card to earn a pull` (C03); `mobile/src/features/gacha/rewards/newCardLedger.ts` exists (R5); `018_cards_topic.sql` / `019_cards_mcq.sql` exist; `DeckDiff.cs` has `McqEquals`; `frontend/src/lib/mcqRules.ts` and `mobile/src/sync/clientCapabilities.ts` exist; `snowflake/001_content_intelligence_setup.sql` mentions `client_features`. If any is false, do NOT fix it — report it (the verify's step 1 fails and the driver reads your summary).

## Acceptance

Run from the worktree root; `docs/delivery/r16-issues/C15.verify.sh` re-runs exactly these.

1. The seven scope files exist; the MCQ plan's §3.1 heading names `019_cards_mcq.sql` (fails on base); the landing checks of change 8 hold (C01/C03/C05/C08/C09/C11/C13/C14 merged).
2. Literal guards, per file:
   - MCQ plan: the §3.1 heading line, the `:415` row, `在 `Topic` 之后追加`, `排在 `revision` 之后、`mcq` 之前`, `client_features`; counts `迁移 020` = 3, `迁移 019` = 1 (on the `Phase 1` row), `迁移 018` = 0; none of `018_cards_mcq`, `最后一个属性`, `作为**最后一个**属性追加`, `app_version ≥ 1.6.0`; exactly one exemption block whose entries are exactly `docs/aws-saa-mcq-authoring-guide.md`, `snowflake/002_mcq_marts.sql`.
   - content-delivery-v3: `revision, topic?, mcq? }`, `omitted when null`, `appended last in that order`, `11 card fields`, `DeckDiff.McqEquals`, `018/019 via the same runner`; no `9 card fields`; `:23` (`Client: `mobile/src/content/deckRepository.ts`.`) and `:34` (`Full-download validation requires `deck.json .version === manifest entry .version (buildId)`.`) unchanged.
   - console-import-plan: `` `TOPIC:` ``, `` `OPT:` ``, `` `WHY:` ``, `` `QUALIFIER:` ``, `TOPIC → topic`, `QUALIFIER → mcq`, `## 五、2026-09 增补`, `SERVER_NOT_READY_MCQ`, `BAD_TOPIC`, `'topic'`, `'mcq'`, `§4.1–4.5`, `docs/mcq-card-type-plan-2026-09-18.md`, both §4.3 uids; `全部 unchanged` ≥ 2; the `:16` line verbatim (`- **服务端零改动**:导入走既有 createCard/updateCard/fetchCardsByDeck API。`); the `:1` title verbatim (`# Web 控制台录题/发布优化计划(2026-08)`).
   - loop-plan: numstat `2 0`; new `:30` and `:386` carry `2026-09-21` + the economy path + `裁决 6` / `不变量 4` respectively; `:29` and `:385` are the original lines.
   - gacha-v7: numstat `1 0`; new `:95` carries the economy path, `R1–R10`, `cap 60+5`; `:94` and `:99` are the original lines.
   - launch copy: the 18 old strings gone (listed in the script); `learn a new card, earn a pull` ≥ 5 (case-insensitive); `60+5 wallet`; `one pull per new card learned`; `60 pulls plus a 5-pull reserve` = 2; `60 抽 + 5 抽备用` = 2; the two red-line rows verbatim; the promo length cell == `len()` ≤ 170; the three edited posts' `（N 字符）` == recount ≤ 280; `no AI anywhere` absent from the whole `git diff` output; the history rows never removed; numstat ≤ 27 added / ≤ 25 deleted.
   - wave plan: numstat `1 1`; the `**Wave C 结束你要做的**` line carries the Snowflake clause.
3. docsPaths rules (a) and (b) reproduced in python over the six top-level docs: every backticked top-level path exists or is registered; every registered path is absent; ≤ 1 block per doc.
4. `( cd frontend && npx vitest run tests/docsPaths.test.ts tests/rootReadmePaths.test.ts --reporter=dot )` — exit 0 (skipped with a notice if `frontend/node_modules/.bin/vitest` is absent).
5. Scope + frozen guard: no change outside the seven files (+ `docs/delivery/r16-issues/`); zero diff on the three frozen files and on every code root / manifest; no suppression tokens in the diff; `"vite": "7.2.4"` still pinned; no `@sentry` under `mobile/src`.

## Verify

```bash
bash docs/delivery/r16-issues/C15.verify.sh                 # BASE defaults to delivery/r16-c-economy; the driver exports BASE
( cd frontend && npx vitest run tests/docsPaths.test.ts tests/rootReadmePaths.test.ts --reporter=dot )
```

Runtime ≈ 10 s (+ ~3 s for the vitest pair). No network, no install, no tsc, no dotnet. After the script the driver runs its own gates: the diff-scoped banned-term grep, the secret/suppression scan, and — because top-level docs feed `frontend/tests/docsPaths.test.ts` — the frontend root gate `npm run lint && npx vitest run && npm run build`. A C15 PR that changes anything under `mobile/`, `frontend/src`, `src_C` or `snowflake` fails step 5 before any of that.

## Do NOT

- Do NOT edit `docs/economy-v2-learn-to-earn-2026-09-19.md` (signed; its `[x]` are the wave setup commit), `docs/release-1.6.0-plan-2026-09-19.md`, `snowflake/README.md`, or any file under `mobile/src`, `mobile/tests`, `frontend/`, `src_C/`, `snowflake/`.
- Do NOT renumber the registered `018_cards_mcq.sql` bullet; delete it. Do NOT add exemption blocks anywhere. Do NOT backtick a path that is not on disk.
- Do NOT rewrite history: `:16` of the import plan, the "被修正的原文" quotes, the diagnosis rows F5/F9/F10, the ASCII mock, the loop-plan's other "full clear" sentences, and the whole hunk around launch-copy `:407` stay as they are.
- Do NOT paste the §4.3 example cards, any exam dump text, or any sentence containing one of the six banned terms. Do NOT create a "warning tier", an MCQ mobile UI description, a Sentry mention, or a new eventType/schemaVersion in any doc (Wave D / out of scope).
- Standing rules: no `git push`, no PR, never touch `main`, no deploy / EAS / dotnet / npm install; work only inside your worktree.
