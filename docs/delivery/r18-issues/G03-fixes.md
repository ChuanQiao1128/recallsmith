# G03 fixes — MCP round 6 (issue #506)

Automation release R18A, fix round 6 (wave r18g-t). Base: `delivery/r18g-t` (= `release/r18e` @ 5ac399d).
Paths are relative to the repo root; line numbers are after this change.

### ai-agent-30

Status: fixed (option (a), the MCP side; option (b), a `kind` in `SourceGrounding` routed by
core-vpc, is outside this wave's paths and not needed once the server never submits a local document
in a run).

- `tools/mcp-server/src/ingest.ts:81-92`: `IngestContext` gains `automationRun`.
- `tools/mcp-server/src/ingest.ts:155-160`: inside an automation run `buildIngestArgs` refuses every
  local path, before dc-ingest runs, with
  `SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION: an automation run reads only https sources on its allowed hosts, never a local file`.
- `tools/mcp-server/src/ingest.ts:163-164`: a `canonicalUrl` is held to the same host allowlist as
  the fetched url (`SOURCE_HOST_NOT_ALLOWED`), because dc-ingest cites `canonicalUrl` instead of the
  fetched url (`dc_ingest/core.py:54-55`). Outside a run `allowedHosts` is undefined, so nothing changes there.
- `tools/mcp-server/src/server.ts:132`: `createServer` sets `automationRun` from `automation.runId !== null`
  (a valid `DC_AUTOMATION_RUN_ID`).
- `tools/mcp-server/src/server.ts:287-291`: defence in depth: `submit_draft` refuses, with no API call,
  any card whose `source.url` is a remembered document of kind `local` inside a run
  (`grounding failed: <stableUid>: SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION (…)`).
- `tools/mcp-server/src/server.ts:52`: `MCP_SERVER_VERSION` `1.8.0` → `1.8.1` (tool behaviour and
  descriptions changed, so the tool surface and the gated `authorConfigId` change; a new eval gate follows).
- `tools/mcp-server/src/server.ts:157, 255`: the `read_source` and `submit_draft` descriptions name the refusal.
- Docs: `tools/mcp-server/README.md` (read_source row, Automation runs section: local files are now a
  grounding question, not only an egress one; version line), `.claude/skills/author-cards/SKILL.md`
  step 1 and `tools/author-runner/prompts/queue-item.md` rule 3 (the unattended run reads only https pages).

Tests (fail before the fix, pass after):
- `tools/mcp-server/tests/automationRun.test.ts` › `local sources in an automation run (P3, ai-agent-30)`:
  `refuses a local path in read_source with SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION before dc-ingest runs`,
  `refuses a canonicalUrl whose host is not allowed in an automation run`,
  `refuses in submit_draft a remembered document that dc-ingest read from disk, with no API call`;
  guards that outside a run nothing changes: `still reads a local path outside an automation run`,
  `keeps submitting a remembered local document outside an automation run`.
- `tools/mcp-server/tests/server.test.ts` › `describes what happens to a submitted draft truthfully in both modes (ai-agent-31)`
  (also asserts both descriptions name `SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION`).
- `tools/mcp-server/tests/skillDocs.test.ts` › `says what wins in an automation run …` (new step-1 assertion).
- `tools/author-runner/tests/settings.test.ts` › `tells the agent that the queue item host has no implicit pass`
  (new rule-3 assertion).

Pins updated because the version bump legitimately changes them:
- `tools/mcp-server/tests/server.test.ts` › `reports server name developercards and version 1.8.1` (was 1.8.0).
- `tools/author-runner/tests/helpers.ts:19` (`TEST_TOOL_SURFACE.server.version`) and
  `tools/author-runner/tests/authorConfig.test.ts:91` (`mcpServerVersion`) now `1.8.1`, keeping the
  test stand-in in step with the real server.

### ai-agent-31

Status: fixed

- `tools/mcp-server/src/server.ts:250`: the `submit_draft` description opens with a sentence true in
  both modes: "…; what happens next is the server's decision (outside an automation run a human
  reviews every draft in the review queue before anything is published; inside one, new drafts that
  pass the server's checks and AI QA may be published without a human)." It stays one description.
  It rides the same `MCP_SERVER_VERSION` 1.8.1 bump as ai-agent-30.
- `tools/mcp-server/README.md:3-7, 96`: the intro and the `submit_draft` row no longer say
  "nothing is published" unconditionally.

Tests:
- `tools/mcp-server/tests/server.test.ts` › `describes what happens to a submitted draft truthfully in both modes (ai-agent-31)`.
- Updated assertion: `lists exactly the four DeveloperCards tools` no longer expects `nothing is published`
  in the `submit_draft` description, because the finding makes that claim wrong inside an automation
  run; it still expects `review queue`.

## Contract

- P3 (implemented here): with `DC_AUTOMATION_RUN_ID` set to a valid uuid, `read_source` refuses a
  non-URL source with `SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION` (before dc-ingest runs, which also
  covers `submit_draft`'s one-time read), a `canonicalUrl` off the allowed hosts with
  `SOURCE_HOST_NOT_ALLOWED`, and `submit_draft` refuses a remembered `kind: 'local'` document with
  `SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION`. `MCP_SERVER_VERSION` is `1.8.1`; the new tool surface needs
  a new eval gate before `live`, per the stated rule. No env key, route or table is renamed.
- P1, P2, P4: not touched by this issue (other waves).

## Deviations

- The skill version (`author-cards@1.8.1`) is not bumped for the SKILL.md step-1 edit: the
  `authorConfigId` already hashes every skill file, so the change is gated without a version bump,
  and the brief asks only for `MCP_SERVER_VERSION`.
