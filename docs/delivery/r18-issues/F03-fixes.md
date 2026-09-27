# F03 — Tools/evals round 5 (R18F, wave T): fixes

Issue #498. Scope: `evals/`, `tools/`, `docs/delivery/r18-issues/`. The runbook
(`docs/runbooks/automation-operations.md`) is another wave's root and is not touched here.

### automation-35

Status: partially fixed (every part in this issue's paths is fixed; the two runbook edits, parts 2
and 3, belong to the wave that owns `docs/runbooks/` and are not made here)

What changed:

- (1) `evals/README.md:649-679` (Author binding): rewritten to the one rule of
  `tools/author-runner/README.md`. The gated identity is `authorConfigId` over {`argsSha256`, `model`,
  `promptSha256`, `skillSha256`, `skillVersion`}, where `argsSha256` covers the claude arguments and
  the MCP tool surface (N4). The CLI and runner versions and the bundle hash are named as not gated.
  The local `id` is described as a fingerprint the gate does not bind to.
  `evals/README.md:765-773`: the false "core does not yet compare a run's author configuration"
  sentence is gone. The paragraph now lists what core compares at every live auto-accept: the
  reviewer triple, the effective effort (`effectiveEffort`, N2/O1, missing fails closed;
  `REVIEWER_NOT_GATED`) and the author (`agent.authorConfigId`, `AUTHOR_NOT_GATED`, M1).
- (2) The part of the upgrade checklist that sits in this wave's paths:
  `tools/author-runner/README.md:114-128`, a new "Upgrading (after `git pull` on the Mac)" section.
  It says to rebuild `tools/mcp-server` and `tools/author-runner` and then run `status`. It explains
  that without a matching `dist/tool-surface.json` the runner reports `author_config_error`, and that
  a new-facts stratum captured before R18E must be re-produced. The evals README says the same
  (`evals/README.md:667-670`). The runbook section (`automation-operations.md:151-178`) is
  docs/runbooks, outside this issue's allowed paths, so it is not edited here.
- (3) The runner README already lists deleting `runner-state.json` for `runner_held`
  (`tools/author-runner/README.md:228`). The runbook line (`automation-operations.md:258-260`) is
  outside this issue's paths, so it is not edited here.
- (4) `tools/author-runner/src/runner.ts:502`: `item_start` now logs
  `authorConfigId: author.authorConfigId` (the gated id the gate card shows) and
  `configId: author.id` (the local fingerprint). `src/logs.ts` documents the new `configId` field.
  `tools/author-runner/README.md:164-166, 268` describe both.
  The existing assertion `runner.test.ts` (`itemStart.authorConfigId === meta.authorConfig.id`) is
  updated because the finding makes that old behaviour wrong. It now expects the gated id plus
  `configId`.

Tests: `tools/author-runner/tests/runner.test.ts` (the claim → item_start → done test, the
`item_start` assertions); `evals/tests/test_f03_fixes.py::test_evals_readme_states_the_one_regate_rule_without_the_old_one`,
`::test_evals_readme_names_the_fields_the_code_gates_and_the_tool_surface`,
`::test_evals_readme_lists_what_core_compares_at_a_live_auto_accept`.

### ai-agent-24

Status: fixed

What changed:

- `evals/src/dc_evals/automation_gate.py:650-660` (`author_binding` docstring): the old rule is gone
  (a new MCP bundle or CLI/runner version gives a new id and needs a new gate). The docstring now
  states the one rule: any change of `authorConfigId` needs a new gate. It hashes model, skill
  version and files, the prompt and `argsSha256` (claude arguments plus the MCP tool surface, N4). A
  Claude Code or runner update, or a rebuild that keeps the tool surface, changes only the local `id`.
- `evals/README.md:649-679`: see automation-35 (1). It carries the same rule text as
  `tools/author-runner/README.md:271-275`, and says that `argsSha256` carries the tool surface.
- `evals/src/dc_evals/drafts_import.py:19-22` (module docstring): says that `argsSha256` includes the
  tool surface and that `authorConfigId` is the one id the gate binds.

Tests: `evals/tests/test_f03_fixes.py`. It pins the rule sentences in both READMEs
(`test_runner_readme_still_states_the_rule_the_evals_docs_copy`,
`test_evals_readme_states_the_one_regate_rule_without_the_old_one`), the gated field list the evals
README names against the keys `drafts_import.gated_author_config_id` actually reads
(`test_evals_readme_names_the_fields_the_code_gates_and_the_tool_surface`), and the
`author_binding` docstring (`test_author_binding_docstring_states_the_one_regate_rule`). All but the
first failed on the base tree.

### ai-agent-28

Status: fixed

What changed:

- `tools/mcp-server/scripts/buildLib.mjs` (new; `scripts/build.mjs` now only calls it, and
  `scripts/buildLib.d.mts` types it for the tests), `buildMcpServer`:
  - it first deletes `dist/tool-surface.json` (`:38`), so a failure in any later step (either
    bundle, the surface script build, or listing the surface) leaves no surface, and the runner fails
    closed with `author_config_error`. The build itself fails, because the error is not caught.
  - it records `bundleSha256`, the SHA-256 of the `dist/index.js` the surface was listed from, in the
    file (`:70-74`; the key sorts first, so the file stays canonical JSON).
  - it writes through `tool-surface.json.tmp` and a rename, so the file is never half written.
- `tools/mcp-server/src/toolSurfaceHash.ts`: new `ToolSurfaceFile` type. `toolSurfaceSha256` hashes
  only `server`, `tools` and `constants`, so `bundleSha256` never enters the gated id. A rebuild that
  keeps the tools keeps `authorConfigId`, and existing surfaces hash exactly as before.
- `tools/author-runner/src/authorConfig.ts:84-114` (`readToolSurface`): refuses a surface whose
  `bundleSha256` is not the SHA-256 of `dist/index.js`, with `AuthorConfigError` "…tool-surface.json
  does not describe …dist/index.js (rebuild tools/mcp-server)". This covers a stale surface next to a
  new bundle, and a surface from before this change.
- READMEs: `tools/mcp-server/README.md:44-50`, `tools/author-runner/README.md` (Author configuration,
  `author_config_error` row, step 4).
- Test helper `tools/author-runner/tests/helpers.ts` (`writeTestToolSurface`) writes the stand-in
  surface bound to the stand-in bundle, as the build does. Two existing `authorConfig.test.ts` steps
  that rewrite the bundle or the surface now go through it. The assertions are unchanged; the
  fixture needed the new binding.

Tests: `tools/mcp-server/tests/build.test.ts` ("writes the surface the built server lists, with the
SHA-256 of that dist/index.js"; "leaves no surface at all when the surface step fails, never the
previous one next to a new bundle"; "leaves no surface when the bundle step fails");
`tools/mcp-server/tests/toolSurface.test.ts` ("keeps the bundle hash of dist/tool-surface.json out of
the surface hash"); `tools/author-runner/tests/authorConfig.test.ts` ("refuses a tool surface that
does not describe the MCP server bundle next to it (ai-agent-28)").

## Contract

- K1-K7, L1-L6, M1-M6 and N1-N6 are unchanged. The gated `authorConfigId` (M1, N4) is computed
  exactly as before. `bundleSha256` is outside the surface hash, and the evals README and gate
  docstring now describe M1/N4 as the code implements them.
- **O1**: not implemented here (services/ai-qa and src_C are other waves' roots). The evals README
  documents the consequence at live: a QA report without `effectiveEffort` fails closed against a
  gate that recorded one (`REVIEWER_NOT_GATED`).
- **O2**: not touched (frontend root).
- Operator note: after pulling this change, `tools/mcp-server` must be rebuilt, because a surface
  without `bundleSha256` is refused. The runner README's new Upgrading section says so; the runbook
  wave may want to repeat it.
