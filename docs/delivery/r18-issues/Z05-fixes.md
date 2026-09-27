# Z05 — agent tools round 3: per-finding outcomes

Issue #389 (release 1.8.0 audit fix wave round 3, r18z-t). Paths are relative to the repo root;
line numbers are those on the Z05 branch. Every test is in `tools/mcp-server/tests/` and runs
against the in-memory MCP transport, a fake ingest process and a loopback fake API. Nothing calls
a model or a live API. Z05 touches only `tools/`, `.claude/` and this ledger; the core-vpc (Z01)
and console (Z06) sides of ai-agent-24 are those waves' work under the same contract.

Contract note: the cross-wave contract fixed for this round moves the reviewer grounding from
`drafts[i].grounding` (Y06) into `card.source.grounding = { chunkId, sourceId, matched: true,
quoteChars }`. No route, table, migration or env key changed on the Z05 side.

### ai-agent-24

Status: fixed (MCP server side; the core-vpc persistence and console display belong to Z01 and Z06
under the same contract)

- Root cause on this side: `submit_draft` posted grounding next to `card`, where core-vpc's
  `ParseEntries` drops it, and in a nine-key shape nobody else read. It now posts exactly the
  contract shape inside the card: `tools/mcp-server/src/grounding.ts:39-59` (`SourceGrounding`,
  `sourceGrounding`: `chunkId`, `sourceId`, `matched: true`, `quoteChars` only) and
  `tools/mcp-server/src/server.ts:219` and `:224-240` (each draft entry is
  `{ clientDraftKey, card }` with `card.source = { url, quote, grounding }`; nothing next to
  `card`). `GroundedDraftCard` (`server.ts:19-20`) types the posted card.
- `clientDraftKey` still hashes the card as the agent wrote it (without grounding), so a
  resubmitted card stays idempotent (`server.ts:230-231`).
- Only the server sets grounding: the agent-facing DraftCard `source` schema stays strict
  `{ url, quote }` (`tools/mcp-server/src/draftCard.ts`, unchanged), so a card that already
  carries `source.grounding` is refused before any API call.
- The local-file signal (`kind: 'local'`) is not part of the contract shape, so it moved to the
  tool result the agent gets: each `grounding` entry now has `kind`
  (`grounding.ts:26-37`, `server.ts:217`), and the skill tells the agent to report local-file
  drafts to the user.
- Docs no longer describe behaviour that does not exist: the `submit_draft` description
  (`server.ts:171-172`), `.claude/skills/author-cards/SKILL.md:40` and `:55`,
  `.claude/skills/author-cards/citation-rules.md:8`, and `tools/mcp-server/README.md` (the
  `submit_draft` row).
- Tests:
  - `submitDraft.test.ts` › `sends card.source.grounding in exactly the cross-wave contract shape
    and nothing next to card (ai-agent-24)` (new; fails on the base, which sends a top-level
    `grounding` and no `card.source.grounding`).
  - `submitDraft.test.ts` › `refuses a card whose source already carries grounding: only the
    server sets it (ai-agent-24)` (new; pins that the agent cannot forge grounding).
  - `submitDraft.test.ts` › `resolves the deck slug and posts drafts with a clientDraftKey per
    card`: the expected POST body changed from `drafts[i].grounding` to `card.source.grounding`
    and the result's `grounding` entries gain `kind`. The old assertion pinned the placement this
    finding makes wrong.
  - `grounding.test.ts` › `marks a local-file draft as kind local in the tool result and grounds
    it in card.source (ai-agent-24)` (replaces `sends the grounding of a local-file draft as kind
    local ...`, which asserted the old placement and that `card.source` had only `url` and
    `quote`, both now wrong by the contract).
  - `grounding.test.ts` › `records whether a document came from a local file and builds the
    reviewer grounding from it`: now expects the four-key `sourceGrounding` result.

### ai-agent-29

Status: fixed

- Enforced in Claude Code: `.claude/settings.json` (new, tracked with `git add -f` because the
  root `.gitignore` keeps every `.claude/` path except `skills/` local) has `permissions.deny`
  rules `Read(~/.config/developercards/**)`, `Edit(~/.config/developercards/**)`,
  `Grep(~/.config/developercards/**)`, `Bash(*mcp-tokens*)` and `Bash(*.config/developercards*)`.
- The skill frontmatter gains `allowed-tools` (`.claude/skills/author-cards/SKILL.md:4`): the
  four `mcp__developercards__*` tools, `Task`/`Agent` for the verifier, and `Read` of
  `content/decks/FORMAT.md`, the skill's own files and `sources/`. The prose rule stays as the
  reason and now says how it is enforced (`SKILL.md:31`).
- Enforced in the MCP server: no tool result may name the login token directory.
  `tools/mcp-server/src/credentialGuard.ts` (new) matches the directory (resolved, after
  symlinks, and in `~/` form) as a whole path segment. `server.ts:36-48` `guarded` wraps all four
  tool handlers (`:92`, `:130`, `:158`, `:184`): a successful result that names the directory
  becomes a tool error, and a failure message shows `<login token directory>` instead of the path.
  `tools/mcp-server/src/ingest.ts:184-189` refuses a `dc-ingest` result whose `path` is inside the
  token directory, whatever spelling the path has. `tools/mcp-server/README.md` (security
  section) documents both layers.
- Tests (all in `credentialGuard.test.ts`, new; each fails on the base):
  - `refuses a read_source result whose path lies in the token directory`
  - `refuses any successful tool result that names the token directory`
  - `keeps a sibling directory whose name only starts with the token directory name`
  - `removes the token directory from a failure message`
  - `commits Claude Code deny rules for the token directory`
  - `limits the author-cards skill to the developercards tools, the verifier subagent and its own inputs`
- The existing `readSource.test.ts` refusal tests stay green unchanged.
