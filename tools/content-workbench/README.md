# Content workbench canary

An isolated .NET 10 CLI for frozen, structured Codex subscription requests and deterministic schema checks. This project does not join the root solution, host HTTP, retrieve documents, approve cards, or publish anything. Existing Python retrieval remains unchanged.

## Run

Use `/Users/qc/.dotnet/dotnet` (SDK 10.0.401), not the system .NET 8. From this repository:

```sh
/Users/qc/.dotnet/dotnet build tools/content-workbench/Workbench
/Users/qc/.dotnet/dotnet run --project tools/content-workbench/Workbench.Tests
/Users/qc/.dotnet/dotnet run --project tools/content-workbench/Workbench --no-build -- exec \
  --control-root /absolute/private/control \
  --prompt /absolute/frozen-prompt.txt --schema /absolute/schema.json \
  --output /absolute/private/control/attempts/new-attempt \
  --model gpt-6-sol --run stable-task-run --node stable-node
/Users/qc/.dotnet/dotnet run --project tools/content-workbench/Workbench --no-build -- resume \
  --control-root /absolute/private/control --run stable-task-run
/Users/qc/.dotnet/dotnet run --project tools/content-workbench/Workbench --no-build -- check \
  --control-root /absolute/private/control --run deterministic-run \
  --input /absolute/result.json --schema /absolute/schema.json
```

`exec` requires a fresh output directory under the control root. `--workspace-root` optionally selects a directory under that root; each invocation gets its own empty workspace. Symlinked control/evidence/workspace ancestry is rejected. Without `--run`, the run ID derives from the absolute output path, and `--node` defaults to `model`. Batch callers must supply stable run/node IDs to preserve attempt accounting across new output directories. Model attempts are capped at three per bound node; this tool never retries automatically. Successful existing nodes return `already_produced` after artifact verification and do not call the model again.

`WORKBENCH_ControlRoot`, `WORKBENCH_CodexPath`, `WORKBENCH_Model`, `WORKBENCH_TimeoutSeconds`, and `WORKBENCH_OtlpEndpoint` bind typed options; explicit flags override relevant values. `--timeout-seconds` accepts 1–300; default 300. `--stream true` exercises the adapter's buffered final stream. Exit 0 means produced/already produced/reconciled; 1 means execution/schema failure, 2 means invalid input, lock, evidence, or reconciliation refusal, and 130 means caller cancellation. Diagnostic logs go to stderr; results go to stdout and private files.

## Subscription execution contract

`ICodexExecutor` uses argument arrays and stdin, never a shell command string. It pins the proven `codex-cli 0.155.1`, requires `codex login status` to report ChatGPT, and fixes `gpt-6-sol/high`, `model_provider=openai`, and `forced_login_method=chatgpt`. It never opens authentication/token files, reads API keys, calls a model cloud API, or selects a provider fallback. CLI updates require another capability/permission canary.

User config, rules, project docs, skills, MCP, apps, browser, shell, image, hooks, collaboration, and memory features are disabled. The profile denies root reads, permits the CLI minimal runtime and the empty workspace read-only, and disables worker network. These restrictions apply to model tools; the CLI itself still needs its authenticated subscription transport. Any returned non-message/non-reasoning item is rejected, including tool calls. Runtime event parsing fails closed when the protocol changes.

The `Microsoft.Extensions.AI.Abstractions` `IChatClient` adapter accepts exactly one user message with one text content and an explicit JSON schema. It rejects system/assistant/tool roles, history, multimodal input, metadata, tools, tool modes, sampling/token controls, stateful conversation/background options, raw provider options, and additional properties. Only the pinned model ID and schema format are supported. Streaming waits for a fully completed, validated execution and yields one final update; it does not expose token deltas or partial output.

Each attempt stores `schema.json`, `invocation.json`, original CLI `events.jsonl`/`stderr.log`, and `execution.json`; failures also store `failure.json`. Only an exit-0, exactly completed, tool-free response whose final message matches the output object and passes JSON Schema becomes `result.json`. Temporary/failed outputs are never usable results. Input/schema/result/events/stderr hashes and the runner assembly hash support review. Schema hash covers the actual frozen `schema.json`; CLI schema input strips only whitespace outside its JSON object. Unknown reported model, usage, or process exit is JSON `null`, never invented zero or API cost. Cancellation/deadline kills the entire child process tree; stdout/stderr have bounded capture budgets.

## State and observability

`runs/<id>/controller.lock` is a real OS-backed exclusive file-sharing mutex, tested across processes. It remains held through execution; an elapsed timeout or stale PID does not steal it. Every acquisition advances persisted owner generation/token. Every state mutation rechecks fencing. State uses same-directory temp files, durable file flush, and atomic replacement. This is local single-controller coordination; it does not claim distributed/power-loss transactional durability.

Run state contains frozen node hashes/attempts and prepared, unknown, confirmed, or reconciled-absent action records with stable idempotency keys. Resume queries all prepared/unknown/confirmed model actions against complete local execution evidence, including result/schema/event/stderr hashes, before confirming the node. Missing/ambiguous evidence refuses replay. Subscription CLI has no remote idempotency query: an interrupted call without a completed receipt remains unknown and requires external evidence. The `IActionReconciler` contract and tests demonstrate a simulated remote success before local crash, same-key conflict rejection, remote generation fencing, and confirmed-absent refusal; there is no production remote adapter here.

`ActivitySource`, `Meter`, and `ILogger` emit operation/outcome/failure/duration only, without input/output content, credentials, node/run IDs, or paths in metrics/traces. Private `traces.jsonl` records real success/failure spans. Optional `--otlp-endpoint http://127.0.0.1:4317` enables OTLP traces, metrics, and logs to a loopback collector; public/non-loopback/credential-bearing endpoints are rejected. No collector is launched by this tool. Raw model events remain private local evidence and may contain generated content; they are separate from telemetry and must not be uploaded as public logs.

## Verification and limits

The console contract suite returns nonzero on any failure and covers protocol/schema errors, usage unknowns, environment removal, actual process exit codes, tree cancellation/timeouts, bounded capture, unsupported adapter inputs, buffered streaming, cross-process ownership/crash recovery, stale-owner fencing, atomic-write failure, simulated remote idempotency, frozen-input mismatch, and CLI resume with tamper checks. Fake process tests do not count as model or production evidence.

`scripts/probe-isolation.py --output NEW_PRIVATE_DIR` is a separately authorized diagnostic. It enables shell only for that probe, runs one controlled script against harmless random markers, and requires actual command-event output showing direct/alias/outside reads, workspace writes, and direct-IP network denied by the sandbox. A model's final claim alone cannot pass it. The formal executor never enables shell. Existing probe results do not authorize future material or production writes.

This bounded canary supplies no publisher, PDF access, retrieval, HTTP service, full deck generation, OTLP collector deployment, or workflow heartbeat. It does not write the supervisor's top-level `run.json`.

Official contract references checked for implementation: [IChatClient](https://learn.microsoft.com/en-us/dotnet/ai/ichatclient) and [.NET OpenTelemetry](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/observability-with-otel).
