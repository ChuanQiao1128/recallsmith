# Deck Markdown format (console import)

The parser is the law: `frontend/src/lib/deckImport.ts` (lexer + `validateCards` + `planImport`),
`frontend/src/lib/mcqRules.ts` (`validateMcq`), `frontend/src/lib/cardRules.ts` (uid, difficulty),
`frontend/src/lib/deckImportRunner.ts` (the write loop). Everything below is derived from those
files as of `main@8a99cc2`; when this document and the code disagree, the code wins and this
document is wrong.

Lint before you hand a file over (zero issues, exit 0):

```
node frontend/scripts/lint-deck.mts <path/to/deck-or-fragment.md>
```

Node 22.18+ or 24 runs the `.mts` directly (this machine: v24.9.0); nothing to install. See §7.

---

## 1. File grammar

### 1.1 Lines, markers, blank lines

- The file is line oriented. BOM is stripped; CRLF and CR are normalised to LF, so reported line
  numbers are the ones your editor shows.
- **A marker is a marker only at column 0.** Any indented line is content, even `  ## x` or
  `  A: not a marker`. That is what lets a code snippet contain such lines.
- **Blank lines carry no meaning anywhere and are dropped**, including inside a `CODE:` body.
  A blank line inside a snippet is lost on import; use a comment line if you need visual space.
- Trailing whitespace on a content line is trimmed. Leading whitespace is kept (indentation in
  code survives).
- A marker with an empty payload (`Q:` alone) opens a section whose body is the following lines.
  `Q: inline text` puts the text on the marker line itself; both are accepted for `Q:`, `A:`,
  `USAGE:`, `WHY:`. `CODE:` and `OPT:` take a *payload* on the marker line (language / key), never
  body text. `TOPIC:` and `QUALIFIER:` are single line markers: the payload is the whole value.
- Marker regexes, all anchored at column 0, tested in this order:
  `## ` (card header; needs a space or tab after `##`, so `###` and `##x` are content) ·
  `# deck:` (case-insensitive, `#deck:` also matches) · `TOPIC:` · `QUALIFIER:` · `OPT:` ·
  `WHY:` · `Q:` · `A:` · `USAGE:` · `CODE:`.
- A `# deck:` line **anywhere** in the file (even inside a card body or code block) is taken as
  the deck header, never as content. Do not write one in a snippet.

### 1.2 File header

```
# deck: <slug>
```

Exactly once, before the first card. Slug: `^[a-z0-9]+(?:[-_][a-z0-9]+)*$`. Missing →
`MISSING_DECK_HEADER` (line 1); empty/blank file → `EMPTY_DOCUMENT`; second one →
`DUPLICATE_DECK_HEADER`; bad slug → `BAD_DECK_SLUG`. The console additionally blocks the import
when the file slug differs from the deck you opened (`slugMismatch`). Live slugs:
`aws-saa-c03` (AWS deck, 154 live cards), `claude-ccdv-f` (planned CCDV-F deck).

Any non-blank line before the first card header that is not the deck header →
`TEXT_BEFORE_CARD` (reported once per stretch). No prose, comments, or headings outside cards.

### 1.3 Card header

```
## <uid> | d<N>
```

- Exactly two `|`-separated parts (`## uid | d2 | extra` → `BAD_CARD_HEADER`, and the body that
  follows becomes `TEXT_BEFORE_CARD` because no card is open).
- `uid`: `^[a-z0-9]+(?:[-_][a-z0-9]+)*$`, max 128 chars (lowercase letters, digits, single `-` or
  `_` between runs; no leading/trailing/double separators, no dots, no uppercase). Otherwise
  `BAD_UID_FORMAT`. Must be unique in the file → `DUPLICATE_UID` on the second occurrence.
  Keep the uid the backlog gives you (`existing_uid` for edits): uid is the only identity that
  survives an edit; renaming = delete + create for learners.
- `d<N>`: literal `d` followed by an integer. Q/A cards: `d0`–`d4`. MCQ cards (any card with an
  `OPT:` / `WHY:` / `QUALIFIER:` line): `d1`–`d3` only, else `MCQ_DIFFICULTY_RANGE`. Rarity on
  mobile is derived from difficulty (`>=3` legendary, `==2` rare, else common). Not `d`-prefixed
  or out of `0..4` → `BAD_DIFFICULTY`.

### 1.4 Sections inside a card

| marker | maps to | required | notes |
|---|---|---|---|
| `TOPIC: <text>` | `topic` | no | single line, once per card; trimmed length 1–80 else `BAD_TOPIC` (card dropped); second → `DUPLICATE_TOPIC` (first wins). Accepted anywhere in the card; convention: first line after the header. Values: §5. |
| `QUALIFIER: <phrase>` | `mcq.qualifier` | no (MCQ only) | single line, once; second → `MCQ_DUPLICATE_QUALIFIER` (first wins). Phrase must appear verbatim (case-insensitive) in `Q:`. Makes the card MCQ. |
| `Q:` | `question` | **yes** | multi-line stem. Empty → `MISSING_QUESTION` (card dropped). |
| `OPT: <a-f>` / `OPT: <a-f> *` | `mcq.options[]` | MCQ | opens option body; `*` = correct. Payload must be exactly one letter a–f (upper accepted, stored lowercase) plus optional `*`, nothing else. Anything else → `MCQ_BAD_OPT_LINE` and the **whole card is dropped**. |
| `WHY:` | `mcq.options[last].why` | for every wrong option | explains the `OPT:` directly above. Before any `OPT:` → `MCQ_WHY_WITHOUT_OPTION`. Second `WHY:` for the same option → `DUPLICATE_SECTION`. |
| `A:` | `explanation` | **yes** | multi-line. Empty → `MISSING_ANSWER` (card dropped). For MCQ it is the letter-free answer sentence old clients show as the card back. |
| `CODE: <language>` | `codeSnippet` + `codeLanguage` | no | language is the rest of the marker line (`CODE: python`, `CODE: json`, `CODE: bash`; bare `CODE:` = no language). Body is the snippet. A `CODE:` with no body is dropped entirely (no snippet, no language). |
| `USAGE:` | `realWorldUsage` | no | multi-line. |

- A *section* is a marker line plus every following non-blank line up to the next column-0
  marker or card header. A card may contain each of `Q:`, `A:`, `CODE:`, `USAGE:` once; a repeat
  → `DUPLICATE_SECTION`, the first copy is kept and the repeat's body is swallowed.
- Lines after the header but before the first section marker → `TEXT_BEFORE_SECTION`.
- Sections may appear in any order; the round-trip (canonical) order is
  `header, TOPIC:, QUALIFIER:, Q:, OPT:/WHY: …, A:, CODE:, USAGE:`. Write them in that order.
- A card is MCQ as soon as it has one `OPT:`, `WHY:` or `QUALIFIER:` line; `shuffle` is always
  true and `v` is always 1 (the format has no marker for either).

### 1.5 MCQ rules (all blocking)

- 3–6 options (`MCQ_TOO_FEW_OPTIONS` / `MCQ_TOO_MANY_OPTIONS`); target 4, use 5–6 only for
  choose-two/three.
- Keys run `a, b, c, …` in **file order** (`MCQ_KEY_SEQUENCE`); a repeated key →
  `MCQ_DUPLICATE_OPTION_KEY` (first wins). Keys are stable ids for analytics, never display
  letters: the app shuffles options every time.
- Option text non-empty (`MCQ_OPTION_EMPTY`), unique case-insensitively
  (`MCQ_OPTION_TEXT_DUPLICATE`), **≤ 600 characters** after trim (server rule
  `MCQ_OPTION_TOO_LONG`; the console does not check it, the lint does).
- No "all/none of the above", no "both a and c" (`MCQ_FORBIDDEN_OPTION_TEXT`): unsafe once shuffled.
- No letter references in `A:` or any `WHY:` (`MCQ_LETTER_REFERENCE`): the regex is
  `\b(?:Option|Answer|Choice)\s+[A-F]\b|\b[A-F]\)\s`: capital letter only, so "answer a question"
  is fine but "Option B", "Choice C", "B) …" are not. Refer to choices by content.
- Correct count = number of starred options: 1, 2 or 3 (`MCQ_NO_CORRECT`,
  `MCQ_TOO_MANY_CORRECT`), and never all of them (`MCQ_ALL_CORRECT`).
- **Choose-N is derived, not declared.** The stem must contain `(Choose two.)` / `(Choose three.)`
  (regex `\(choose (two|three)\.?\)`, case-insensitive) exactly when 2 / 3 options are starred,
  and must not contain it when 1 is starred (`MCQ_CHOOSE_N_MISMATCH`, checked both ways).
  `QUALIFIER:` must not say choose two/three (`MCQ_QUALIFIER_IS_CHOOSE_N`).
- Every wrong option needs a non-empty `WHY:` (`MCQ_WHY_MISSING`); a correct option's `WHY:` is
  optional (omit it: the `A:` line carries the reason).
- `QUALIFIER:` non-empty (`MCQ_QUALIFIER_EMPTY`) and present in the stem
  (`MCQ_QUALIFIER_NOT_IN_STEM`). Use the exam's phrasing: `MOST cost-effective`,
  `LEAST operational overhead`, `MOST secure`, `LEAST amount of change`, …

### 1.6 Every issue code

Blocking means the console refuses to run the import while any issue exists in the file; there
is no warning tier. "Dropped" means the card never reaches the plan (the rest of the file still
parses).

| code | raised when | effect |
|---|---|---|
| `EMPTY_DOCUMENT` | file is blank | blocks |
| `MISSING_DECK_HEADER` | no `# deck:` line | blocks (line 1) |
| `DUPLICATE_DECK_HEADER` | second `# deck:` line | blocks |
| `BAD_DECK_SLUG` | empty or non-slug header payload | blocks |
| `TEXT_BEFORE_CARD` | non-blank line outside any card (also after a rejected header) | blocks |
| `BAD_CARD_HEADER` | `##` line not shaped `## uid \| dN` | card skipped, blocks |
| `BAD_DIFFICULTY` | token not `d<int>` or outside 0–4 | card skipped, blocks |
| `BAD_UID_FORMAT` | uid fails the pattern / >128 chars | blocks |
| `DUPLICATE_UID` | uid seen earlier in the file (message names the first line) | blocks |
| `TEXT_BEFORE_SECTION` | content between header and first marker | blocks |
| `DUPLICATE_SECTION` | second `Q:`/`A:`/`CODE:`/`USAGE:`, or second `WHY:` for one option | first wins, blocks |
| `MISSING_QUESTION` / `MISSING_ANSWER` | `Q:`/`A:` absent or whitespace-only | card dropped, blocks |
| `BAD_TOPIC` | `TOPIC:` empty or >80 chars after trim | card dropped, blocks |
| `DUPLICATE_TOPIC` | second `TOPIC:` | first wins, blocks |
| `MCQ_BAD_OPT_LINE` | `OPT:` payload not `<a-f>` or `<a-f> *` (e.g. `OPT: g`, `OPT: a text`, `OPT: A)`) | **card dropped**, later MCQ issues of that card are not reported |
| `MCQ_WHY_WITHOUT_OPTION` | `WHY:` before the card's first `OPT:` | body swallowed, blocks |
| `MCQ_DUPLICATE_QUALIFIER` | second `QUALIFIER:` | first wins, blocks |
| `MCQ_DUPLICATE_OPTION_KEY` | same key twice | first wins, blocks |
| `MCQ_DIFFICULTY_RANGE` | MCQ card with d0 or d4 | blocks |
| `MCQ_TOO_FEW_OPTIONS` / `MCQ_TOO_MANY_OPTIONS` | <3 / >6 options | blocks |
| `MCQ_KEY_SEQUENCE` | keys not `a,b,c,…` in file order | blocks |
| `MCQ_OPTION_EMPTY` | option body blank | blocks |
| `MCQ_OPTION_TEXT_DUPLICATE` | two options with the same trimmed, case-folded text | blocks |
| `MCQ_FORBIDDEN_OPTION_TEXT` | "all/none of the above", "both a and c" | blocks |
| `MCQ_WHY_MISSING` | wrong option without `WHY:` | blocks |
| `MCQ_LETTER_REFERENCE` | `Option B` / `Choice C` / `B) ` in a `WHY:` or in `A:` | blocks (once per offending text) |
| `MCQ_NO_CORRECT` / `MCQ_TOO_MANY_CORRECT` / `MCQ_ALL_CORRECT` | 0 / >3 / all starred | blocks |
| `MCQ_QUALIFIER_EMPTY` / `MCQ_QUALIFIER_IS_CHOOSE_N` / `MCQ_QUALIFIER_NOT_IN_STEM` | see §1.5 | blocks |
| `MCQ_CHOOSE_N_MISMATCH` | starred count ≠ what the stem's `(Choose two/three.)` implies | blocks |
| `MCQ_OPTION_TOO_LONG` | option text >600 chars (server + lint only) | server rejects the write |

Validator issues are reported at the card's header line; lexer issues at the offending line.
Every card-attributed issue also becomes an `INVALID_CARD` conflict in the plan, so nothing
half-valid can slip through even if the page's error list were ignored.

---

## 2. What the import does with your file

### 2.1 Reconciliation (`planImport`)

- Keyed on `stableUid` only, never on question text or row id.
- uid not on the server → **create**. uid on the server, some comparable field differs →
  **update** (with the server `version` for optimistic concurrency). Nothing differs →
  **unchanged** (no write at all). Re-importing an untouched file is a no-op.
- **A card that exists on the server but is absent from the file is left alone.** The import
  never deletes, never touches, never reorders server cards it does not see. Removing a card
  from the file does nothing; retire cards in the console.
- Conflicts (all block the run): `DUPLICATE_UID_IN_FILE`, `INVALID_CARD`,
  `AMBIGUOUS_EXISTING_UID` (deck already holds two live rows with that uid),
  `EXISTING_SOFT_DELETED` (uid belongs to a soft-deleted row: restore or purge it first).

### 2.2 `orderInDeck` comes from file position: append only

`orderInDeck = (0-based index of the card among the file's structurally valid cards) × 10`.
It is a comparable field, and `(deck_id, order_in_deck)` is UNIQUE in PostgreSQL
(`uq_cards_deck_order`). The runner writes serially, **creates first then updates**, and the API
does not resolve collisions. Consequences:

- A **full-deck file** must list the existing cards in their current server order, unchanged,
  and put **every new card at the end**. Inserting a new card in the middle shifts every later
  card by 10; the create runs first and collides with the existing row at that order (the
  write fails with a DB error and the plan is left half applied).
- A **fragment file** (only your new cards) lints fine but must not be imported on its own into
  a deck that already has cards: its cards would get order 0, 10, 20 … and collide with the live
  rows. Fragments are assembled into the full deck file first (§7.3).
- Editing an existing card in place keeps its position and therefore its order.
- Never reorder existing cards: a reordered file plans one `orderInDeck` update per moved card
  and those updates collide with each other in flight.

### 2.3 "Unchanged" means: no comparable field differs after normalisation

`COMPARABLE_FIELDS = question, difficulty, orderInDeck, explanation, codeSnippet, codeLanguage,
realWorldUsage, topic, mcq`. Text fields are compared after `.trim()` of the **whole value**
(server `null` == `""` == absent); `mcq` is compared as canonical JSON (options sorted by key,
each text/why trimmed, empty why → null, `v` dropped, server `null` == file absence).

So an edit registers only if it changes one of those nine fields: changing wording, difficulty,
topic, an option, a why, the qualifier, the code, the usage all count. Adding or removing blank
lines and trailing spaces does **not** count (the lexer drops them); re-flowing a line break
inside a paragraph **does** count (internal newlines are content); leading/trailing whitespace of
a whole section does not. Renaming a uid is not an edit: it is a create plus an orphaned server
card.

### 2.4 `revision` and `version`

- `version` is the optimistic-concurrency counter; the server bumps it on every successful PUT.
  You never write it.
- `revision` (the number mobile compares with a learner's `lastSeenRevision` to put an
  already-learned card back into the "updated" bucket) is **not touched by the import**: the
  runner never sends it and the server only changes it when the request carries it. After
  importing an edit to an existing card, raise Revision by hand in the console's Edit Card form
  if learners who already learned the card should see it again. Publishing still ships the new
  text either way (the worker's diff compares the content fields as well as revision).

### 2.5 The run

Serial writes in plan order; a failed card is recorded and the run continues; the failure list
can be re-run as is. Optional fields you removed are sent as `""` (and `mcq: null` for a Q/A
card) so a cleared section actually clears on the server. The first MCQ write is probed: if the
API echoes the card without its `mcq` blob the run stops with `SERVER_NOT_READY_MCQ` and the
rest of the file is listed as not written.

---

## 3. Three cards the parser accepts

Together with a `# deck: lint-sample` header these three lint as `3 cards, 1 mcq, 0 issues`
(the file used for the proof in §7.4).

### 3.1 Q/A with `CODE:`

```markdown
## sample-qa-code-01 | d2
TOPIC: D2 Applications & integration
Q:
A Python script calls the Messages API and needs to know whether a reply was cut off by max_tokens or finished on its own. Which field does it inspect, and what value marks the cut-off case?
A:
Read stop_reason on the response. "end_turn" means the model finished; "max_tokens" means the reply hit the limit and is incomplete, so the caller should raise max_tokens or continue the turn. Do not infer truncation from text length or a missing closing sentence: only stop_reason is authoritative.
CODE: python
resp = client.messages.create(model=MODEL, max_tokens=256, messages=msgs)
if resp.stop_reason == "max_tokens":
    # the reply is incomplete: retry with a larger budget
    ...
USAGE:
Log stop_reason next to every generation so truncated answers show up in dashboards instead of in user complaints.
```

### 3.2 Q/A with `TOPIC:` + `USAGE:`

```markdown
## sample-qa-topic-02 | d1
TOPIC: 4.1 Cost-optimized storage
Q:
Nightly database dumps of about 200 GB each must be kept for 90 days and are restored perhaps twice a year, always within a few hours of the request. Which S3 storage class keeps cost lowest without breaking the restore expectation?
A:
S3 Glacier Flexible Retrieval: it is priced for data read once or twice a year and its standard retrieval finishes in 3 to 5 hours, inside the "few hours" window. Glacier Deep Archive is cheaper per GB but its standard restore takes up to 12 hours, so it fails the requirement; S3 Standard-IA is faster than needed and costs more per GB stored.
USAGE:
Pick the coldest class whose restore time still fits the recovery-time objective you actually promised.
```

### 3.3 MCQ, choose two (5 options, 2 starred, qualifier in the stem, every wrong option has a WHY)

```markdown
## sample-mcq-choose-two-03 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: MOST secure
Q:
A team stores customer exports in an S3 bucket. Security requires that objects are encrypted with a key the team controls and rotates, and that no object can be uploaded unencrypted. Which combination of actions is the MOST secure way to meet both requirements? (Choose two.)
OPT: a *
Create a customer managed KMS key with automatic rotation enabled and set it as the bucket's default encryption key.
OPT: b
Enable SSE-S3 default encryption on the bucket.
WHY:
SSE-S3 keys are owned and rotated by S3, not by the team, so the "key the team controls" requirement is not met even though objects are encrypted at rest.
OPT: c *
Add a bucket policy that denies s3:PutObject unless the request specifies aws:kms server-side encryption.
OPT: d
Enable S3 Versioning so an unencrypted upload can be rolled back.
WHY:
Versioning keeps prior copies of an object; it neither prevents an unencrypted upload nor encrypts anything, so it addresses recovery rather than the stated control.
OPT: e
Enable MFA Delete on the bucket.
WHY:
MFA Delete protects object versions from deletion; it has no effect on whether uploads are encrypted or which key is used.
A:
Use a customer managed KMS key with rotation as the bucket default and a bucket policy that denies any PutObject lacking KMS encryption. The key gives the team ownership and rotation; the deny statement makes unencrypted uploads impossible rather than merely unlikely. SSE-S3, Versioning and MFA Delete each solve a different problem and leave one of the two requirements open.
USAGE:
Default encryption sets what happens when a client says nothing; only a deny policy turns "should be encrypted" into "cannot be stored otherwise".
```

Single-answer MCQ: same shape, 4 options, one `*`, no `(Choose …)` in the stem.

---

## 4. Authoring conventions the parser does not enforce

- One paragraph per section. The lexer drops blank lines, so a stem written as two paragraphs
  renders as one; write continuous lines.
- `A:` on an MCQ card is a letter-free answer *sentence* naming the winning choice by content
  plus the discriminating reason; a Q/A-only client shows exactly `Q:` and `A:`.
- `USAGE:` is one real-world line. `CODE:` is for API mechanics (JSON / Python / bash), never for
  prose.
- Difficulty: use the backlog row's `d` / `difficulty` column. Scale (MCQ plan §10): MCQ d1 =
  one fact decides; d2 = two viable designs and the qualifier decides; d3 = several constraints
  or choose-two/three. Q/A: concept and service cards d1–d2, pattern cards d2–d3; d0
  (orientation) and d4 (expert) exist for Q/A only and are rare. Difficulty is rarity on the
  phone, and the analytics snapshot table rejects MCQ rows outside 1–3.

---

## 5. TOPIC vocabulary

`TOPIC:` is a free-text column (≤ 80 chars), but every card in a deck uses exactly one label
from the deck's list below, byte-for-byte, so the phone can group by it. All labels are ≤ 40
characters.

### 5.1 AWS SAA-C03 (`aws-saa-c03`), from `docs/aws-saa-c03-card-backlog-2026-09-19.md` §4

| backlog task (CSV `task` column) | `TOPIC:` label |
|---|---|
| 1.1 Design secure access to AWS resources | `1.1 Secure access` |
| 1.2 Design secure workloads and applications | `1.2 Secure workloads` |
| 1.3 Determine appropriate data security controls | `1.3 Data security controls` |
| 2.1 Design scalable and loosely coupled architectures | `2.1 Loosely coupled architectures` |
| 2.2 Design highly available and/or fault-tolerant architectures | `2.2 HA and fault tolerance` |
| 3.1 Determine high-performing and/or scalable storage solutions | `3.1 High-performing storage` |
| 3.2 Design high-performing and elastic compute solutions | `3.2 Elastic compute` |
| 3.3 Determine high-performing database solutions | `3.3 High-performing databases` |
| 3.4 Determine high-performing and/or scalable network architectures | `3.4 Scalable network` |
| 3.5 Determine high-performing data ingestion and transformation solutions | `3.5 Data ingestion and transformation` |
| 4.1 Design cost-optimized storage solutions | `4.1 Cost-optimized storage` |
| 4.2 Design cost-optimized compute solutions | `4.2 Cost-optimized compute` |
| 4.3 Design cost-optimized database solutions | `4.3 Cost-optimized database` |
| 4.4 Design cost-optimized network architectures | `4.4 Cost-optimized network` |
| D1 service cards (CSV task `D1`; none in the 2026-09-19 backlog) | `D1 services` |
| D2 service cards (CSV task `D2`, "服务卡，未被 task 点名") | `D2 services` |
| D3 service cards (CSV task `D3`) | `D3 services` |
| D4 service cards (CSV task `D4`) | `D4 services` |

Rule: `TOPIC:` = the label of the CSV row's `task` value. A service card whose row says `D2`
gets `D2 services` even when its service is also named by a task.

### 5.2 Claude Developer Foundations (`claude-ccdv-f`): one label per exam domain

| domain | `TOPIC:` label |
|---|---|
| D1 | `D1 Agents & workflows` |
| D2 | `D2 Applications & integration` |
| D3 | `D3 Claude Code` |
| D4 | `D4 Eval, testing & debugging` |
| D5 | `D5 Model selection & optimization` |
| D6 | `D6 Prompt & context engineering` |
| D7 | `D7 Security & safety` |
| D8 | `D8 Tools & MCP` |

---

## 6. Deck files in this directory

- `content/decks/<slug>.md` is the full deck file, the one that gets pasted into the console:
  `# deck: <slug>` once, every live card in server order, new cards appended.
- Fragments written by parallel authors live wherever the wave assigns them and are merged
  into the full file by an assembler that keeps only the first `# deck:` line (§7.3).

---

## 7. Lint tool

### 7.1 Command

```
node frontend/scripts/lint-deck.mts <file.md> [more.md ...]
```

Run from anywhere; paths may be relative to the current directory or absolute. Requires
Node ≥ 22.18 (native type stripping) and `frontend/node_modules` installed (`esbuild` comes with
vite; it bundles `src/lib/deckImport.ts` in memory so the lint always runs the working-tree
parser, never a copy).

### 7.2 Output and exit codes

- One line per issue: `<line>: <CODE> <message>` (line = 1-based line in the file; validator
  issues point at the card header).
- Summary line: `N cards, M mcq, K issues`. `N` counts cards that parsed structurally (a card
  dropped by `MISSING_QUESTION`, `BAD_TOPIC`, `MCQ_BAD_OPT_LINE` … is not in `N`), `M` of those
  carry options, `K` is what must be 0.
- Exit 0 when every file has 0 issues; exit 1 when any file has an issue or cannot be read;
  exit 2 on usage/loader errors.
- With several files, each block is prefixed by `== <path>`.

### 7.3 Linting a fragment

A fragment is a complete, importable file on its own: it starts with `# deck: <slug>` (same
slug as the deck) and contains only cards. That is what makes the lint apply unchanged. The
assembler that builds the full deck file drops every `# deck:` line except the first, appends
fragments after the existing cards, and the full file is linted once more before import
(`DUPLICATE_UID` across fragments can only be caught there).

### 7.4 Proof

```
$ node frontend/scripts/lint-deck.mts …/scratchpad/lint-sample.md
3 cards, 1 mcq, 0 issues                          # exit 0

$ node frontend/scripts/lint-deck.mts …/scratchpad/plan-fixture.md   # §4.3 of the MCQ plan
2 cards, 2 mcq, 0 issues                          # exit 0

$ node frontend/scripts/lint-deck.mts …/scratchpad/lint-broken.md
3: BAD_UID_FORMAT Stable uid "Broken_UID" must be lowercase kebab-case, for example "cs-async-001".
21: MCQ_BAD_OPT_LINE Card "broken-mcq-01": OPT: must be "OPT: <a-f>" or "OPT: <a-f> *" on its own line, got "OPT: g".
1 cards, 0 mcq, 2 issues                          # exit 1
```
