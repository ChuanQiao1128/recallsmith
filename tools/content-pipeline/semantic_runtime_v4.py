"""Bounded offline replay and exact diagnostic metrics; no execution or gate.

execution_pins is a list of EXACT objects:
  {checkerId: 'one'|'two', batchOrdinal: zero-based int,
   outputDirectory: canonical absolute str,
   trustedPins: {controlRoot, expectedFileHashes, runtime}}
The nested trustedPins contract is execution_receipt_v4.verify_execution_v4's
exact six-file/runtime contract. The caller independently registers these paths
and pins. Neither paths nor matching hashes establish authority or authenticity.
All batch ordinals are per checker, in compact_schedule order. Every expected
pair must occur exactly once, and no other pairs are accepted.

bindings retains semantic_proof_v4's caller-expected packet/reference/protocol
hashes and projectionHash/batches contract. These common hashes are not inferred
source-review authority. Rebuilt projection identities and memberships must match.
Original rawResultBytes go directly from the verifier to expand_response.

No functions here execute a model, perform retrieval, alter run state, inspect
capabilities, supply absent sourceReview/denialReceipt references, or authorize
release. HOST_RECORDS_ONLY is a consistency claim about caller-pinned files.
"""
from __future__ import annotations

from collections import Counter
from fractions import Fraction
import hashlib

from execution_receipt_v4 import verify_execution_v4
from proof_transport_v4 import compact_schedule, expand_response
from semantic_proof_v4 import (_id, _packet, _plan, _require, _shape,
                               _text, inspect_decisions_v4)
from proof_schedule_v4 import subsets


CYCLE_ID = 'aws-basics-v4-1'
THEMES = {'cloud', 'identity', 'compute', 'storage', 'databases', 'networking',
          'messaging', 'operations'}


def replay_group_v4(case_id, query, group, evidence, originals, sources, *, bindings,
                    frozen_schema_bytes, execution_pins, per_call=255):
    """Replay exactly both roles/all batches, reporting diagnostics without trust upgrades.

    Calls/workspaces must be distinct across this group. ``executionProvenance``
    retains their actual host-record identities for aggregate cross-group checks.
    Empty evidence requires zero registrations and earns no completion or receipt
    verification. Exceptions reject the whole group, never partial credit.
    """
    packet, _ = _packet(evidence, originals, sources)
    planned = compact_schedule(case_id, query, group, evidence, originals, per_call=per_call)
    expected = set(subsets(packet))
    batches = _plan(bindings, expected)
    rebuilt = [(c['projectionHash'], c['expectedSubsets']) for c in planned['calls']
               if c['checkerId'] == 'one']
    _require(batches == rebuilt, 'Bindings differ from rebuilt exact compact schedule')
    _require(type(frozen_schema_bytes) is bytes and 0 < len(frozen_schema_bytes) <= 60_000,
             'Frozen schema must be exact bounded bytes')
    _require(isinstance(execution_pins, list), 'Expected caller-registered execution list')
    registered, outputs = {}, set()
    for entry in execution_pins:
        _shape(entry, {'checkerId', 'batchOrdinal', 'outputDirectory', 'trustedPins'}, 'execution registration')
        role, ordinal = entry['checkerId'], entry['batchOrdinal']
        _require(isinstance(role, str) and role in ('one', 'two') and type(ordinal) is int and ordinal >= 0,
                 'Invalid checker/batch registration identity')
        key = (role, ordinal)
        _text(entry['outputDirectory'], 'output directory')
        _require(key not in registered and entry['outputDirectory'] not in outputs,
                 'Duplicate batch or reused registered output directory')
        registered[key] = entry
        outputs.add(entry['outputDirectory'])
    required = {(role, i) for role in ('one', 'two') for i in range(len(rebuilt))}
    _require(set(registered) == required, 'Missing or extra registered checker/batch executions')
    decisions, calls, workspaces, provenance = {'one': [], 'two': []}, set(), set(), []
    for call in planned['calls']:
        role = call['checkerId']
        ordinal = len(decisions[role])
        entry = registered[(role, ordinal)]
        receipt = verify_execution_v4(entry['outputDirectory'], frozen_prompt=call['prompt'],
                                      frozen_schema_bytes=frozen_schema_bytes,
                                      trusted_pins=entry['trustedPins'])
        _require(receipt['callId'] not in calls and receipt['workspaceId'] not in workspaces,
                 'Reused actual call/workspace identity within group')
        calls.add(receipt['callId'])
        workspaces.add(receipt['workspaceId'])
        expanded = expand_response(receipt['rawResultBytes'], call['chunkIds'],
                                   call['expectedSubsets'], atom_ids=call['atomIds'])
        decisions[role].append(expanded['subsets'])
        provenance.append({'checkerId': role, 'batchOrdinal': ordinal,
                           'callId': receipt['callId'], 'workspaceId': receipt['workspaceId'],
                           'outputDirectory': entry['outputDirectory'],
                           'projectionHash': call['projectionHash'],
                           'promptSha256': call['promptSha256'],
                           'schemaSha256': hashlib.sha256(frozen_schema_bytes).hexdigest(),
                           'rawResultSha256': hashlib.sha256(receipt['rawResultBytes']).hexdigest(),
                           'pinnedFileHashes': receipt['pinnedFileHashes'],
                           'pinnedRuntime': receipt['pinnedRuntime']})
    result = inspect_decisions_v4(case_id, group, evidence, originals, sources,
                                  decisions['one'], decisions['two'], bindings)
    return {**result, 'caseId': case_id, 'cycleId': CYCLE_ID,
            'perCallSubsetLimit': per_call, 'executionProvenance': provenance,
            'rawReceiptIntegrityVerified': bool(provenance),
            'hostRecordStatus': 'VERIFIED' if provenance else 'NO_EXECUTIONS_REQUIRED',
            'executionAuthenticity': 'HOST_RECORDS_ONLY'}


def _ratio(total, count):
    return total / count if count else Fraction(0)


def _reference_cases(references):
    """Use exact original groupId identities from frozen legacy references.

    This is no atom conversion or label review. Optional historical split fields
    remain history; all observed cases belong to the current DEV cycle. Matching
    this in-memory object is not an exact reference-file-byte hash check.
    """
    _require(isinstance(references, dict) and isinstance(references.get('queries'), list),
             'Expected frozen reference queries representation')
    cases = {}
    for query in references['queries']:
        _require(isinstance(query, dict) and {'id', 'module', 'answerable', 'requiredEvidenceGroups'} <= set(query),
                 'Missing reference case fields')
        _id(query['id'], r'[a-z][a-z0-9-]{0,63}', 'reference case ID')
        _text(query['module'], 'reference theme')
        _require(query['id'] not in cases and type(query['answerable']) is bool and
                 isinstance(query['requiredEvidenceGroups'], list), 'Duplicate or malformed reference case')
        groups = []
        for group in query['requiredEvidenceGroups']:
            _require(isinstance(group, dict), 'Invalid reference group')
            gid = group.get('groupId')
            _id(gid, r'[a-z][a-z0-9-]{0,63}', 'reference group ID')
            _require(gid not in groups, 'Duplicate reference group')
            groups.append(gid)
        _require(bool(groups) == query['answerable'], 'Positive groups required; negatives must have none')
        cases[query['id']] = (query, groups)
    _require(bool(cases), 'Reference cases must be nonempty')
    return cases


def aggregate_groups_generic_v4(references, case_results):
    """Pure SYNTHETIC-friendly exact metrics over canonical reference representation.

    case_results is a list of {caseId, groups: [replay_group_v4 outputs]} with an
    optional legacyMetrics value carried separately, never used in semantic math.
    Every reference case/group is mandatory, including zero-completion cases and
    negatives (groups=[]). Fractions remain exact; compare thresholds as Fraction.
    Semantic recall is mean per-positive-query completed-group fraction, MRR uses
    each query's earliest COMPLETE group rank. Per-theme metrics use the same
    query macro; themeMacro averages those theme scores with equal theme weight.
    """
    expected = _reference_cases(references)
    _require(isinstance(case_results, list), 'Expected case result list')
    observed, calls, workspaces, outputs, legacy = {}, set(), set(), set(), {}
    for case in case_results:
        _require(isinstance(case, dict) and set(case) in ({'caseId', 'groups'},
                 {'caseId', 'groups', 'legacyMetrics'}), 'Invalid case result shape')
        cid = case['caseId']
        _require(isinstance(cid, str) and cid in expected and cid not in observed,
                 'Missing, extra or duplicate case identity')
        _require(isinstance(case['groups'], list), 'Expected result groups list')
        groups = {}
        for result in case['groups']:
            _require(isinstance(result, dict) and result.get('caseId') == cid and
                     result.get('cycleId') == CYCLE_ID, 'Wrong group case/cycle identity')
            gid = result.get('groupId')
            _require(isinstance(gid, str) and gid in expected[cid][1] and gid not in groups,
                     'Extra or duplicate result group')
            rank = result.get('completionRank')
            _require(rank is None or type(rank) is int and 1 <= rank <= 8, 'Invalid completion rank')
            _require(type(result.get('diagnosticCredit')) is bool and
                     result['diagnosticCredit'] == (rank is not None), 'Completion/credit mismatch')
            count, limit = result.get('subsetCount'), result.get('perCallSubsetLimit')
            _require(type(count) is int and count in {(1 << n) - 1 for n in range(9)} and
                     type(limit) is int and 1 <= limit <= 255, 'Invalid subset count/batch limit')
            _require(rank is None or rank <= count.bit_length(), 'Completion exceeds original packet rank')
            provenance = result.get('executionProvenance')
            _require(isinstance(provenance, list), 'Missing execution provenance')
            pairs = set()
            for run in provenance:
                _require(isinstance(run, dict), 'Invalid provenance')
                role, ordinal = run.get('checkerId'), run.get('batchOrdinal')
                _require(isinstance(role, str) and role in ('one', 'two') and type(ordinal) is int,
                         'Invalid provenance batch identity')
                pair = (role, ordinal)
                _require(pair not in pairs, 'Duplicate provenance batch')
                pairs.add(pair)
                for field, seen in (('callId', calls), ('workspaceId', workspaces), ('outputDirectory', outputs)):
                    _text(run.get(field), 'provenance ' + field)
                    _require(run[field] not in seen, 'Reused call/workspace/output across cases or groups')
                    seen.add(run[field])
            batches = (count + limit - 1) // limit
            _require(pairs == {(role, i) for role in ('one', 'two') for i in range(batches)},
                     'Missing or extra group execution provenance')
            _require(result.get('releaseAuthorized') is False and result.get('rawExecutionVerified') is False and
                     result.get('semanticTruth') == 'UNVERIFIED' and
                     result.get('executionAuthenticity') == 'HOST_RECORDS_ONLY', 'Diagnostic authority changed')
            groups[gid] = rank
        _require(set(groups) == set(expected[cid][1]), 'Missing result groups; no denominator dropping')
        observed[cid] = groups
        if 'legacyMetrics' in case:
            legacy[cid] = case['legacyMetrics']
    _require(set(observed) == set(expected), 'Missing result cases; no denominator dropping')
    rows, themed = [], {}
    for cid, (reference, group_ids) in expected.items():
        if not reference['answerable']:
            continue
        ranks = [observed[cid][gid] for gid in group_ids]
        completed = [rank for rank in ranks if rank is not None]
        row = {'caseId': cid, 'theme': reference['module'], 'requiredGroups': len(ranks),
               'completedGroups': len(completed), 'semanticRecallAt8': Fraction(len(completed), len(ranks)),
               'queryMRR': Fraction(1, min(completed)) if completed else Fraction(0)}
        rows.append(row)
        themed.setdefault(reference['module'], []).append(row)
    per_theme = {theme: {'positiveCases': len(entries),
                         'semanticRecallAt8': _ratio(sum((r['semanticRecallAt8'] for r in entries), Fraction()), len(entries)),
                         'queryMRR': _ratio(sum((r['queryMRR'] for r in entries), Fraction()), len(entries))}
                 for theme, entries in sorted(themed.items())}
    return {'cycleId': CYCLE_ID, 'caseCount': len(expected), 'positiveCount': len(rows),
            'negativeCount': len(expected) - len(rows),
            'requiredGroups': sum(r['requiredGroups'] for r in rows),
            'completedGroups': sum(r['completedGroups'] for r in rows),
            'semanticRecallAt8': _ratio(sum((r['semanticRecallAt8'] for r in rows), Fraction()), len(rows)),
            'queryMRR': _ratio(sum((r['queryMRR'] for r in rows), Fraction()), len(rows)),
            'perTheme': per_theme,
            'themeMacro': {key: _ratio(sum((r[key] for r in per_theme.values()), Fraction()), len(per_theme))
                           for key in ('semanticRecallAt8', 'queryMRR')},
            'cases': rows, 'legacyDiagnosticMetrics': legacy,
            'authority': 'NON-AUTHORITATIVE', 'releaseAuthorized': False,
            'rawExecutionVerified': False, 'semanticTruth': 'UNVERIFIED',
            'executionAuthenticity': 'HOST_RECORDS_ONLY'}


def aggregate_groups_v4(references, case_results):
    """Strict current DEV80 wrapper; historical split names do not exclude cases.

    Counts/distribution come from the supplied canonical frozen queries/groups,
    never caller summary numbers. This does not review or approve their labels.
    """
    cases = _reference_cases(references)
    distribution = Counter((q['module'], q['answerable']) for q, _ in cases.values())
    expected = {(theme, answerable): 8 if answerable else 2
                for theme in THEMES for answerable in (True, False)}
    _require(distribution == expected and len(cases) == 80 and
             sum(len(groups) for _, groups in cases.values()) == 148,
             'Current frozen DEV80/64-positive/16-negative/148-group references required')
    return aggregate_groups_generic_v4(references, case_results)
