# R23 — `csharp-basics` rebuilt as a .NET 8 / C# 12 interview deck: Specification

Status: owner-approved inputs (2026-10-02). Implementation contract for the generation pipeline and the
prod replacement. Research: `~/.rimv-delivery/r23-common/research-report.md` (+ `research.json`).
Facts below were read on main 8bf9d56 / r22-base d47f168 and in prod on 2026-10-02; file:line where useful.

## Context

- The live C#/.NET deck (`csharp-basics`, deck id **4**, title "C# / .NET", author "system", live build
  `20260926T144909Z-1848aca3`) has 81 cards (`c-001`…`c-081`): 40 interview prompts and 41 "What is…"
  definitions, 0 MCQ, 0 sources, no deck file in the repo (DB only). It is the weakest deck and was the
  first-run default (product review 2026-10-02).
- Owner decisions (2026-10-02, chat):
  1. Rebuild from scratch, junior-to-mid **interview** questions, not concept lectures.
  2. Version baseline **A**: .NET 8 / C# 12. Wording stays version-neutral; only facts that are specific to
     .NET 8 say so. One support-lifecycle card. A .NET 10 / C# 14 delta comes later as a separate round.
  3. About **218 cards in 21 TOPICs** (research §6).
  4. **All 81 old cards are retired** and replaced wholesale; their learner progress lapses.
  5. Publishing is authorized. **All generation runs on the owner's Claude subscription** (headless
     `claude -p`), never the Anthropic API.
- Key external fact: .NET 8 and EF Core 8 reach end of support on 2026-11-10; .NET 10 is the current LTS
  (to 2028-11-14). Interviews in NZ still ask .NET 8-era material; the deck teaches what is true on .NET 8
  and stays true on 10 wherever possible.

## Goals

1. 190–250 cards (target 218): Q/A ≈ 60 %, MCQ ≈ 40 % (accept 35–45 %); junior ≈ 44 % (accept 40–50 %).
2. Every card is an interview question (scenario, trade-off, contrast, code reading), one concept per card,
   correct for .NET 8 / C# 12, and backed by a **verbatim** quote from an official Microsoft page.
3. Every code snippet compiles on the local .NET 8 SDK (8.0.413); every "predict the output" snippet is run
   and its output matches the answer.
4. Every card passes the repo lint, the R23 extra lint, the quote check, two independent verifier passes
   and (for the sampled 10 %) my spot check.
5. The deck goes live as one publish: old 81 soft-deleted, new cards imported, deck metadata updated,
   CDN serving the new build; the repo holds the deck file.

## Non-Goals

- No app code change in R23 (mobile, console, server). The existing-learner bootstrap gap (see State and
  Error Handling) is fixed in R22's fix round, not here.
- No .NET 9/10/11 or C# 13/14 content (later delta round). No Git, cloud, SQL beyond EF-related, Blazor,
  MAUI, WinForms/WPF, gRPC, SignalR, microservices.
- No question text copied or paraphrased from any question bank, book, blog or course. Generators read only
  official pages and this spec.
- No AI QA runtime (AI_QA_ENABLED=0 stays), no auto-publish involvement.

## Current System

| Piece | Fact |
|---|---|
| Deck file grammar | `content/decks/FORMAT.md`; parser `frontend/src/lib/deckImport.ts`, MCQ `mcqRules.ts`, source `sourceRules.ts`. Markers at column 0; blank lines dropped; `SOURCE: <https url>` + quote lines (≤ 1000 chars). |
| Lint | `node frontend/scripts/lint-deck.mts <file>` (needs `frontend/node_modules`); exit 0 = 0 issues. |
| Order numbering | Console import computes `orderInDeck` = 5 for the first card, then index × 10 (`deckImport.ts:361`). |
| Bulk import | `POST /api/v1/authoring/cards/import` (`src_C/Vpc/Authoring/CardsImport.cs`): atomic, ≤ 500 cards, upsert by `(deck_id, stable_uid)`, `orderInDeck` 1…1e8; refuses a payload uid that belongs to a soft-deleted card (409 `SOFT_DELETED_UID`); parks soft-deleted rows that sit on a needed order; refuses a live non-payload card on a needed order (409 `ORDER_CONFLICT`). |
| Retire | `DELETE /api/v1/authoring/cards?id=` (super_admin) sets `is_deleted = 1` (`Cards.cs:394-410`). Publish exports live cards only. |
| Publish | `POST /api/v1/authoring/publish` `{deckId}` (`?mode=preview` returns the export without publishing), then `GET /publish/status?jobId=`; rollback `DeckRollback.cs`. MCQ gate `Publish.FirstMcqGateFailure` (same rules as lint). AI QA gate off (`AI_QA_ENABLED=0`, `AI_QA_REQUIRED=0`). |
| Auto-publish | `AUTOMATION_AUTO_PUBLISH=1` but only for automation runs; human edits and deleted cards route to a human (`AutoPublisher.cs:17-21`). Our manual writes never auto-publish. |
| Prod access | `~/.rimv-delivery/r20-closeout/invoke.py` (direct Lambda invoke `core-vpc:prod` with super_admin claims; `AWS_PROFILE=dev`). |
| Progress of removed cards | Server accepts events for any uid (left join on live cards, `ProgressEvents.cs:445`); mobile Mistake Book skips cards a content update removed (`mistakeBook.ts:226`). |
| Ownership | `resolveEffectiveOwned` = drawn ∪ learned (`effectiveOwned.ts`); `ensureDeckBootstrap` grants 3 pulls only when `owned.length === 0` (`deckWallet.ts:253-281`); daily floor = 1 pull when starved (`economyFloor.ts`). |
| R22 coupling | R22 H02 starter lesson = first 5 **non-MCQ** cards of the goal deck in deck order; R22 goal label ".NET interview questions" → `csharp-basics`. |
| Short title | `mobile/src/content/deckShortTitle.ts` maps `csharp-basics` → "C# / .NET" (unchanged). |
| Tests that read deck files | `frontend/tests/deckImport.source.test.ts:255` and `evals/scripts/export-cards.mts:19` use explicit slug lists (aws, ccdv-f); a new file breaks nothing. |
| Learn pages | One HTML holds every version; blocks carry `data-moniker="aspnetcore-6.0 … aspnetcore-11.0"`. `?view=` only changes which blocks the browser shows. Verified on the middleware page 2026-10-02. |
| Toolchain | .NET SDK 8.0.413 at `/usr/local/share/dotnet`; Node 24; Python 3.8. |

## Proposed Architecture

Control dir `~/.rimv-delivery/r23-common/gen/` (off iCloud). Repo checkout for lint and the PR:
`~/src/recallsmith-sup` (detached at the PR base). Nothing in the generation pipeline writes to prod.

```
topics.json ──► [S0 fetch] ──► sources/
                   │
                   ▼
[S1 outline ×21] ──► outlines/<code>.json ──► [S2 overlap critic ×1] ──► outlines (deduped)
                   │
                   ▼
[S3 draft ×21] ⇄ gate.py (lint · extra lint · quote · snippets · dupes) ──► fragments/<code>.md + ledger/<code>.jsonl
                   │
                   ▼
[S4 verify A (support) ∥ verify B (refute)] ──► verify/<code>.{A,B}.json
                   │ failures
                   ▼
[S5 repair ×≤21] ⇄ gate.py ──► [S6 re-verify changed cards A ∥ B] ──► final fragments (unrecoverable cards dropped)
                   │
                   ▼
[S7 assemble] ──► assembled/csharp-basics.md · ledger.csv · REPORT.md
[S8 spot check (supervisor)] ──► spotcheck.md (redo a topic if > 5 % wrong)
[S9 PR → CI → merge]   [S10 prod replace + publish + verify]
```

### Orchestrator

`bin/gen.py` (python, resumable): each stage per topic is skipped when its output file exists and validates.
Each agent is one headless call:

```
claude -p --model opus --permission-mode dontAsk --output-format json \
  --allowedTools "Read,Glob,Grep,Edit(<gen>/**),WebFetch(domain:learn.microsoft.com),Bash(python3 <gen>/bin/gate.py:*),Bash(python3 <gen>/bin/fetch_sources.py:*)"
```

run with cwd `<gen>`; concurrency 4. Rate-limit handling: back off only when the CLI result has
`is_error` true or stderr names a usage/rate limit (never by scanning card text; R20 lesson), then resume.
Every call's prompt, result JSON and stderr are kept under `logs/<stage>/<code>.*`.

### Stages

- **S0 fetch** (`bin/fetch_sources.py`, deterministic): downloads each URL with a browser UA, keeps the
  article body (`<main>`), drops blocks whose `data-moniker` does not contain the target moniker
  (`aspnetcore-8.0` for `/aspnet/core/`, `net-8.0` for `/dotnet/api/`, `efcore-8.0` when EF pages carry
  monikers; pages without monikers are kept whole), converts to text, and stores `sources/<sha1(url)>.txt`
  plus `sources/index.json` `{url, file, title, moniker, fetched_at, bytes}`. Agents may call it for
  additional learn.microsoft.com URLs; other hosts are refused except `devblogs.microsoft.com` (fallback,
  ≤ 5 cards in the deck).
- **S1 outline** (one agent per topic): input = the topic entry (budget, must-cover concepts, seed URLs),
  the source texts, the card rules (this spec §Data Model). Output `outlines/<code>.json`: one slot per card
  `{uid, kind: qa|mcq, d, level: junior|mid, concept, angle, url, quote_hint, pair_uid?, outdated_ref?}`
  meeting the topic budget exactly.
- **S2 overlap critic** (one agent, barrier): sees every outline's `{uid, concept}`; returns duplicates
  across topics with the topic that keeps each. Supervisor applies it; the losing topic re-outlines only the
  replaced slots.
- **S3 draft** (one agent per topic): writes `fragments/<code>.md` (`# deck: csharp-basics` + cards) and
  `ledger/<code>.jsonl`, runs `gate.py <code>` and fixes until the gate passes (≤ 3 rounds; the remaining
  failures are reported, not hidden).
- **S4 verify** (two fresh agents per topic, no access to outlines or drafter logs): **A — support**: for each
  card, does the quote appear on the page under the 8.0 view, does it support the card's key claim, is the
  answer right for .NET 8 / C# 12, is every starred option correct and every unstarred option wrong for the
  reason its WHY gives. **B — refute**: try to break each card (wrong on .NET 8, ambiguous stem, two
  defensible options, a .NET 9+ API, outdated advice, a snippet that does not do what the answer says,
  low interview value). Output per card `{uid, verdict: pass|fix|reject, defects[], severity}`.
- **S5 repair**: a card ships only when A = pass and B = pass. `fix` → rewrite in place (same uid);
  `reject` → replace with a new card on the same concept or a listed alternate (new uid). Gate again.
- **S6 re-verify**: A and B again on changed cards only. A card still failing is dropped and logged; the
  topic may end under budget as long as the deck stays inside 190–250 and the mix limits.
- **S7 assemble** (`bin/assemble.py`, deterministic): concatenates topics in order 1.1 → 7.1; inside a topic
  d1 Q/A, d1 MCQ, d2 Q/A, d2 MCQ, d3; checks the first five cards of the file are d1 Q/A (R22 starter lesson);
  lints the full file; writes `assembled/csharp-basics.md`, `ledger.csv`, `REPORT.md` (counts per topic,
  kind, level, d, sources per host, snippets by mode, verifier outcomes, dropped cards with reasons).
- **S8 spot check** (supervisor, this session): per topic 10 % of cards, minimum 2, chosen by a seeded random
  draw logged in `spotcheck.md`; each checked against the live page and, for code, the run log. A topic
  with an error rate over 5 % (in practice: any wrong card in a topic of ≤ 20) is re-run from S3.

## Data Model

### Card rules (binding for S1–S6)

| Rule | Value |
|---|---|
| uid | `net-<area>-NN`, two digits, from the topic table (e.g. `net-types-01`). Never reuse `c-NNN`. |
| TOPIC | exactly the label in the topic table (all ≤ 40 chars, ASCII). |
| Difficulty | junior → `d1`; mid → `d2`; `d3` only for mid cards that need two or more interacting constraints (choose-two MCQ, or a trade-off across two mechanisms); `d3` ≤ 15 % of the deck. No `d0`, no `d4`. |
| Q (stem) | ≤ 55 words (target ≤ 40), one concept, phrased as an interviewer would ask: scenario / "what happens if" / "why X rather than Y" / code reading. No "What is X?" definitions unless the answer must give a consequence. No True/False. No "list all…". |
| A (Q/A) | first sentence answers directly (≤ 30 words); whole A ≤ 75 words; mid cards state mechanism → consequence. |
| A (MCQ) | letter-free sentence naming the right choice by content plus the deciding reason, ≤ 60 words. |
| MCQ | 4 options (5–6 only for choose-two/three); every option plausible, similar length, mutually exclusive; WHY on every wrong option (≤ 45 words); no "all/none of the above", no "always/never"; the correct option must not be the strictly longest in more than 40 % of MCQ cards (deck-level); QUALIFIER only for MOST/LEAST/BEST phrasing. |
| CODE | `CODE: csharp`, ≤ 10 non-blank lines; about one card in four carries code. |
| USAGE | one line ≤ 30 words: where this bites in a real codebase or how to say it in an interview. Optional. |
| SOURCE | `https://learn.microsoft.com/en-us/...` (`?view=aspnetcore-8.0` on ASP.NET Core pages, `?view=net-8.0` on API reference pages); quote 1–3 sentences, ≤ 600 chars, copied **verbatim** from text visible under the 8.0 view, and it must support the card's key claim. Fallback host `devblogs.microsoft.com` ≤ 5 cards. No community or vendor sources. |
| Version | No API or syntax newer than .NET 8 / C# 12 (lint deny-list: `JsonSerializerOptions.Web`, `System.Threading.Lock`, `field` keyword, extension members/blocks, `params Span`/`params ReadOnlySpan`, `Task.WhenEach`, `CountBy`, `AggregateBy`, `.Index()`, `HybridCache`, `MapStaticAssets`, `AddOpenApi`, `TUnit`, `Microsoft.Testing.Platform`, `\e`). A .NET 8-specific fact says "in .NET 8" / "since .NET 8" and carries ledger tag `net8`. |
| Contrast pairs | confusable pairs are explicit (`pair_uid` both ways): IEnumerable/IQueryable, Task/ValueTask, record/class, IOptions/IOptionsSnapshot/IOptionsMonitor, Scoped/Transient/Singleton, abstract class/interface, First/Single, `throw;`/`throw ex;`, middleware/filters, tracking/no-tracking. |
| Outdated answers | each of the 17 rows of research §5 is used at least once as a distractor or as the trap a Q/A card corrects (`outdated_ref` = row number). |

### Ledger row (`ledger/<code>.jsonl`, one per card)

`{uid, topic, kind, d, level, concept, angle, url, quote, tags: ["net8"?], pair_uid?, outdated_ref?,
code_mode: "none"|"run"|"compile"|"error:CSxxxx"|"fragment", expected_output?, harness?, harness_kind:
"console"|"web"|"ef"}`.

- `run`: the snippet compiles as top-level statements and its stdout equals `expected_output`, which the
  answer must state.
- `compile`: compiles (warnings allowed, except nullable warnings on cards that claim none).
- `error:CSxxxx`: must fail with that compiler error id (cards asking "why does this not compile").
- `fragment`: compiles once the hidden `harness` code (stubs, usings) is added; the harness is not shown.
- Projects: `console` = Microsoft.NET.Sdk net8.0, LangVersion 12, Nullable enable, ImplicitUsings enable;
  `web` = Microsoft.NET.Sdk.Web net8.0; `ef` = console + Microsoft.EntityFrameworkCore.Sqlite 8.0.x. Template
  projects are restored once; each snippet builds offline (`--no-restore`).

### Topic table (budget = research §6)

| code | TOPIC label | uid prefix | cards | Q/A | MCQ | jr | mid | must cover (outline expands to the budget) |
|---|---|---|---|---|---|---|---|---|
| 11 | `1.1 Types and Memory` | `net-types` | 14 | 8 | 6 | 9 | 5 | value vs reference copy semantics (struct-in-list bug); boxing and where it hides; "structs live on the stack" myth; string immutability and StringBuilder; ref/out/in; passing a reference by value; Equals/GetHashCode contract; const vs static readonly across assemblies; Span\<T\> as ref struct limits; decimal vs double for money; nullable value types |
| 12 | `1.2 OOP and Interfaces` | `net-oop` | 12 | 8 | 4 | 8 | 4 | abstract class vs interface; default interface members (visible only via the interface); virtual/override vs `new` hiding (predict output); sealed; explicit interface implementation; access modifiers incl. internal / protected internal / private protected; constructor chaining; extension method resolution; composition over inheritance; static members/constructors |
| 13 | `1.3 Nullability` | `net-null` | 8 | 4 | 4 | 5 | 3 | NRT is compile-time only; enabled by template default; `!` forgiving dangers; `?.` `??` `??=`; required members vs constructor; `[NotNullWhen]` on Try methods; `is null` vs `== null`; nulls at boundaries (deserialization) |
| 14 | `1.4 Generics, Delegates and Lambdas` | `net-generics` | 10 | 6 | 4 | 4 | 6 | why generics (type safety, no boxing); constraints; variance (`out`/`in`); Func/Action/Predicate; events vs delegates and the unsubscribe leak; closures capture variables (for-loop capture); static lambdas; multicast return value; Func vs Expression\<Func\> |
| 15 | `1.5 Collections` | `net-coll` | 10 | 5 | 5 | 6 | 4 | List growth/capacity; Dictionary key requirements (mutable key bug); HashSet membership; modifying while enumerating; IEnumerable/ICollection/IList/IReadOnlyList in APIs; read-only vs immutable vs frozen (`net8`); TryGetValue vs ContainsKey+indexer; Queue/Stack/PriorityQueue |
| 16 | `1.6 LINQ` | `net-linq` | 14 | 8 | 6 | 7 | 7 | deferred execution (predict output); multiple enumeration; immediate operators; IEnumerable vs IQueryable; First/FirstOrDefault/Single/SingleOrDefault; Select vs SelectMany; GroupBy vs ToLookup; Any() vs Count() > 0; OrderBy+ThenBy; DistinctBy/MaxBy/Chunk; side effects in Select; query vs method syntax |
| 17 | `1.7 Exceptions` | `net-exc` | 8 | 5 | 3 | 5 | 3 | `throw;` vs `throw ex;`; catch only what you handle; exception filters `when`; finally/using guarantees; Try pattern vs exceptions for expected failures; OperationCanceledException; AggregateException from `.Wait()`/`.Result` vs `await`; `ArgumentNullException.ThrowIfNull` |
| 18 | `1.8 Modern C# (10-12)` | `net-modern` | 12 | 6 | 6 | 5 | 7 | primary constructors (parameters are not members on classes; captured state); collection expressions and spread; records: positional, `with` (shallow), record struct; switch expressions, property and list patterns; raw string literals; file-scoped namespaces, global/implicit usings; init-only; **the support-lifecycle card** (LTS vs STS, .NET 8 end of support 2026-11-10, .NET 10 current LTS) |
| 21 | `2.1 Async and Task` | `net-async` | 16 | 10 | 6 | 6 | 10 | what `await` does; `.Result`/`.Wait()` starvation and deadlock; async void; Task vs ValueTask; ConfigureAwait(false) in libraries vs ASP.NET Core apps; CancellationToken flow (RequestAborted); WhenAll vs sequential awaits and exceptions; Task.Run in ASP.NET Core; CPU- vs I/O-bound; eliding async (using/exception pitfalls); IAsyncEnumerable; Task.Delay vs Thread.Sleep; fire-and-forget → BackgroundService/Channel; Parallel.ForEachAsync; timeouts (CancelAfter, WaitAsync) |
| 22 | `2.2 Concurrency and Thread Safety` | `net-conc` | 6 | 4 | 2 | 1 | 5 | lock rules and no `await` inside lock → SemaphoreSlim; Interlocked vs `count++`; ConcurrentDictionary.GetOrAdd factory runs more than once (Lazy); mutable state in singletons; Parallel vs async; Channels |
| 31 | `3.1 GC and IDisposable` | `net-gc` | 10 | 6 | 4 | 5 | 5 | generations and LOH; non-deterministic GC vs IDisposable; using declarations; finalizer cost and Dispose pattern; IAsyncDisposable/await using; managed leaks (events, statics, timers); container-owned disposal; don't call GC.Collect; server vs workstation GC |
| 32 | `3.2 BCL: HttpClient, JSON, Time` | `net-bcl` | 10 | 6 | 4 | 3 | 7 | HttpClient per request (socket exhaustion) vs singleton (DNS) vs PooledConnectionLifetime/IHttpClientFactory; typed clients and singleton capture; System.Text.Json defaults vs web defaults; reuse JsonSerializerOptions (.NET 8 form); JSON source generation; BinaryFormatter disabled (`net8`); TimeProvider (`net8`); DateTime vs DateTimeOffset; WebClient obsolete |
| 41 | `4.1 Hosting, Configuration and Options` | `asp-host` | 10 | 6 | 4 | 4 | 6 | minimal hosting, Startup optional; configuration provider precedence; environments; user secrets dev-only; IOptions/IOptionsSnapshot/IOptionsMonitor; ValidateDataAnnotations + ValidateOnStart; `__` in env var keys; BackgroundService/IHostedService; ILogger message templates vs interpolation |
| 42 | `4.2 Dependency Injection` | `asp-di` | 12 | 7 | 5 | 5 | 7 | why constructor injection; lifetimes; captive dependency + scope validation in Development; scopes in BackgroundService (IServiceScopeFactory); container disposal; multiple registrations, IEnumerable\<T\>, TryAdd; keyed services (`net8`); service locator anti-pattern; transient IDisposable from root; open generics |
| 43 | `4.3 Middleware Pipeline` | `asp-mw` | 8 | 5 | 3 | 3 | 5 | pipeline and order; Use/Run/Map and short-circuit; required order (exception handler, HTTPS, static files, routing, CORS, authentication, authorization, endpoints); custom middleware shape; scoped services in InvokeAsync not ctor; response already started; IExceptionHandler + ProblemDetails (`net8`); middleware vs filters |
| 44 | `4.4 Minimal APIs, Controllers, Filters` | `asp-api` | 12 | 7 | 5 | 6 | 6 | minimal APIs vs controllers; binding sources and one body; `[ApiController]` automatic 400 and inference; IActionResult vs ActionResult\<T\> vs TypedResults/Results\<…\>; MapGroup; endpoint filters vs MVC filters and order; validation in controllers vs minimal APIs on .NET 8 (only if a quote supports it); 201 Created/204/ProblemDetails; route constraints |
| 45 | `4.5 Auth and CORS` | `asp-auth` | 6 | 4 | 2 | 1 | 5 | authentication vs authorization; middleware order; JWT bearer validation (signature, issuer, audience, lifetime); policy-based authorization; CORS is browser-enforced (not API protection); AllowAnyOrigin with credentials refused |
| 51 | `5.1 EF Core Querying and Tracking` | `ef-query` | 14 | 8 | 6 | 4 | 10 | DbContext scoped and not thread-safe; tracking vs AsNoTracking; N+1 and lazy loading; Include/ThenInclude; AsSplitQuery (cartesian explosion); projection to DTOs; when the SQL runs; client evaluation limits; FromSql interpolation vs FromSqlRaw concatenation; ExecuteUpdate/ExecuteDelete; Find vs FirstOrDefault; async query methods; DbContext pooling; migrations vs EnsureCreated |
| 52 | `5.2 Transactions and Indexes` | `ef-tx` | 6 | 4 | 2 | 2 | 4 | SaveChanges is one transaction; explicit transactions across SaveChanges; execution strategy with user transactions; optimistic concurrency tokens; HasIndex/unique and write cost; offset vs keyset pagination |
| 61 | `6.1 Unit and Integration Testing` | `net-test` | 12 | 7 | 5 | 4 | 8 | unit vs integration; xUnit Fact/Theory, instance per test, fixtures; AAA and one behavior per test; test via public behavior (not private methods); what to fake (HttpMessageHandler, not DbContext; EF in-memory provider caveats; real DB/SQLite); WebApplicationFactory + ConfigureTestServices; `public partial class Program`; FakeTimeProvider; async tests return Task; stub vs mock vs fake |
| 71 | `7.1 Design Principles` | `net-design` | 8 | 6 | 2 | 2 | 6 | SRP, OCP, LSP, ISP, DIP (DIP vs DI); repository over EF Core trade-off; dependencies point inward (clean architecture); YAGNI vs premature abstraction (source: learn.microsoft.com architectural principles) |
| | **total** | | **218** | **130** | **88** | **95** | **123** | |

### Deck metadata (set at publish)

- title: **.NET & C# Interview** (short title stays "C# / .NET" in the app).
- author: RecallSmith Team.
- description: "Interview questions for junior to mid .NET developers: C# 12, async, ASP.NET Core 8, EF Core 8 and
  testing. <N> cards, including <M> multiple-choice questions with every wrong option explained. Every card
  quotes Microsoft Learn. Not affiliated with Microsoft." (numbers filled from the final build).

## API and Job Contracts

| Step | Call | Expectation |
|---|---|---|
| Backup | `GET /api/v1/authoring/cards/page?deckId=4&limit=100` (paged) | 81 live `c-*` rows saved to `prod/backup-csharp-basics-<ts>.json` before any write |
| Retire | `DELETE /api/v1/authoring/cards?id=<id>` × 81 | 200 each; afterwards 0 live cards in deck 4 |
| Import | `POST /api/v1/authoring/cards/import` `{deckId: 4, cards: [...]}` built by the **repo parser** from `content/decks/csharp-basics.md` (same fields and `orderInDeck` the console would send) | 2xx, `created` = N, `updated` = 0; one transaction |
| Verify DB | cards/page again | exactly N live rows, uids = file uids, every row has `source`, M rows have `mcq` |
| Metadata | `PUT /api/v1/authoring/decks` (id 4, expected version) | title, author, description as above |
| Preview | `POST /api/v1/authoring/publish?mode=preview` `{deckId: 4}` | `cardCount` = N, MCQ = M, sources = N, no `c-` uid |
| Publish | `POST /api/v1/authoring/publish` `{deckId: 4, note: "R23: .NET 8 / C# 12 interview deck"}` → poll status | job SUCCESS; `decks.live_build_id` changes |
| CDN | manifest + new build's deck.json | manifest points at the new build; deck.json = preview |

Abort rules: if the import fails, restore the 81 rows (PUT `isDeleted: false`; this restore path is dry-run on
a scratch deck first) and stop — the CDN keeps the old build throughout, so learners never see a half state.
After publish, rollback = `DeckRollback` to `20260926T144909Z-1848aca3` plus restoring the 81 rows.

## State and Error Handling

- **Learners who studied the old deck**: their `c-*` progress and Mistake Book entries no longer match a card;
  the Mistake Book already skips removed cards; the server keeps accepting queued events for them (no sync
  stall). Gap: their `drawState.owned` still lists `c-*` uids, so `ensureDeckBootstrap` (needs `owned.length
  === 0`) will not grant the 3 starter pulls and they get only the 1-pull daily floor. Fix (JS-only, in the
  **R22 fix round**, not R23): a pack whose owned uids are all absent from the current deck counts as
  never-drawn for bootstrap. Owner accepted lost progress; this keeps those learners from being stuck.
- **Pipeline failures**: every stage is resumable from disk; a crashed or rate-limited call is retried after
  backoff; a topic that cannot pass its gate in 3 rounds is reported with its failures and re-run after a
  prompt fix, never shipped with a failing gate.
- **Source drift**: quotes are checked against pages fetched during the run; S8 re-opens the live page for the
  sampled cards.

## Security and Privacy

- No secrets in prompts, files or logs; prod calls only from the supervisor via `invoke.py` with `AWS_PROFILE=dev`.
- Generation agents have no prod access, no git push, no network beyond learn.microsoft.com (WebFetch domain
  rule and the fetch script's host allow-list).
- Content licensing: short verbatim quotes with the source URL on every card; no third-party question-bank text.
- No learner data is read or written by R23 except the deck's cards.

## Rollout Plan

1. **R23-0 tooling** (this session): `topics.json` from the table above; `fetch_sources.py`, `gate.py`
   (repo lint + extra lint + quote + snippet + dupes), `assemble.py`, `gen.py`; snippet templates restored;
   self-tests: a moniker fixture (8.0 text accepted, 6.0-only text rejected), a sample fragment with one
   seeded error per gate rule, the three snippet modes.
2. **R23-1 canary**: topics 1.1 and 4.2 through S1–S6; I read **every** card of both; prompts adjusted.
3. **R23-2 full run**: the other 19 topics (S2 runs once all outlines exist).
4. **R23-3 assemble + spot check** (S7, S8; redo topics over 5 %).
5. **R23-4 PR to main**: `content/decks/csharp-basics.md`, `content/decks/csharp-basics.REPORT.md`,
   `content/decks/csharp-basics.ledger.csv`, FORMAT.md §5.3 (C# TOPIC labels), `deckImport.source.test.ts`
   lint list + `csharp-basics.md`, this spec under `docs/`. CI green, then merge (authorized as publishing).
6. **R23-5 prod**: backup → retire 81 → import → verify → metadata → preview → publish → CDN check →
   simulator smoke (1.9.0 release-simulator build: pick the deck, draw, study a Q/A and an MCQ card, source
   shown).
7. **Report** to the owner; memory updated; the .NET 10 delta noted for after 2026-11-10.

## Verification Plan

| # | Check | Pass condition |
|---|---|---|
| V1 | `lint-deck.mts` on the assembled file | exit 0, `N cards, M mcq, 0 issues` |
| V2 | extra lint | 0 violations: word limits, deny-list, always/never, uid/TOPIC/d rules, longest-correct ratio ≤ 40 %, first 5 cards d1 Q/A |
| V3 | budgets | 190 ≤ N ≤ 250; MCQ 35–45 %; junior 40–50 %; d3 ≤ 15 %; each topic within −2/+1 of its budget |
| V4 | quotes | 100 % of quotes found verbatim (normalized whitespace/quotes) in the 8.0-filtered page text; hosts learn.microsoft.com except ≤ 5 devblogs |
| V5 | snippets | every `run` matches `expected_output`; every `compile`/`fragment` builds; every `error:CSxxxx` fails with that id; 0 `skip` |
| V6 | dedupe | no pair within the deck above trigram Jaccard 0.6 on question+answer unless declared `pair_uid` |
| V7 | coverage | every must-cover concept has ≥ 1 card or a logged reason; all 17 outdated rows referenced |
| V8 | verifiers | every shipped card: A = pass and B = pass |
| V9 | spot check | ≥ 10 % per topic (min 2), error rate ≤ 5 % per topic |
| V10 | CI | PR checks green |
| V11 | prod | DB live = N with sources; preview = file; build SUCCESS; CDN deck.json has N cards, M MCQ, 0 `c-` uids |
| V12 | app | simulator: deck opens, Q/A + MCQ render, source link shown, no crash for a state with old `c-*` progress |

## Open Questions

None blocking. Defaults taken (owner may override):
1. The bootstrap fix for old C# learners goes into the R22 fix round (JS-only, same OTA).
2. Deck title ".NET & C# Interview".
3. The .NET 10 / C# 14 delta round is scheduled after 2026-11-10 and needs its own go.

## Decision log

- 2026-10-02 (owner, after go-live): raise the MCQ share. 40 Q/A cards that an independent skeptic agreed make
  good single-answer MCQs were converted in place; explain-why / trade-off cards stay Q/A. Deck mix becomes
  90 Q/A + 127 MCQ (59 percent) instead of 60/40; the deck-level MCQ band for this deck is 55-62 percent.
