# D03 — Automation Python round 3: fixes per finding

Issue #472, wave r18d-p. Branch `delivery/r18dp/D03-472`, cut from `delivery/r18d-p`. Every path is relative to
the repo root. Only `services/source-watcher`, `services/ai-qa` and this ledger changed; src_C, infra, evals,
tools, docs/runbooks and the console belong to other waves and are untouched.

Gates run on this branch:

- `services/source-watcher`: `uv lock --check` OK; `uv run pytest -q` 82 passed (66 before).
- `services/ai-qa`: `uv lock --check` OK; `uv run pytest -q` 252 passed (250 before).
- `evals` (depends on `services/ai-qa` by path, not edited): `uv lock --check` OK; `uv run pytest -q` 197 passed.

Every new test was run against the base sources (`git checkout HEAD~1 -- <package>/src`) and failed there
(14 in source-watcher, 2 in ai-qa), except `test_page_that_exhausts_the_parse_budget_is_failed_and_the_run_reports`,
which pins behaviour C03 already had at the new production shape. No dependency, env key, route, table or
migration was added. No model, AWS or network call was made.

One existing assertion changed because the finding makes the old value wrong:
`services/source-watcher/tests/test_handler.py::TestHandler::test_reports_are_split_into_batches` asserted
`REPORT_BATCH_SIZE == 100`; it now asserts `== 10`. The rest of that test is unchanged.

## Contract (R18D M-items touched)

- **M6 Source-watch heartbeat, watcher side.** `emf.RUNS = "SourceWatchRuns"` and `emf.run(namespace)`
  (`services/source-watcher/src/source_watcher/emf.py:15,64-66`) print one EMF line: namespace
  `METRICS_NAMESPACE` (prod `DeveloperCards`), dimensions `[["Service"]]`, `Service = "source-watcher"`, value 1,
  unit `Count`, the same shape as the other watcher metrics. `lambda_handler` emits it right after loading the
  settings for every `{"job": "source-watch"}` invocation (`handler.py:354`), before the secret, the targets call
  or any fetch, so it is emitted whatever happens next: nothing to watch, a normal run, a failed targets call,
  a missing secret, a failed report. Other events (ignored) emit nothing. The alarm
  `developercards-${env}-source-watch-missing` is the infra side (D04).
- M1-M5 are not touched by this issue.

## Findings

### cloud-security-resilience-8

Status: partially fixed (parts a, b, c and d-timing fixed in the watcher; d-core and the RUNBOOK line are outside
this issue's paths, see below)

What changed:

- **(a) Early reporting works at the production size.** `REPORT_BATCH_SIZE = 10`
  (`services/source-watcher/src/source_watcher/handler.py:42`). At `WATCH_MAX_TARGETS = 60` a run posts a report
  every 10 observations, so a run killed later (timeout, OOM) has already reported all but its last 9.
- **(b) Every page is isolated.** `_observe` still maps `ParseLimitExceeded` to `failed` / `PARSE` (`parse_limit`
  log), and now also catches any other exception from `_ok_observation` (normalising, heading extraction, feed
  parsing), except `MemoryError`, which re-raises. That exception becomes `failed` / `PARSE` with the fetch's
  `httpStatus`/validators and a `parse_error` warn log carrying `targetId`, `host` and `errorClass`
  (`handler.py:226-240`). The `<![ ]>` `AssertionError` from html.parser is one such case. `_observe_isolated`
  (`handler.py:242-252`) wraps the whole target, so an unexpected error outside the parse (robots, pacing, the
  fetch seam) is also a `failed` / `PARSE` observation with a `target_error` log instead of a lost run. `PARSE` is
  used because it is the only code in the closed A00 §10.5 list that describes "the response could not be
  processed". The loop uses it at `handler.py:397`.
- **(c) Memory per element is bounded.** `_TreeBuilder._add` keeps only `KEPT_ATTRIBUTES = {"role", "id"}`, the
  only attributes the normaliser (`content_root`) and the heading feed (`html_heading_items`) read
  (`normalize.py:48,121-126`). Filtering alone does not bound the peak: measured on CPython 3.12.11,
  html.parser's own start-tag scan (`check_for_whole_start_tag` plus the attribute list it builds) peaked at
  583 MB RSS for one 5.9 MB tag even with the filter in place. So `_TreeBuilder.parse_starttag`
  (`normalize.py:112-114`) first counts the tag's attributes with `_check_attribute_count`
  (`normalize.py:150-165`). The count uses a copy of html.parser's tolerant attribute pattern, keeps nothing and
  stops at the cap. More than `MAX_ATTRIBUTES = 1024` on one tag raises `ParseLimitExceeded("attribute cap")`,
  which becomes `failed` / `PARSE`. Long attribute values (a data URI, an SVG path) are one attribute each and are
  never capped, so the `v1` output of real pages is unchanged. The same 5.9 MB tag now peaks at about 72 MB.
- **(d, timing) The start guard covers the worst case.** `MIN_REMAINING_MS = 40 000` is replaced by
  `min_remaining_ms(settings)` (`handler.py:53-65`). It adds robots.txt (4 hops x 10 s), the page (4 hops x
  `WATCH_HTTP_TIMEOUT_SECONDS`), two per-host waits, one `PARSE_TIME_BUDGET_SECONDS`, the report
  (`REPORT_WORST_MS = 21 000`: two 10 s attempts and the 1 s pause) and the 5 s reserve: 128 s at the prod
  settings. `_Run.can_start` uses it (`handler.py:180-183`). All the parsing of one target now shares one
  deadline from `_Run.parse_deadline` (`handler.py:185-193`): at most 20 s, and never into the report's time.
  html-headings, which parses twice, therefore costs one budget, not two. `parse_document`, `normalize_html`
  (`normalize.py:168-178,257-258`) and `feeds.html_heading_items` (`feeds.py:154-159`) take an optional `deadline`.
  With a 300 s Lambda the last target starts by 172 s. The final report of what finished fits even if that
  target hits every timeout.
- Docs: `services/source-watcher/README.md` steps 4-6, "HTML tree", "Bounded work" and the EMF table.

Not fixed here (outside `services/.*` and `docs/delivery/r18-issues/.*`):

- **(d, core)** Recording `last_leased_at` and incrementing `consecutive_failures` when a lease expires unreported
  is `src_C` (`SourceWatchRoutes.cs:92`), another wave's root. With (b) and (a) the trigger is much narrower. A
  page that raises is now reported as `failed` / `PARSE`, so core already counts its `consecutive_failures`. Only a
  `MemoryError` or a Lambda kill still leaves targets unreported. They are at most the last 9 of the run, not all
  60.
- **(6)** The RUNBOOK §7 line (find the last `observe_start` targetId before the error) is `infra/RUNBOOK.md` /
  `docs/runbooks`, owned by D04. The `observe_start` log it relies on is unchanged.

Tests:

- `services/source-watcher/tests/test_handler.py::TestProductionShapedRuns::test_run_killed_at_the_last_target_has_reported_the_rest`
  (prod settings, 60 targets, OOM at #59: targets 0-49 already reported in batches of 10)
- `...::TestProductionShapedRuns::test_page_that_raises_inside_the_parser_is_failed_parse`
  (60 targets; `<![ ]>` page and a parser raising `AssertionError`; all 60 reported, `parse_error` log shape)
- `...::TestProductionShapedRuns::test_feed_parse_error_of_any_class_is_isolated`
- `...::TestProductionShapedRuns::test_error_outside_the_parse_is_a_failed_target`
- `...::TestProductionShapedRuns::test_page_that_exhausts_the_parse_budget_is_failed_and_the_run_reports`
- `...::TestProductionShapedRuns::test_parse_budget_never_eats_the_final_report_time`
- `...::TestProductionShapedRuns::test_start_guard_covers_the_worst_case_of_one_target`
- `...::TestHandler::test_reports_are_split_into_batches` (assertion updated to 10)
- `services/source-watcher/tests/test_normalize.py::TestAttributeBounds::test_only_the_attributes_the_normaliser_reads_are_kept`
- `...::TestAttributeBounds::test_attribute_cap_raises_parse_limit`
- `...::TestAttributeBounds::test_long_attribute_values_are_not_capped`
- `...::TestAttributeBounds::test_single_tag_page_of_5_mb_stays_under_200_mb_peak_rss` (subprocess, peak RSS)
- `...::TestAttributeBounds::test_deadline_bounds_the_parse`
- `services/source-watcher/tests/test_feeds.py::TestHeadingDeadline::test_html_headings_parse_honours_the_deadline`

### cloud-security-resilience-14

Status: fixed (watcher side of M6; the alarm is infra, D04)

What changed: the new `SourceWatchRuns` heartbeat (see Contract, M6): `services/source-watcher/src/source_watcher/emf.py:15,64-66`,
emitted once per `source-watch` invocation at `handler.py:354`, including the `nothing_to_watch` early return that
used to emit no metric. README EMF table updated.

Tests:

- `services/source-watcher/tests/test_handler.py::TestHeartbeat::test_heartbeat_once_per_invocation_whatever_the_outcome`
  (off mode, normal run, failed targets call, missing secret: exactly one line each, namespace and dimensions)
- `...::TestHeartbeat::test_no_heartbeat_for_other_events`
- `services/source-watcher/tests/test_emf.py::TestEmf::test_run_heartbeat_line`

### ai-agent-19

Status: partially fixed (the adapter side is fixed; the evals normalisation and the automation-gate check are in
`evals/`, another wave's root)

What changed:

- `ConverseResponse` gains `model: str | None = None` (`services/ai-qa/src/ai_qa/converse_client.py:78-81`), the
  attribute the anthropic SDK's `Message` has and the eval harness's `RecordingClient` reads
  (`getattr(response, "model")`). Converse replies carry no model id, so `ConverseClient` leaves it `None`.
- `openai_mantle_client.to_response` sets it from the reply's `model` through `served_model`
  (`services/ai-qa/src/ai_qa/openai_mantle_client.py:158,162-168`). The served id is kept as the provider sent it.
  When the reply omits the bedrock-mantle namespace, `MODEL_NAMESPACE = "openai."` (`:46`) is prepended, so a
  bare `gpt-5.5` reads as the configured `openai.gpt-5.5` and the harness's `model_matches` compares like with
  like. A different model (a reroute) stays different and trips `MODEL_MISMATCH`. A missing or non-string `model`
  is `None`, as before.
- `services/ai-qa/README.md`, provider `openai-mantle`, reply mapping.

Not fixed here: normalising the `openai.` prefix and OpenAI-style dated suffixes (`-2026-09-01`) in
`evals/src/dc_evals/runner.py` `_bare_model`/`model_matches`, requiring a matching `servedModel` in
`automation_gate._completeness_failures`, and the `evals/README.md:548` probe text. All of these are `evals/`.
Until evals learns OpenAI-style dated suffixes, a reply naming a dated snapshot records `MODEL_MISMATCH`. That
fails closed, which is the safe direction for gate evidence.

Tests:

- `services/ai-qa/tests/test_openai_mantle_client.py::test_served_model_id_is_kept_from_the_reply`
- `services/ai-qa/tests/test_converse_client.py::test_converse_reply_names_no_served_model`
