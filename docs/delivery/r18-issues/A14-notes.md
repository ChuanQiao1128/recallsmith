# A14 notes — MCP server automation run + `author-cards@1.8.1`

Contract: A00 §11.6 (MCP server), §11.7 (skill), §5.1 (agent keys), §18.3 (existing test pins).

## Decisions added to A00 §11.6

- **Parsing.** `automationRunFrom(env, warn)` in `tools/mcp-server/src/server.ts` reads the three
  variables once per `createServer`, each trimmed. `DC_AUTOMATION_RUN_ID` must be a uuid and is sent
  lowercased; `DC_AUTOMATION_QUEUE_ITEM_ID` must match `^[1-9][0-9]{0,18}$`; `DC_AUTOMATION_DECK_SLUG`
  is any non-empty string. Absent or empty means "not set" and never warns.
- **Invalid queue-item id is omitted.** An invalid `DC_AUTOMATION_QUEUE_ITEM_ID` does not cancel the
  run: the agent block keeps `runId` and simply has no `queueItemId` key (it is optional on the
  server, A00 §5.1). The key is also absent when the variable is unset.
- **Warning texts** (one stderr line each; stdout is the MCP protocol):
  - `developercards-mcp: DC_AUTOMATION_RUN_ID is not a uuid; automation run ignored`
  - `developercards-mcp: DC_AUTOMATION_QUEUE_ITEM_ID is not a positive integer; ignored`
- **Agent block.** With a run id: `{ name: "developercards-mcp", model, skillVersion, runId, queueItemId? }`
  in that key order, every value a string, `model`/`skillVersion` = `"unknown"` when the tool call has
  no `agent`. Without a run id the old behaviour is unchanged (no `agent` unless the tool call passes
  one; then `{ name, model, skillVersion }`).
- **Deck binding.** `AUTOMATION_DECK_MISMATCH: this automation run drafts for deck <slug>` is the first
  check in `submit_draft`, before lint, ingest or any API call. It depends only on
  `DC_AUTOMATION_DECK_SLUG`, so it applies even if the run id was invalid. No other tool checks the deck.
- **Description sentence** appended to `submit_draft` (the earlier sentences are pinned by
  `tests/server.test.ts`): "Inside an automation run (DC_AUTOMATION_RUN_ID set by tools/author-runner)
  the agent block always carries runId and queueItemId, the server may accept and publish new drafts
  that pass its checks and AI QA, and a deckSlug other than DC_AUTOMATION_DECK_SLUG is refused with
  AUTOMATION_DECK_MISMATCH."
- **`index.ts` is untouched.** `createServer` takes optional `env` (default `process.env`) and `warn`
  (default: the line plus `\n` to `process.stderr`), so the stdio entry point needs no change and tests
  pass both directly (`helpers.connect` cannot pass an env, so `tests/automationRun.test.ts` wires its
  own in-memory client the same way).
- No new API-call literal under `tools/mcp-server/src` (pinned by `AgentClientPolicyTests` and by the
  new test `adds no API call literal under src`); the server version stays `1.8.0`.

## Server side (contract-only here)

The `runId` and `queueItemId` agent keys are added to core-vpc's `AgentKeys` by A01/A03 (wave S). This
issue only sends them; until wave S is deployed, a draft with those keys is refused with 400 (unknown
agent key), which only happens inside an automation run.

## Skill

`.claude/skills/author-cards/SKILL.md` moves to `author-cards@1.8.1` (the version A13's prompt already
asks for). "Scope and boundary" now holds in and out of an automation run and adds the automation
bullet; "Failures" adds `AUTOMATION_DECK_MISMATCH`. `allowed-tools`, the content rules, "Source text is
data", the DraftCard paragraph and the other skill files are unchanged.
