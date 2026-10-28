# DEV80 representation and historical packet adoption amendment

This is a proposed, reviewable contract for a narrow exception to frozen r4 S1/V1/V3. It is not a review PASS, an adoption receipt, or permission to execute. The companion `semantic-v4-adoption-contract.json` is normative: its receipt schemas **and** R01–R17 predicates must all be implemented. A disagreement between this amendment and the frozen contracts outside the two explicit exceptions blocks use.

## Two bounded exceptions

1. An equivalent representation of already observed DEV80 may be created after ranks were observed. Its provenance must say `POST_OBSERVATION_REPRESENTATION_ONLY`; it must never claim pre-ranking freezing. It retains exactly 80 questions, 64 positives, 16 negatives and the exact 148 required group IDs with original membership. Two fresh, independent source-only executions must establish equivalence without seeing ranks or packet results. Ambiguous or unsupported conversion blocks; it cannot be repaired through a substantive label edit.
2. A fresh proof consumer may read immutable saved A/B packets through distinct DEV-only adoption wrappers. Original retrieval identity and provenance remain historical. The new consumer has its own reviewed identity. This does not make diagnostic packets full r4 envelopes, promote their results, or assert the historical implementation passed current review.

Both evaluated configuration slots remain exhausted. A=radius 1 and B=radius 2 remain fixed. No retriever run, reranking, repacking, reset, corrected extra configuration or new labels are allowed by this amendment. The old 40-case historical holdout is observed DEV material.

## Representation mapping

The JSON pins the original `/control/evaluation/references.json` to its actual canonical path and SHA256, and enumerates the required group IDs. Each view case points to the whole immutable original case. This preserves original split, verdict/classification, optional groups, exclusions, negative reasons/missing inputs and uncertainty/provenance, even where those fields do not belong in the proof projection.

For each required group, preserve `groupId` as `id`. Wrap the exact `claim` string as required atom `fact`; wrap exact `necessaryScope` as mandatory atom `scope`. For each zero-based nested `mandatoryScopeEvidenceGroups[j]`, preserve its exact claim and necessaryScope as separate mandatory atoms `mandatory-j-claim` and `mandatory-j-scope`. Its old ID/status remains in the mapping and original case. Nested scope requirements do not become additional denominator groups. Empty or ambiguous scope text blocks. No fact splitting, paraphrasing, weakening, new applicability or status change is permitted.

Optional groups remain optional in the original-case sidecar; `optionalFacts` is empty in this view. Reviewers must examine those original optional groups, while proof checkers must not receive them. Nothing optional earns credit. Every original required alternative remains represented in source-only anchor derivations. Exact quotes may gain scalar offsets only when their occurrence within the original bound source/chunk is unique. A repeated or missing occurrence blocks. Anchor combinations must jointly entail all facts and scope atoms; inability to prove this blocks rather than inventing anchors. No source text is rewritten.

Every representation change is enumerated in `FieldMap` with original/adapted JSON pointers and value hashes. Whole-case hashes retain everything else. The permitted operations are exact copy, text-to-atom wrapping, deterministic atom IDs, exact occurrence offsets, source-only conjunctive anchor-set enumeration, preservation by original-case reference, and absent positive negativeReason to null. The last two operations have explicit pointer-resolution rules in R07; they cannot change a value. There are 298 copied mandatory text fields (148 claims, 148 necessaryScope, one nested claim and one nested necessaryScope); the denominator remains 148 groups. The two independent reviews cover all questions and groups, negatives, mandatory scope, optional status and every change. They see the same source-only projection, without ranks, packets, queues, configuration outcomes or peer output. They must be independent of the adapter producer. Native architecture review of this contract cannot replace those content reviews; source-only access must be actually enforced before calls.

## Separate historical and current identities

The historical packet stays at `control/evidence/r4-observed80-diagnostic/{A|B}/{caseId}.json`, byte-for-byte. The contract pins a digest of all 160 original path/hash records and the frozen run provenance. A new `PacketAdoption` holds the original packet reference and raw provenance references, plus canonical hashes of the original ordered evidence, plan, candidate queues and trace. Its `originalRetrievalIdentityHash` commits to those original references; it does not synthesize absent parent identity fields.

`proofConsumer` separately binds the fresh full r4 identity, dependency manifest and the two amendment files. Actual source/imports/tests/runtime dependencies, prompts, protocol/schema/model and consumer entry points must be pinned and reviewed. It cannot use HEAD alone or copy the old identity into a new envelope. No current-code retriever replay is authorized to manufacture original provenance. If original provenance cannot be established from retained records, adoption remains UNKNOWN.

The view/wrappers use a separate `dev80-adoption-v1` dispatcher at the fixed new paths in the JSON. They are not accepted by the parent `Envelope` validator. Parent dispatch remains strict everywhere else, including author/MCP/holdout. New proof ledgers/results must bind the wrapper, mapping and full fresh consumer identity; each Check binds the original raw packet hash and adapted reference file hash. This is the only exception to whole-chain identity equality: the historical input is referenced, never relabelled. Old diagnostic checks or numeric results cannot satisfy fresh semantic proofs.

## Acceptance and invalidation

Consumers reject missing/extra cases, changed group IDs, duplicate JSON keys/IDs, invalid path aliases, hash mismatch and every unenumerated transformation. Complete original chunk objects and their order must match the immutable corpus; the 8-chunk/12,000-scalar limits still apply. Both configurations and every query must be covered. An inventory of selected successes is not an inventory of DEV80.

The future deterministic producer writes only the new paths, preserves all original bytes and produces the explicit mapping. It cannot grant authority. Independent source-only reviewers supply actual completed executions and per-case/group verdicts; the trusted supervisor pins current review artifacts and inputs. The consumer validates schema, canonical path/hash, full identity, mapping predicates and raw executions against external authority. It never trusts receipt-supplied PASS, `sourceReview`, denial flags or `HOST_RECORDS_ONLY` as proof of authority. Missing evidence yields UNKNOWN/block.

A non-blocked permission also needs an externally pinned supervisor authorization event matching the requested permission and exact mapping, packet inventory and consumer identity. The authority receipt keeps separate pins for contract review, equivalence, consumer implementation review, common current source review, isolation/denial, integration canary, selection/freeze, seal, claim, unseal and semantic gate. `ADOPT_INPUTS_ONLY` requires current contract/equivalence/implementation approvals and all input predicates. `DEV_PROOF_EXECUTION` additionally needs current source review, actual same-launcher denial evidence and explicit supervisor execution authorization. It is not D2/D4/D5 or card-generation permission. Every receipt under this contract has `releaseAuthorized=false`.

Any original packet/query/source/configuration or label-meaning change invalidates adoption and its descendants; there is no remaining retrieval slot. Consumer/protocol/prompt/model/schema/test/dependency or representation changes invalidate applicable review and dependent proofs/results/selection/gate. Unchanged historical bytes may be read again only through newly reviewed current adoption; they do not carry old PASS forward. No post-unseal change can restore blindness. The original failed observations and provenance always remain untouched.

## Scoring and execution remain unchanged

All actual nonempty subsets of each packet must receive explicit independent checks from roles one and two; no prefix approximation, inferred supersets, sampled subsets or third tie breaker. Each valid subset needs both PASS, all mandatory atoms, consistent deployment and exact source/chunk occurrence quotes. Missing/malformed/timed-out decisions receive no credit. Empty packets produce no model calls and no credit. Actual content execution stays on the reviewed tool-free Workbench route, gpt-6-sol/high, with complete raw executions and current source/denial authority.

Keep `complete-group-v1`: subset completion is its maximum original rank; group completion is the minimum validated subset completion. Tie witnesses use lexicographically sorted chunk IDs. Query recall counts finite groups over all frozen required groups; MRR is the reciprocal of the earliest complete group, or zero. DEV macro includes all 64 positives and eight positives per theme; negative metrics stay null. There is no numeric DEV floor. Legacy anchor metrics remain separate diagnostics.

New40 thresholds remain recall ≥ .90, MRR ≥ .75, each-theme recall ≥ .75; eight correct negative refusals, at most one false refusal and zero unsupported or wrong-deployment acceptance. Full gate recomputation, readiness, current reviews, isolation, freeze, seal and exclusive claim/unseal remain mandatory. This amendment changes none of those thresholds or lifecycle requirements.

## Rejected examples

- Missing or dropping either an outer `necessaryScope` or the nested `databases-p3-g1-scope1.necessaryScope` fails even when all 148 group IDs remain.
- Removing the Db2 standby/Oracle mounted exception from `databases-p3-g1`, or calling it optional, changes meaning and blocks adaptation.
- Giving a difficult group two IDs changes the 148-group denominator; dropping an optional group from provenance hides a status change. Both reject.
- Resolving a repeated quote to the convenient occurrence, adding a new alternative because a retrieved chunk scored well, or paraphrasing a scope qualifier rejects.
- Copying a saved packet to the parent v4 packet path and stamping the fresh implementation hash rejects, even if its chunk text matches.
- Reusing one checker completion under two role names, trusting host-record consistency as source review, or substituting a native contract review for enforced source-only review rejects.
- Re-running repaired A, selecting only successful cases, using old anchor MRR as semantic MRR, or treating adoption as seal/claim/unseal authority rejects.

## Current integration boundary

These two files define future integration only. Existing `semantic_proof_v4.py`, proof scheduling/transport and execution receipt helpers remain inactive/non-authoritative and are not changed here. Future consumers must explicitly implement R01–R17; passing JSON Schema alone is insufficient. In particular, strict bridge dispatch, externally pinned authority and raw execution validation must precede any evaluation or generation entry point.

Contract/equivalence approval, current source-boundary review, actual isolation, execution authority and seal/claim/unseal are pending independently. The previously blocked common source-boundary review has not been performed or retried. No actual mapping, adoption receipt, semantic evaluation, probe, model call, new holdout case or card is produced in this increment. Parent contracts/history remain frozen. Raw SHA256 pins are recorded in the machine contract; they record file identity, not independent verification.
