"""Inactive, NON-AUTHORITATIVE r4 content/metadata diagnostics; no I/O or gate.

Caller-supplied execution metadata is not an authentic execution receipt. Exact
quotes cannot establish entailment, source-boundary review or trusted authority.
"""
from __future__ import annotations

import hashlib
import re

from proof_schedule_v4 import _atoms, subsets


BINDINGS = {'packetHash', 'referenceHash', 'protocolHash', 'projectionHash'}
CHUNK = set('id index heading page text charStart charEnd chunkId evidenceId '
            'sourceId sourceVersion url title textSha256'.split())
QUOTE = set('sourceId sourceVersion chunkId evidenceId sourceStart sourceEnd quote'.split())
CHECK = BINDINGS | set('schemaVersion cycleId caseId groupId checkerId execution subsets'.split())
EXECUTION = set('kind workspaceId callId model effort auth requestHash responseHash '
                'rawEvents sourceReview denialReceipt completed toolEvents'.split())
DECISION = set('chunkIds verdict coverage deploymentConsistent reason'.split())


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _shape(value, keys, name):
    _require(isinstance(value, dict) and set(value) == keys, f'Invalid {name} shape')


def _text(value, name, *, nonempty=True):
    _require(isinstance(value, str) and (not nonempty or bool(value.strip())), f'Invalid {name}')
    value.encode('utf-8')  # Python indices count Unicode scalars after surrogate rejection.


def _id(value, pattern, name):
    _require(isinstance(value, str) and re.fullmatch(pattern, value) is not None, f'Invalid {name}')


def _hash(value, name):
    _id(value, r'[0-9a-f]{64}', name)


def _digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _packet(evidence, originals, sources):
    _require(isinstance(evidence, list) and len(evidence) <= 8, 'Packet must contain at most eight chunks')
    _require(isinstance(originals, dict) and isinstance(sources, dict), 'Expected corpus and source maps')
    ranks, packet = {}, {}
    for rank, chunk in enumerate(evidence, 1):
        _shape(chunk, CHUNK, 'original chunk')
        cid, sid = chunk['chunkId'], chunk['sourceId']
        _id(cid, r'[0-9a-f]{32}', 'chunk ID')
        _hash(sid, 'source ID')
        _require(cid not in packet and chunk == originals.get(cid), 'Duplicate or changed original packet chunk')
        _require(chunk['evidenceId'] == 'ev-' + cid, 'Changed evidence identity')
        for name in ('sourceVersion', 'textSha256'):
            _hash(chunk[name], name)
        for name in ('id', 'url', 'title', 'text'):
            _text(chunk[name], name, nonempty=False)
        _require(type(chunk['index']) is int and chunk['index'] >= 0, 'Invalid chunk index')
        _require(chunk['page'] is None or type(chunk['page']) is int, 'Invalid chunk page')
        if chunk['heading'] is not None:
            _text(chunk['heading'], 'heading', nonempty=False)
        source = sources.get(sid)
        _require(isinstance(source, dict) and source.get('sourceId') == sid, 'Missing or mismatched source')
        _text(source.get('text'), 'source text', nonempty=False)
        _hash(source.get('sourceVersion'), 'sourceVersion')
        _require(_digest(source['text']) == source['sourceVersion'] == chunk['sourceVersion'],
                 'Stale or changed source version')
        start, end = chunk['charStart'], chunk['charEnd']
        _require(type(start) is int and type(end) is int and 0 <= start <= end <= len(source['text']),
                 'Invalid original source offsets')
        _require(source['text'][start:end] == chunk['text'] and _digest(chunk['text']) == chunk['textSha256'],
                 'Original chunk content/offset/hash mismatch')
        ranks[cid], packet[cid] = rank, chunk
    _require(sum(len(c['text']) for c in evidence) <= 12000, 'Packet exceeds 12000 scalar characters')
    return packet, ranks


def _quote(quote, membership, packet, sources):
    _shape(quote, QUOTE, 'quote')
    _id(quote['chunkId'], r'[0-9a-f]{32}', 'quote chunk ID')
    _require(quote['chunkId'] in membership, 'Quote is outside its subset')
    chunk = packet[quote['chunkId']]
    for name in ('sourceId', 'sourceVersion', 'chunkId', 'evidenceId'):
        _require(quote[name] == chunk[name], f'Quote {name} identity mismatch')
    _text(quote['quote'], 'quote', nonempty=False)
    _require(bool(quote['quote']), 'Quote must be nonempty')
    start, end = quote['sourceStart'], quote['sourceEnd']
    _require(type(start) is int and type(end) is int and chunk['charStart'] <= start < end <= chunk['charEnd'],
             'Quote offsets outside original chunk')
    _require(quote['quote'] == sources[chunk['sourceId']]['text'][start:end] ==
             chunk['text'][start - chunk['charStart']:end - chunk['charStart']],
             'Quote does not match exact source and chunk slices')


def _execution(execution, calls, workspaces):
    _shape(execution, EXECUTION, 'execution')
    constants = {'kind': 'workbench', 'model': 'gpt-6-sol', 'effort': 'high',
                 'auth': 'codex-subscription', 'completed': True, 'toolEvents': 0}
    for key, value in constants.items():
        _require(type(execution[key]) is type(value) and execution[key] == value, f'Wrong execution {key}')
    for field, seen in (('callId', calls), ('workspaceId', workspaces)):
        _text(execution[field], field)
        _require(execution[field] not in seen, f'Reused execution {field} across Check records')
        seen.add(execution[field])
    for field in ('requestHash', 'responseHash'):
        _hash(execution[field], field)
    for field in ('rawEvents', 'sourceReview', 'denialReceipt'):
        _shape(execution[field], {'path', 'sha256'}, field)
        _text(execution[field]['path'], f'{field} path')
        _hash(execution[field]['sha256'], f'{field} hash')


def _checks(records, role, case_id, group_id, atoms, expected, bindings, batches, packet,
            sources, calls, workspaces):
    _require(isinstance(records, list), 'Checks must be a list of original r4 Check objects')
    _require(len(records) == len(batches), f'Missing or extra Check batches for {role}')
    observed = {}
    for record, (projection_hash, assigned) in zip(records, batches):
        _shape(record, CHECK, 'Check')
        _require(type(record['schemaVersion']) is int and record['schemaVersion'] == 4 and
                 record['cycleId'] == 'aws-basics-v4-1', 'Wrong protocol constants')
        _require(record['caseId'] == case_id and record['groupId'] == group_id and
                 record['checkerId'] == role, 'Wrong case/group/checker identity')
        _require(all(record[name] == bindings[name] for name in BINDINGS - {'projectionHash'}) and
                 record['projectionHash'] == projection_hash, 'Stale or mismatched binding')
        _execution(record['execution'], calls, workspaces)
        _require(isinstance(record['subsets'], list) and record['subsets'], 'Check has no subsets')
        _require([d.get('chunkIds') if isinstance(d, dict) else None for d in record['subsets']] ==
                 [list(ids) for ids in assigned], 'Check subsets differ from exact host batch assignment')
        for decision in record['subsets']:
            _shape(decision, DECISION, 'subset decision')
            ids = decision['chunkIds']
            _require(isinstance(ids, list) and ids and all(isinstance(cid, str) for cid in ids),
                     'Invalid subset IDs')
            membership = tuple(ids)
            _require(membership in expected and membership not in observed, 'Unknown, unordered or duplicate subset')
            _require(decision['verdict'] in ('PASS', 'FAIL', 'UNKNOWN') and
                     decision['deploymentConsistent'] in ('YES', 'NO', 'UNKNOWN'), 'Invalid decision enum')
            _text(decision['reason'], 'subset reason', nonempty=False)
            _require(isinstance(decision['coverage'], list), 'Coverage must be a list')
            covered = set()
            for coverage in decision['coverage']:
                _shape(coverage, {'atomId', 'quotes', 'reason'}, 'Coverage')
                atom = coverage['atomId']
                _require(isinstance(atom, str) and atom in atoms and atom not in covered,
                         'Duplicate or unknown coverage atom')
                covered.add(atom)
                _text(coverage['reason'], 'coverage reason')
                _require(isinstance(coverage['quotes'], list) and coverage['quotes'], 'Coverage needs nonempty quotes')
                for quote in coverage['quotes']:
                    _quote(quote, membership, packet, sources)
            _require(decision['verdict'] != 'PASS' or covered == atoms, 'PASS is missing required/scope atoms')
            observed[membership] = (decision['verdict'], decision['deploymentConsistent'])
    _require(set(observed) == expected, f'Missing subsets for checker {role}; no diagnostic credit')
    return observed


def _plan(bindings, expected):
    _require(isinstance(bindings, dict), 'Invalid bindings')
    common = BINDINGS - {'projectionHash'}
    _require(set(bindings) in (BINDINGS, common | {'batches'}), 'Invalid bindings shape')
    for name in common:
        _hash(bindings[name], name)
    if 'projectionHash' in bindings:
        _hash(bindings['projectionHash'], 'projectionHash')
        return [(bindings['projectionHash'], sorted(expected))] if expected else []
    _require(isinstance(bindings['batches'], list), 'Expected host batches')
    batches, flattened = [], []
    for batch in bindings['batches']:
        _shape(batch, {'projectionHash', 'subsets'}, 'host batch')
        _hash(batch['projectionHash'], 'projectionHash')
        _require(isinstance(batch['subsets'], list) and batch['subsets'], 'Empty host batch')
        assigned = []
        for ids in batch['subsets']:
            _require(isinstance(ids, (list, tuple)) and ids and all(isinstance(cid, str) for cid in ids),
                     'Invalid planned subset')
            membership = tuple(ids)
            _require(membership in expected, 'Unknown or unordered planned subset')
            assigned.append(membership)
        _require(assigned == sorted(assigned), 'Host batch subsets must be canonical')
        flattened.extend(assigned)
        batches.append((batch['projectionHash'], assigned))
    _require(flattened == sorted(expected), 'Host batches must enumerate all subsets exactly once in order')
    return batches


def inspect_group(case_id, group, evidence, originals, sources, checks_one, checks_two, bindings):
    """Compute only diagnostic completion from two complete, syntactically valid roles.

    ``evidence`` order is original packet rank (one based), never chunk-ID order.
    ``originals`` and ``sources`` are maps keyed by full chunk/source IDs. All
    bindings supply packet/reference/protocol hashes plus ordered host batches
    of projectionHash/subsets, or one projectionHash for a single full batch.
    These are caller-expected identities, not reconstructed trust pins. Missing/malformed/stale inputs raise ValueError rather than dropping a
    group from a denominator. Empty evidence has no subsets or completion.
    """
    _id(case_id, r'[a-z][a-z0-9-]{0,63}', 'case ID')
    _require(isinstance(group, dict) and {'id', 'requiredFacts', 'mandatoryScope'} <= set(group),
             'Missing group fields')
    _id(group['id'], r'[a-z][a-z0-9-]{0,63}', 'group ID')
    projected = _atoms(group)
    atoms = {a['id'] for field in ('requiredFacts', 'mandatoryScope') for a in projected[field]}
    packet, ranks = _packet(evidence, originals, sources)
    expected = set(subsets(packet))
    batches = _plan(bindings, expected)
    calls, workspaces = set(), set()
    args = (case_id, group['id'], atoms, expected, bindings, batches, packet, sources, calls, workspaces)
    one = _checks(checks_one, 'one', *args)
    two = _checks(checks_two, 'two', *args)
    diagnostics, candidates = [], []
    for membership in sorted(expected):
        credit = one[membership] == two[membership] == ('PASS', 'YES')
        completion = max(ranks[cid] for cid in membership) if credit else None
        diagnostics.append({'chunkIds': list(membership), 'checkerOne': one[membership][0],
                            'checkerTwo': two[membership][0], 'diagnosticCredit': credit,
                            'completionRank': completion, 'disagreement': one[membership] != two[membership]})
        if credit:
            candidates.append((completion, membership))
    rank, witness = min(candidates) if candidates else (None, ())
    return {'groupId': group['id'], 'completionRank': rank, 'witness': list(witness),
            'subsetCount': len(expected), 'creditedSubsetCount': len(candidates),
            'diagnosticCredit': bool(candidates), 'subsets': diagnostics,
            'authority': 'NON-AUTHORITATIVE', 'releaseAuthorized': False,
            'rawExecutionVerified': False, 'semanticTruth': 'UNVERIFIED',
            'sourceBoundaryReview': 'UNVERIFIED', 'denialAndAuthorityPins': 'UNVERIFIED'}
