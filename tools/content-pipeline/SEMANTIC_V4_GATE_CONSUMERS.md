# Semantic v4 gate consumers and equivalence input policy v2

**STATUS: USER-AUTHORIZED VERSIONED IMPLEMENTATION CONTRACT; INDEPENDENT REVIEW AND FULL-CHAIN VALIDATION PENDING.** After the infeasibility finding below, the user explicitly chose to retain complete cases and complete source text and to version the equivalence-only input bound plus actual producer contract. This continues the same Stage C initial attempt, without resetting its implementation/review budget. No real model/content/evaluation/retrieval/isolation calls are authorized. The historical R09 failure and incomplete-source archive remain evidence; they are not erased or relabelled PASS.

The normative v2 sections below narrowly supersede R09's 60000-scalar equivalence bound and the containing schedule representation for explicitly v2-marked equivalence only. All other adoption R01–R17, parent r4, scoring, scope, source/anchor semantics, complete input coverage and external-authority requirements remain mandatory. The original adoption and frozen parent files remain byte-identical. The input policy is a deterministic software limit, **not evidence of actual model context capacity**, which remains UNKNOWN.

## Finding: full fixed-input success is unreachable under R09

Baseline examined: `f22724000ceaf548c10314ee37156c2349fd076e`. The user requires both obedience to adoption R01–R17 and a complete successful synthetic branch through production-pinned inputs. R09 requires each equivalence projection to contain complete original cases, matching adapted cases, corresponding CaseMaps and complete relevant frozen source bodies, with at most three whole cases and full prompt strictly below 60000 Unicode scalars. It explicitly says that if a single whole case cannot fit, the entire schedule blocks; no splitting, dropping or cap increase is permitted.

The actual Stage B implementation enforces this in `trusted_custody_v4._validate_equivalence_scopes`: `build()` constructs those exact fields, then the greedy loop requires a nonempty one-to-three-case choice below the bound. Thus an input-size contradiction cannot be repaired in the Stage C consumer without changing the contract or weakening reviewed Stage B enforcement.

Independent local read-only reconstruction on 2026-10-29 used `prepare_dev_references_v4` against the real original80 bytes and `retrieval-v3/corpus/{chunks.json,sources/*.json}`. Preparation succeeds, retaining 80 cases, 148 required groups, 298 mandatory text fields and 38 optional groups. I independently reproduced the Stage B recursive source-ID union, sorted full source bodies and canonical projection rendering for every singleton, with batchOrdinal=0 to obtain a conservative lower bound. Exactly **23 of 80 singleton projections already exceed 60000**, before instructions. Adding host metadata and a newline adds 103 scalars; real frozen instructions can only increase these lengths. No model call, retrieval, probe, new label or permission write occurred.

| Singleton | Projection scalars (ordinal 0) | Minimum prompt scalars, instructions empty | Source count |
|---|---:|---:|---:|
| cloud-p1 | 116861 | 116964 | 7 |
| cloud-p3 | 153030 | 153133 | 7 |
| cloud-p4 | 61915 | 62018 | 4 |
| cloud-p5 | 79066 | 79169 | 2 |
| cloud-p8 | 62610 | 62713 | 3 |
| identity-p1 | 119252 | 119355 | 5 |
| identity-p2 | 63508 | 63611 | 2 |
| identity-p7 | 183821 | 183924 | 2 |
| identity-p8 | 63602 | 63705 | 3 |
| compute-p8 | 92442 | 92545 | 6 |
| storage-p1 | 68722 | 68825 | 1 |
| storage-p4 | 81380 | 81483 | 2 |
| storage-p7 | 120932 | 121035 | 3 |
| storage-p8 | 80832 | 80935 | 2 |
| databases-p1 | 70599 | 70702 | 2 |
| databases-p2 | 74468 | 74571 | 3 |
| databases-p3 | 98386 | 98489 | 2 |
| networking-p1 | 72040 | 72143 | 4 |
| messaging-p3 | 62798 | 62901 | 3 |
| messaging-p7 | 117527 | 117630 | 4 |
| operations-p1 | 64388 | 64491 | 2 |
| operations-p6 | 74948 | 75051 | 3 |
| operations-p7 | 66089 | 66192 | 1 |

The worker's earlier 183822/98387 figures use a two-digit ordinal; this independent lower-bound calculation fixes ordinal 0 throughout, accounting for the one-scalar difference. The earliest original case, cloud-p1, is already impossible as the first actual batch, so later ordinal choices cannot restore constructibility. Its exact canonical singleton projection SHA256 is `6b94b7d948622c3134fbf1b629b76f837773179ee892703a0a666a0054275bb9`.

Input/source identities independently checked:

| Input | SHA256 |
|---|---|
| Real original evaluation/references.json | `4b97d31214f5634917c82b22d50d1b6f6c004b9a1e78f88ccb18c221e394be24` |
| Actual160 A/B path/hash inventory, canonical A/B then lexical case order | `642cbfbff38134455dbd140d5048266f04e9055178ff91ead42e054c41361181` |
| semantic-v4-adoption-contract.json | `f6231743b5afde9c032ab59d62f77fc2489a20f90007f0545c170c8f78ec7e53` |
| SEMANTIC_V4_ADOPTION.md | `20739387a8a248956ff1ca56ccaad9211b02155ec48e7b94bab6d16782fd9ff8` |
| trusted_custody_v4.py | `bf951392e64b20abd7e94b192b64d39a977f6ee446ab0bcfe110a1a68b57354f` |
| trusted_interfaces_v4.py | `8e3590d5611fa1662e42915298c68afd450e0fe01cc23927c51586b21ac57437` |
| dev_adoption_v4.py | `095a42806ca47c6c68399c030b301288bb0123c6220d34a2af68a3419337a91a` |

Consequences: copying real inputs into Temp retains the contradiction. Fictional80/160 fixtures cannot satisfy the immutable SHA256 pins. Patching constants, replacing registered corpus bytes, returning mocked review/execution PASS, trimming mappings/source text or raising the cap would invalidate a claimed full successful branch. Local helper tests can still pass, but cannot be represented as full Stage C success. This is an offline contract/input incompatibility, separate from missing real source-review, isolation and custody prerequisites.

## Historical choices and recorded resolution

The user permits necessary versioned contract revisions in principle, but also explicitly requires R01–R17, frozen content and complete coverage. That does not resolve which material R09 guarantee may change. The user subsequently selected Choice B. Choice A was not selected. This historical comparison is retained; the concrete v2 sections below now control implementation. No choice claims semantic execution success.

**Choice A — retain the <60000 bound; explicitly version a decomposition protocol.** Replace the whole-case-per-call restriction with a precisely specified finite source/mapping/atom partition and complete recomposition verification. A design must define source-slice provenance/context, exact partition coverage and ordering, joins across required/nested scope and conjunctive anchors, whole-case/optional metadata review, independent two-role schedules, whether any aggregation call is required, and how unresolved cross-partition meaning blocks. All80/148/298/38 obligations remain. A hash manifest or concatenated local PASS cannot by itself prove whole-case semantic equivalence. First produce a deterministic complete schedule with actual input sizes and proof that no semantic obligation is omitted; then independently review the changed semantic guarantees. No truncation, heuristic summaries, ranks or new labels may be introduced.

**Choice B — retain whole cases/full source; explicitly version the equivalence-only input bound and producer contract.** Measure the complete rendered schedule including actual instructions, schema/protocol and host metadata, and define a supported fixed bound for equivalence calls only. Current measurements are lower bounds, not a selected replacement cap. Verify the actual Workbench/CLI/model route can accept and complete that exact producer wire before claiming feasibility; no undocumented model context size or alternate provider is assumed. Proof/readiness and other stage bounds remain unchanged unless separately justified. The current producer has an additional concrete limit: Workbench CodexExecutor.cs checks request.Prompt.Length against 60000 UTF-16 code units; the raw adapter execution_receipt_v4.py requires frozen_prompt length <=60000 Unicode scalars; R09 requires the full prompt strictly <60000 scalars. These units and strictness are distinct. A larger limit therefore needs an explicitly versioned equivalence-only producer, adapter and registry contract change plus affected independent re-review, preserving other purposes' existing bounds. Actual model capacity is UNKNOWN and no model call is permitted in this wave. A larger number in a schema alone does not establish runtime support or semantic correctness. This choice changes reviewed R09/Stage B enforcement and requires affected rules to be re-reviewed.

**Choice C — preserve current contracts and stop Stage C as blocked.** Retain the independent B PASS and the deterministic infeasibility evidence, leave real permissions untouched, and report that full Stage C implementation/success acceptance was not achieved. Do not ship an always-refusing placeholder as completed delivery or silently revise the budget/node.

## Consumer implementation requirements

The following requirements apply to the resumed initial implementation and its independent review. Full success remains unproven until the complete fixed-input fixture traverses every validator.

Public `semantic_gate_v4.py` APIs are `require_dev_adoption_v4(permission)`, `verify_dev_results_v4(configuration)`, and `require_rag_gate_v4(catalogue)`. They load only the fixed trusted root and take no root/hash/authorization override. `_check_snapshot` actually returns `(root,runtime,artifacts)`; registry is in the branded snapshot. Recheck snapshot freshness before returning. DEV acceptance never unlocks cards.

Lower `dev_gate_replay_v4.py` consumes `(root,runtime,artifacts,registry,permission/configuration)` and return actual records, exact metric-wire recomputation and execution provenance. It must not import trusted_interfaces_v4; existing custody `_core()` is already an independent SimpleNamespace. Core selection bridge may import lower DEV replay locally; top public gate imports core plus lower replay, never the reverse. Lower holdout replay likewise remains independent of top/core. This prevents an inventoried import cycle.

The complete DEV consumer still needs R01–R17: original80/160 and provenance pins, full candidate/map/source equivalence, exact A/B wrappers and historical/current identities, external authority, all raw six-file executions, rebuilt proof prompts and complete subsets, raw-to-Check equality, ledger links, exact group/case/theme coverage, all rational metrics and smaller-radius selection tie rule. Reuse existing prepare_dev_references, compact_schedule, replay_group, metric_wire, registry and custody predicates without promoting their diagnostic flags to semantic authority.

Full holdout consumption needs more than existing custody booleans: independently rebuild released private author/checker/novelty input projections and prompts, decode their raw outputs, compare sealed labels/reviews and old80 novelty coverage, check all anchors/source quotes and actual execution identities. Existing `_released_executions` already verifies six-file/event integrity and observed replay actions, but does not implement that semantic input/output reconstruction. A future minimal private producer wire must keep generated labels out of the author input; a predeclared source/slot plan is one proposal, not an existing capability. No production private labels were accessed for this assessment.

Other concrete closure work: parent Packet has no candidate-queue storage field, so deterministic holdout packet reassembly needs a versioned, fixed, externally registered queue artifact protocol rather than an invented parent field; registration/canary/freeze bindings must remain complete. Both A/B DEV results, canary and private/public holdout executions need one global actual call/workspace/output identity census. Readiness must replay all40, compare every raw decision and require8 correct negative refusals, <=1 false refusal, zero unsupported/wrong-deployment acceptance plus exact9/10 and3/4 semantic thresholds.

Author/batch dispatch must detect the fixed registered v4 cycle independently of caller version fields, reject legacy-path/version-deletion downgrades, and preserve complete curriculum hash, full goal, original retrieval query and complete corpus/evidence checks. New modules/templates/schema/tests/protocols must enter finite acyclic runtime closure; receipts/results/manifest/run-state must not hash themselves. Core changes require affected B re-verification.

Conditional worker split remains disjoint: DEV worker owns lower adoption/results replay and minimal core selection/runtime inventory; full gate worker owns top API, lower holdout/private replay, author/batch integration and full tests. Architecture owns this document. When infeasibility was established, the DEV worker had already written two incomplete, unverified files: a modified trusted_interfaces_v4.py and a new dev_gate_replay_v4.py. The supervisor archived both files and their patch under C/evidence/v4-timing-gate-wave-20261029/r09-constructibility/incomplete-unverified-source, restored tracked trusted_interfaces_v4.py exactly to reviewed HEAD f22724000ceaf548c10314ee37156c2349fd076e, and removed only the worker-created new module. At that pause the active workspace retained this proposal document only; those archived edits were not implemented or reviewed Stage C delivery. The later user-authorized v2 work resumes the same initial attempt from the restored baseline, with any reused archived work still requiring current verification. The trusted_interfaces_v4.py hash in the table is the restored reviewed file, not the earlier incomplete worker version. No successful full-chain fixture, gate PASS, new labels, model calls, source-review retry, production authorization or Git/control-state writes are claimed here.

## Normative equivalence-only v2 dispatch

The fixed policy artifact is `R/tools/content-pipeline/semantic-v4-equivalence-input-policy-v2.json`, with exact closed field/value equality to this version. It defines purpose=`dev-equivalence`, inputPolicyVersion=`dev-equivalence-input-v2`, maximum prompt scalars **strictly below200000**, maximum UTF-16 code units **strictly below200000**, at most3 complete cases and exact template/schema refs. These are constants, never caller-provided numeric settings. Reject unsupported policy versions, unknown fields, policy-purpose mismatch, or duplicate policy entries. All non-equivalence purposes retain their current60000 limits and stricter stage predicates. Output/schema/file-size limits are not increased by this policy.

The reviewed runtime manifest must contain exactly one entry at each of these actual fixed paths and roles:

| File under tools/content-pipeline | Category | Role |
|---|---|---|
| semantic-v4-equivalence-input-policy-v2.json | protocol | equivalence-input-policy |
| equivalence-instructions-v2.txt | prompt | equivalence-instructions |
| semantic-v4-equivalence-output-v2.schema.json | schema | equivalence-output-schema |
| semantic-v4-equivalence-schedule-v2.schema.json | schema | equivalence-schedule-schema |

Policy references the exact instruction/output-schema/schedule-schema raw hashes. Its runtime dependencies are those files, ordered before the policy. Schedule instances reference the policy, never the reverse. All actual consuming source/producer/binary/test dependencies and this document enter runtime identity. No manifest, schedule instance, output, authorization or receipt becomes its own dependency. Any change invalidates affected current reviews/proofs; native B re-verification is performed on current C bytes without resetting historical B counts.

The standalone schedule schema is a complete closed copy of EquivalenceSchedule with only required `inputPolicyVersion`=`dev-equivalence-input-v2`, required `inputPolicy` ArtifactRef and promptScalarCount.maximum=199999 added/changed. The inputPolicy ref equals the unique fixed registered policy file. This is an explicit local alternate schedule dispatcher, not an `allOf` extension of a closed parent and not a rewrite of the adoption schema. Missing policy marker selects the old closed schema and59999 maximum, never automatic upgrade. The actual finalized v2 consumer requires the v2 marker and fixed refs. Other adoption record shapes remain unchanged, including exact whole-case EquivalenceProjection and EquivalenceBatchOutput.

Actual prompt bytes are exactly:

```
UTF8(equivalence-instructions-v2.txt)
+ UTF8(pipeline.canonical({batchOrdinal, projectionHash}))
+ UTF8("\n")
+ UTF8(pipeline.canonical(projection))
```

There is no extra separator before metadata; the template's existing final newline is part of its bytes. projectionHash is SHA256 of canonical projection UTF-8 bytes alone, with no self-hash. Role is host metadata only; both role streams receive identical prompt/schema bytes. Schema is the exact standalone output file bytes, passed separately as schema, not appended to the prompt. Rebuild greedy maximal contiguous batches of1..3 original-order complete cases using both string metrics; preflight the entire schedule before any execution. Count Unicode scalar values and UTF-16 code units independently, reject invalid Unicode, and test supplementary-plane boundary differences. A singleton at either cap blocks; no truncation or cap escalation.

Measured offline against actual immutable80 and complete corpus with these exact files: instructions1696 scalars, SHA256 `cd9eb20d7f941dfe8be7c3f1e3f5b2c68a52fdf5d930e5703a5e5fd9668b242f`; standalone output schema3588 bytes, SHA256 `ec36f3c012df09117ca12f7acf7383b54ffec43aa7c5050dbdac45559635db3b`. All80 singleton full rendered inputs were measured; maximum185620 scalars/UTF-16 (identity-p7). Greedy whole80 partition has30 batches, maximum193929 scalars/UTF-16 (ordinal4: cloud-n2, identity-p1, identity-p2). Thus the fixed200000-exclusive software bound accommodates this exact schedule. This is not real producer/model acceptance or semantic PASS.

### Actual producer and raw receipt contract

The Workbench FrozenRequest/CLI supports an explicit **named** policy selection, not an arbitrary numeric limit. The v2 invocation requires both `purpose=dev-equivalence` and `inputPolicyVersion=dev-equivalence-input-v2`; the proposed explicit CLI spellings are `--purpose dev-equivalence --input-policy-version dev-equivalence-input-v2`. Both must be supplied together, verified before launch, and match the registered purpose. Only this exact pair enables the fixed v2 bound. Default requests keep original behavior. A generic JSON/header/environment number must never select a larger bound.

For v2 the actual invocation.json closed raw shape is the exact historical field set plus these two fields, with exact constants. Default/legacy invocations retain the exact historical field set, rather than adding null fields to every old receipt. Missing/partial/wrong markers reject v2 consumption; old raw receipts cannot be automatically promoted to v2, including a small old receipt replayed through the new semantic consumer. The Workbench's actual string-length check must explicitly enforce the v2 UTF-16 bound and Unicode scalar bound. Existing model/effort/subscription/tool-free route remains unchanged; reportedModel=null and HOST_RECORDS_ONLY keep their original meanings.

The pure raw checker may receive an internally derived enum/named policy, never a numeric cap or an environment override. Its default remains the old exact shape/bound. Registry consumption derives the v2 mode only from purpose dev-equivalence, the unique current fixed manifest policy/template/schema and exact v2 schedule; it verifies raw marker equality, actual prompt/schema hashes, full rebuilt input scope and A<S<=O before accepting execution. All five public purposes and all released private purposes retain their separate authorization/scope checks. No raw self-declared marker supplies authority. Public gate APIs do not expose this internal policy selector or new roots/hashes.

## Concrete replay closure and ownership

DEV lower APIs are `replay_dev_adoption_v4(root,runtime,artifacts,registry,permission)` and `replay_dev_results_v4(root,runtime,artifacts,registry,configuration,adoption=None)`. Result return includes `record`, `metrics` and `provenance`; metrics is exactly `{cases:{caseId:Metrics|None},macro:Metrics,perThemeRecall:{theme:Fraction}}` expected by metric_wire_v4. Adoption returns verified actual record/references/cases/inventory/consumer/provenance as internal reusable data. Internal adoption reuse must be bound to the same validated snapshot. These APIs are not public trust anchors.

Historical frozen-plan beforeHashes may mention old code later changed under current implementation. Do not equate that historical code identity with fresh consumer identity. Exact historical provenance files and the immutable160 digest bind original plan/trace/queues; verify unchanged corpus/reference/map provenance where applicable, keep distinct current proofConsumer identity, and do not execute historical retrieval or manufacture missing provenance through current code.

For every positive DEV/holdout group, compare decoded raw output expanded via existing proof transport with the stored Check, including exact scope/hash/Execution fields. Every ledger subset points to the exact correct role/batch Check; check both roles, every nonempty subset, all mandatory atoms and exact quote offsets. Recompute all completions/witnesses, cases, exact macro/theme metrics and selection. Negatives have no proof, null metrics and empty completions. Global actual execution identity census spans both configurations, equivalence, canary, private stages, holdout proof and readiness; repeated use of a batch Check by its subsets is not a new execution.

Full gate must rebuild canary and holdout readiness from raw reader/judge receipts and compare every stored per-case result and Execution link. Verify current reviews, unchanged identity, registration/profile/map, selection/freeze, denial/termination, seal/claim/unique unseal and released inputs. Recompute exact holdout thresholds/counts and compare gate refs/values/verifierImplementationHash before rechecking snapshot freshness. DEV adoption and summary JSON never unlock card generation.

### Minimal private replay wire, no actual producer execution

This consumer wire specifies how future released bytes can be verified. It does not assert any trusted private producer exists. Only synthetic40 fixtures may be created this wave.

Fixed released author plan: `E/holdout/seal-evidence/author-plan.json`, closed `{version:"private-label-plan-v1",batches:[{batchOrdinal,slots:[{id,module,answerable}],sourceIds}]}`. Slots are exact40 canonical theme order cloud/identity/compute/storage/databases/networking/messaging/operations, within theme p1..p4,n1; at most3 complete new target slots per author batch, ordered and covered once. sourceIds are sorted unique complete frozen source bodies selected before output; plan has no generated label/question/rank/result fields. It is root registered after release and bound by original raw prompts. No new SealManifest field is invented.

Private projections use version=`private-label-input-v1`, actual role and global role-local contiguous batchOrdinal. Author input is exactly `{version,role,batchOrdinal,slots,sources}` with source bodies `{sourceId,sourceVersion,text}`. Author output is closed `{cases:[parent Reference]}`; full decoded case values equal sealed labels in order. Checker input is `{version,role,batchOrdinal,cases,sources}`, using actual author cases and same declared full source bodies; output `{cases:[{caseId,verdict,reason}]}` must cover exact cases and allPASS, with nonempty reasons. Every anchor quote must belong to declared sources and validate complete atoms/scope; checker cannot edit labels. Rebuild fixed source-only instruction+canonical projection and exact indent2 UTF-8 emitted output schema; compare all actual raw bytes/events/runtime/identities and assembled parent reference-review fields.

Novelty compares at most3 NEW target cases against every original80 case. Original80 complete case objects total309102 canonical scalars, so they cannot be placed in a single60000 prompt. Partition OLD comparison context into greedy maximal contiguous whole-case prefixes fitting the unchanged private prompt bound; old context is comparison input, not additional new targets. Iterate target batches then old prefixes with contiguous global novelty ordinals. Projection is `{version,role,batchOrdinal,cases,old80}` with exact complete targets and old-prefix objects. Raw output is `{cases:[{caseId,verdict,comparedOldIds,reason}]}` in target order, comparedOldIds exactly the current old-prefix IDs. Every new/old pair occurs once; full target once-per-old80 coverage and allPASS are mandatory before assembling per-target novelty acceptance. No old-case truncation, summary or tuple-only substitution. The input is source-only observed labels, never retrieved packets or rankings.

Because frozen parent NoveltyReview has a single Execution per case while comparison can span batches, that field binds the first actual novelty execution for that case; it is a representative binding only, never sufficient coverage. Full acceptance additionally requires every expected released raw batch in ReleasedSeal.executions, exact per-case union of all80 IDs and deterministic assembly of reasons in raw batch order. Omission of any batch/old comparison rejects even if the parent summary and first execution remain unchanged. This narrow assembly rule does not relax complete raw replay. Raw author/checker/novelty identities remain disjoint from each other and every public execution. All private prompts stay below60000 scalars and within producer UTF-16 limits; oversized input blocks.

### Holdout packet and author integration

Parent Packet has no queues field. Use a specific fixed registered queue companion `E/holdout/queues/{caseId}.json`, closed `{caseId,queryEn,configuration,profile,map,queues}`: profile/map are exact current selected ArtifactRefs, configuration is selected A/B and queues is the complete frozen ordered input accepted by existing pure pack. Recompute query plan from original admitted query and deterministic pack from these saved queues/current frozen structural map, without invoking retrieval. Complete original corpus chunks/order and every identity binding remain mandatory. Register exact companion bytes in root; never insert new fields into parent Packet.

Top author/batch dispatch detects fixed v4 registration independently of caller version flags, rejects deletion/legacy-path/adoption downgrades, and preserves complete catalogue-body curriculum hash, full goal including learning objectives, original retrievalQueryEn and original evidence validation. Final gate is necessary but does not replace goal/curriculum/corpus checks.

DEV worker exclusively owns lower DEV, core/runtime inventory, custody, raw adapter, Workbench request/CLI/producer changes and their tests. Full worker owns top gate, lower holdout/private replay, their tests and narrow author/batch integration. Architecture owns this document and the four fixed policy/template/schema files. Coordinate core inventory changes through DEV worker; do not overlap writes. Complete immutable80 success through real validators and Temp raw bytes remains mandatory, with consistently rehashed logical rejection mutations. Policy-fit measurements alone are not full success. No production C permissions, real labels, model calls, source-review retries or Git/control-state writes are performed by workers.

### Bounded metadata capacity and source DAG

Versioned C integration may raise only the fixed `C/run.json` root-metadata stable-read limit from2000000 to16000000 bytes when the actual complete fixture inventory demonstrates the old limit is insufficient. This finite fixed limit matches existing runtime-manifest/registry read bounds; it does not change any model prompt, raw receipt, schema or other JSON default limit, and is not caller configurable. Record actual serialized full-root size in fixture evidence and test exact boundary rejection plus normal strict path/no-alias/no-duplicate/stable-read behavior under affected TI01 re-verification. Metadata capacity is not evidence of source isolation or producer/model capacity.

The actual existing imports may require narrow helper extraction into `author_execution.py` and `query_validation.py` to keep public entrypoint-to-gate dependencies acyclic. Preserve original callers and validation behavior; no broad refactor. Inventory both actual helpers and tests, and audit the complete source import DAG (including local imports found by AST), not just the three new gate modules. An edge from core through lower replay back to core remains forbidden. Runtime entries must be topological, exact direct-import complete and reachable from actual entrypoints.

### HOLDOUT execution authorization context v2

The resumed C consumer uses the explicit `Authorization.contextVersion=holdout-scope-inputs-v2` wire for HOLDOUT_EXECUTION. This property is optional only for diagnostic/backward compatibility with the original B authorization schema; if present its exact value is required and permission must be HOLDOUT_EXECUTION. It is forbidden for other permissions. The C full-gate path requires the marker: deleting it cannot downgrade the consumer to old authorization input semantics. Legacy B diagnostic records retain their exact old input-set validation and never automatically acquire C full-gate authority. Other authorization fields, supervisor provenance, fixed path, prerequisite identity and A<S<=O rules remain unchanged.

After verified unseal and deterministic frozen packet production, but before any holdout proof/readiness model execution is authorized, the v2 supervisor event binds the exact released reference bytes at `E/holdout/references.json` plus all40 canonical `E/holdout/packets/{caseId}.json` refs. Derive the40 case IDs exclusively from the registered holdout references, byte-identical to released sealed labels, with exact new40 ID/theme/positive-negative quotas. Never take case IDs or paths from caller scope or an arbitrary receipt. Each packet is already root-registered with exact bytes and current selected configuration/identity; all40 must be bound, not only a forthcoming batch.

These41 scope inputs are added to the existing exact closure of runtime manifest, frozen semantic protocol, freeze/seal/claim/unseal and every current prerequisite binding/input. Compare the complete required set with authorization.boundInputs: no missing entries, duplicate paths or generic extras. Include no model outputs, proofs, results, readiness, gate, authorization self-reference or future receipt. Packet plans/queues are frozen deterministic inputs validated by the full consumer; no new retrieval is invoked to satisfy this event. This order introduces no hash cycle: unseal -> fixed references/packets -> explicit supervisor authorization -> raw proof/readiness -> ledgers/results/gate.

This is a contextual authorization/schema revision under the same C initial attempt, requiring affected B schema/path/authorization/scope/time regressions in the C review; it does not reset B counts or widen actual execution permission. No production authorization instance is written in this wave.

The assembled complete fixture currently inventories9011 artifacts and748 public execution entries, with serialized run/root metadata approximately3.33MB. This exceeds the old2MB root-read ceiling and concretely justifies the fixed16MB metadata-only limit described above. Exact final counts/bytes belong in validation evidence, since subsequent complete fixture additions can change them; all model/private input limits stay unchanged.

### Complete structural-map and duplicate runtime input bounds

The full fixture's actual complete StructuralIndex map was measured by the implementation worker at approximately8032894 canonical bytes, or8.034MB inside its parent envelope. Truncating that map or replacing it with a partial synthetic map would not validate the full current corpus. C therefore uses a fixed16000000-byte read limit for the one canonical `E/structural-map.json` path, in both initial loading and subsequent snapshot-currentness checks. All existing canonical-path, expected-hash, stable-file/no-alias and identity checks remain. This exception admits no alternative path and changes no other ordinary JSON or model-input bound.

When a root artifact also exactly matches a registered runtime entry (same canonical path and expected raw SHA256), the loader/currentness pass may reuse that runtime entry's existing category-specific bound, such as the existing16MB chunks bound or512MB binary bound. A mere path collision, different expected hash, caller-selected category or receipt-supplied numeric limit cannot select this behavior. Resolve and prove the exact registered entry match first; preserve safe file identity/no-duplicate checks across reads. This is consistent bounded consumption of the same already inventoried input, not a new unrestricted root-artifact limit.

Record final exact map/envelope sizes and boundary tests in implementation evidence; the measurements above are worker-reported empirical justification rather than a claim that independent review has passed. DEV owns the narrow loader/currentness implementation and affected strict-read regressions. These changes remain in the same C initial attempt and leave the user-selected200000-exclusive model prompt policy restricted to explicit v2 DEV equivalence. Private, proof, readiness and all other model-input limits remain unchanged.
