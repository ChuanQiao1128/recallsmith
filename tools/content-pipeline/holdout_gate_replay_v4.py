"""Pure replay of registered v4 holdout bytes; no retrieval or model execution."""
from fractions import Fraction
import json
import re

from referencing import Registry

import trusted_custody_v4 as custody
from execution_receipt_v4 import _verify_execution_bytes_v4
from metric_wire_v4 import (loads_record, verify_results_metrics, verify_metrics,
                            semantic_thresholds_met)
from proof_schedule_v4 import canonical, _atoms
from semantic_proof_v4 import _packet, _quote
from semantic_runtime_v4 import aggregate_groups_generic_v4
from semantic_readiness_v4 import replay_readiness_v4, replay_holdout_readiness_v4
from retrieval_v4 import StructuralIndex, pack, plan_query
from dev_gate_replay_v4 import _replay_proof_case_v4, _parent_execution

C, R, E, T = custody.C, custody.R, custody.E, custody.T
P = R + '/tools/content-pipeline'
THEMES = ('cloud', 'identity', 'compute', 'storage', 'databases', 'networking', 'messaging', 'operations')
_require, _digest, _parse = custody._require, custody._digest, custody._parse
PRIVATE_VERSION = 'private-label-input-v1'
PRIVATE_INSTRUCTIONS = {
    'author': 'Create the scheduled original AWS questions and complete source-grounded Reference labels. '
              'Use only the complete supplied frozen sources and assigned slots. Preserve every necessary '
              'scope and exact quote. Do not use tools, rankings, prior questions, peer outputs or repair.\n',
    'checker': 'Independently check every supplied Reference against only the complete supplied frozen '
               'sources. Verify facts, necessary scope, every anchor and negative justification. '
               'Return PASS only for complete support. Do not modify labels, omit cases, use tools or repair.\n',
    'novelty': 'Independently compare each new Reference principal fact and deployment with every original '
               'observed question. Reject paraphrases and repeated fact/deployment meaning. Check all old80 '
               'IDs in original order. Do not use tools, rankings, peer decisions or repair.\n',
}


def _fixed(root, path, artifacts):
    ref, raw = custody._fixed(root, path, artifacts)
    _parse(raw)
    return ref, json.loads(raw)


def _parent(root, ref, artifacts, kind):
    return custody._parent(root, ref, artifacts, 'Envelope', kind=kind)


def _shape(value, fields, label):
    _require(type(value) is dict and set(value) == set(fields), 'Invalid closed ' + label)


def _text(value, label):
    _require(type(value) is str and bool(value.strip()), 'Missing ' + label)


def private_output_schema(role, parent_schema):
    """Exact schema emitted by the bounded private producer, inventoried as source."""
    if role == 'author':
        row = {'$ref': '#/$defs/Reference'}
    else:
        fields = {'caseId': {'type': 'string'}, 'verdict': {'enum': ['PASS', 'FAIL', 'UNKNOWN']},
                  'reason': {'type': 'string', 'minLength': 1}}
        if role == 'novelty':
            fields['comparedOldIds'] = {'type': 'array', 'items': {'type': 'string'}}
        row = {'type': 'object', 'properties': fields, 'required': list(fields), 'additionalProperties': False}
    needed = {}
    def collect(value):
        if isinstance(value, dict):
            if '$ref' in value:
                name = value['$ref'].removeprefix('#/$defs/')
                if name not in needed:
                    needed[name] = parent_schema['$defs'][name]
                    collect(needed[name])
            for child in value.values(): collect(child)
        elif isinstance(value, list):
            for child in value: collect(child)
    collect(row)
    return {'type': 'object', 'properties': {'cases': {'type': 'array', 'items': row}},
            'required': ['cases'], 'additionalProperties': False, '$defs': needed}


def private_schedule(plan, cases, old80, sources):
    """Deterministic full-input schedule; all private prompts retain the 60k bound."""
    calls, cursor, novelty_ordinal = [], 0, 0
    for n, batch in enumerate(plan['batches']):
        selected = cases[cursor:cursor + len(batch['slots'])]
        projected_sources = [{k: sources[sid][k] for k in ('sourceId', 'sourceVersion', 'text')}
                             for sid in batch['sourceIds']]
        for role in ('author', 'checker'):
            projection = {'version': PRIVATE_VERSION, 'role': role, 'batchOrdinal': n}
            projection.update({'slots': batch['slots'], 'sources': projected_sources} if role == 'author'
                              else {'cases': selected, 'sources': projected_sources})
            calls.append((role, n, projection, cursor, len(selected)))
        start = 0
        while start < len(old80['queries']):
            chosen = None
            for end in range(start + 1, len(old80['queries']) + 1):
                projection = {'version': PRIVATE_VERSION, 'role': 'novelty', 'batchOrdinal': novelty_ordinal,
                              'cases': selected, 'old80': old80['queries'][start:end]}
                prompt = PRIVATE_INSTRUCTIONS['novelty'] + canonical(projection)
                if len(prompt) >= 60000 or len(prompt.encode('utf-16-le')) // 2 >= 60000:
                    break
                chosen = projection
            _require(chosen is not None, 'One whole old/new novelty case cannot fit private prompt')
            calls.append(('novelty', novelty_ordinal, chosen, cursor, len(selected)))
            start += len(chosen['old80']); novelty_ordinal += 1
        cursor += len(selected)
    return calls


def _private_execution(root, runtime, artifacts, entry, projection, schema):
    role = entry['role']
    prompt = PRIVATE_INSTRUCTIONS[role] + canonical(projection)
    schema_bytes = json.dumps(schema, ensure_ascii=False, indent=2).encode('utf-8')
    _require(len(prompt) < 60000 and len(prompt.encode('utf-16-le')) // 2 < 60000,
             'Private prompt exceeds unchanged purpose bound')
    directory = f'{E}/holdout/seal-evidence/raw/{role}/{entry["batchOrdinal"]}'
    _require(entry['prompt']['path'] == directory + '/prompt.txt' and
             custody._registered(root, entry['prompt'], artifacts) == prompt.encode('utf-8') and
             entry['projectionHash'] == _digest(projection), 'Private source-only prompt/projection changed')
    raw = {name: custody._registered(root, ref, artifacts) for name, ref in entry['releasedFiles'].items()}
    receipt = _verify_execution_bytes_v4(raw, entry['originalOutputDirectory'], frozen_prompt=prompt,
              frozen_schema_bytes=schema_bytes, trusted_pins={'controlRoot': entry['originalControlRoot'],
              'expectedFileHashes': entry['expectedFileHashes'], 'runtime': entry['runtime']})
    _require(receipt['callId'] == entry['callId'] and receipt['workspaceId'] == entry['originalWorkspaceId'] and
             entry['runtime'] == runtime['runtime'], 'Private actual execution identity changed')
    # Original private paths remain opaque; only released registered copies are read.
    return _parse(receipt['rawResultBytes']), {'callId': receipt['callId'],
        'workspaceId': receipt['workspaceId'], 'outputDirectory': entry['originalOutputDirectory'],
        'resultPath': entry['releasedFiles']['result.json']['path']}


def _private_parent_execution(root, entry, actual):
    bindings = {x['node']: x for x in root['authorities']}
    expected = {'kind': 'workbench', 'workspaceId': entry['originalWorkspaceId'], 'callId': entry['callId'],
        'model': 'gpt-6-sol', 'effort': 'high', 'auth': 'codex-subscription',
        'requestHash': entry['prompt']['sha256'], 'responseHash': entry['releasedFiles']['result.json']['sha256'],
        'rawEvents': entry['releasedFiles']['events.jsonl'],
        'sourceReview': bindings['current-source-review']['acceptedReview'],
        'denialReceipt': bindings['isolation-denial']['observation'], 'completed': True, 'toolEvents': 0}
    _require(actual == expected, 'Private assembled execution differs from original raw result')


def _validate_reference(case, originals, sources):
    ids = set()
    for group in case['groups']:
        _require(group['id'] not in ids, 'Duplicate label group')
        ids.add(group['id'])
        atoms = _atoms(group)
        required = {a['id'] for field in ('requiredFacts', 'mandatoryScope') for a in atoms[field]}
        optional = group['optionalFacts']
        optional_ids = [a['id'] for a in optional]
        _require(len(optional_ids) == len(set(optional_ids)) and not required.intersection(optional_ids),
                 'Duplicate required/scope/optional atom identity')
        _require(bool(group['anchorSets']), 'Positive label needs source-only anchors')
        seen = set()
        for anchor in group['anchorSets']:
            _require(anchor['id'] not in seen, 'Duplicate anchor identity')
            seen.add(anchor['id'])
            coverage = anchor['coverage']
            _require([c['atomId'] for c in coverage] and len(coverage) == len(required) and
                     {c['atomId'] for c in coverage} == required, 'Anchor omits mandatory fact or scope')
            for row in coverage:
                _text(row['reason'], 'anchor reason')
                _require(bool(row['quotes']), 'Anchor lacks exact quote')
                for quote in row['quotes']:
                    _require(quote['chunkId'] in originals, 'Anchor unknown chunk')
                    _quote(quote, set(originals), originals, sources)


def replay_private_labels_v4(root, runtime, artifacts, released, old80):
    """Decode every private raw output and compare all sealed labels and reviews."""
    instruction_path = P + '/private-label-instructions-v1.json'
    instruction_entries = [e for e in runtime['entries'] if e['artifact']['path'] == instruction_path]
    _require(len(instruction_entries) == 1 and instruction_entries[0]['category'] == 'prompt',
             'Private instructions missing from prompt runtime identity')
    instructions = _parse(custody._registered(root, instruction_entries[0]['artifact'], artifacts))
    _require(instructions == {'version': PRIVATE_VERSION, 'instructions': PRIVATE_INSTRUCTIONS},
             'Private source instruction template differs from frozen consumer')
    labels = _parent(root, released['labels'], artifacts, 'references')
    reference_ref, public = _fixed(root, E + '/holdout/references.json', artifacts)
    _require(public == labels and custody._registered(root, reference_ref, artifacts) ==
             custody._registered(root, released['labels'], artifacts), 'Released labels byte identity changed')
    cases = labels['payload']['queries']
    expected_slots = [{'id': f'v4-{theme}-{suffix}', 'module': theme, 'answerable': suffix != 'n1'}
                      for theme in THEMES for suffix in ('p1', 'p2', 'p3', 'p4', 'n1')]
    _require([{k: c[k] for k in ('id', 'module', 'answerable')} for c in cases] == expected_slots,
             'Exact new40 slots/order/quotas required')
    original_ref = custody._fixed(root, C + '/evaluation/references.json', artifacts)[0]
    _require(labels['payload']['old80'] == original_ref, 'New labels original80 identity differs')
    originals, sources = custody._corpus_maps(runtime, artifacts)
    for case in cases:
        _require(bool(case['groups']) == case['answerable'] and
                 (case['negativeReason'] is None if case['answerable'] else
                  type(case['negativeReason']) is str and bool(case['negativeReason'].strip())), 'Label classification changed')
        _validate_reference(case, originals, sources)
    _, plan = _fixed(root, E + '/holdout/seal-evidence/author-plan.json', artifacts)
    _shape(plan, ('version', 'batches'), 'private author plan')
    _require(plan['version'] == 'private-label-plan-v1' and type(plan['batches']) is list and plan['batches'],
             'Private predeclared plan missing')
    schema = _parse(artifacts[C + '/design/rag-v2-bounded/r4/contracts.schema.json'])
    by_pair = {(e['role'], e['batchOrdinal']): e for e in released['executions']}
    author = _parent(root, released['author'], artifacts, 'reference-review')['payload']
    checker = _parent(root, released['checker'], artifacts, 'reference-review')['payload']
    novelty = _parent(root, released['novelty'], artifacts, 'novelty-review')['payload']
    for record in (author, checker, novelty):
        _require(record['references'] == reference_ref and [r['caseId'] for r in record['cases']] ==
                 [c['id'] for c in cases], 'Private review complete label identity/order changed')
    _require(novelty['old80'] == original_ref, 'Novelty original80 changed')
    cursor, provenance = 0, []
    old_ids = [c['id'] for c in old80['queries']]
    for n, batch in enumerate(plan['batches']):
        _shape(batch, ('batchOrdinal', 'slots', 'sourceIds'), 'private author batch')
        slots = batch['slots']; sids = batch['sourceIds']
        _require(type(batch['batchOrdinal']) is int and batch['batchOrdinal'] == n and
                 1 <= len(slots) <= 3 and slots == expected_slots[cursor:cursor + len(slots)] and
                 type(sids) is list and bool(sids) and sids == sorted(set(sids)) and set(sids) <= sources.keys(),
                 'Private predeclared source/slot plan changed')
        selected = cases[cursor:cursor + len(slots)]
        for case in selected:
            _require({q['sourceId'] for g in case['groups'] for a in g['anchorSets'] for row in a['coverage']
                     for q in row['quotes']} <= set(sids), 'Author/checker anchor outside declared full sources')
        cursor += len(slots)
    _require(cursor == 40, 'Private plan dropped cases')
    scheduled = private_schedule(plan, cases, old80, sources)
    _require(len(by_pair) == len(released['executions']) and set(by_pair) ==
             {(role, n) for role, n, *_ in scheduled}, 'Private role/batch coverage differs')
    representative, novelty_reasons = set(), {c['id']: [] for c in cases}
    for role, n, projection, cursor, count in scheduled:
        selected = cases[cursor:cursor + count]
        entry = by_pair[role, n]
        result, observed = _private_execution(root, runtime, artifacts, entry, projection,
                                             private_output_schema(role, schema))
        provenance.append(observed)
        if role == 'author':
            _require(result == {'cases': selected}, 'Author raw labels differ from sealed labels')
        rows = (author if role == 'author' else checker if role == 'checker' else novelty)['cases'][cursor:cursor + count]
        for row, case in zip(rows, selected):
            _require(row['verdict'] == 'PASS', 'Private review is not PASS')
            _text(row['reason'], 'private review reason')
            if role != 'novelty' or row['caseId'] not in representative:
                _private_parent_execution(root, entry, row['execution'])
                if role == 'novelty': representative.add(row['caseId'])
        if role != 'author':
            if role == 'checker':
                decoded = [{k: row[k] for k in ('caseId', 'verdict', 'reason')} for row in rows]
                _require(result == {'cases': decoded}, 'Private raw review differs from assembled decisions')
            if role == 'novelty':
                _require(all(row['comparedOldIds'] == old_ids for row in rows), 'Novelty omitted original80 comparisons')
                decoded = result['cases']
                _require([r['caseId'] for r in decoded] == [c['id'] for c in selected] and all(
                    r['verdict'] == 'PASS' and r['comparedOldIds'] == [c['id'] for c in projection['old80']] and
                    type(r['reason']) is str and bool(r['reason'].strip()) for r in decoded),
                    'Novelty raw partition verdict/complete comparison coverage changed')
                for row in decoded:
                    novelty_reasons[row['caseId']].append({'comparedOldIds': row['comparedOldIds'], 'reason': row['reason']})
    _require(all(row['reason'] == canonical(novelty_reasons[row['caseId']]) for row in novelty['cases']),
             'Novelty assembled reasons differ from all actual raw partitions')
    old_tuples = {canonical(t).casefold().strip() for c in old80['queries']
                  for t in c.get('principalFactDeploymentTuples', [])}
    _require(not any(canonical(t).casefold().strip() in old_tuples for c in cases
                     for t in c['principalFactDeploymentTuples']), 'Repeated principal fact/deployment tuple')
    for key, suffix in (('checker', 'reference-review'), ('novelty', 'novelty-review')):
        public_ref, public_value = _fixed(root, E + '/holdout/' + suffix + '.json', artifacts)
        _require(custody._registered(root, public_ref, artifacts) == custody._registered(root, released[key], artifacts),
                 'Published private review bytes differ')
    return {'reference': reference_ref, 'cases': cases, 'provenance': provenance,
            'originals': originals, 'sources': sources}


def _packet_context(root, runtime, artifacts, configuration, structural=None):
    profile_ref, _ = _fixed(root, E + '/profiles/' + configuration + '.json', artifacts)
    profile = _parent(root, profile_ref, artifacts, 'profile')['payload']
    map_ref, _ = _fixed(root, E + '/structural-map.json', artifacts)
    structural_map = _parent(root, map_ref, artifacts, 'structural-map')['payload']
    originals, sources = custody._corpus_maps(runtime, artifacts)
    structural = structural or StructuralIndex(sources, originals.values())
    _require(structural_map == structural.map() and profile['configuration'] == configuration and
             profile['radius'] == (1 if configuration == 'A' else 2) and profile['map'] == map_ref and
             profile['algorithm'] == custody._fixed(root, C + '/design/rag-v2-bounded/r4/algorithm.md', artifacts)[0],
             'Selected structural map/profile changed')
    return structural, profile_ref, profile, map_ref, originals, sources


def replay_packet_v4(root, runtime, artifacts, case, configuration, prefix, structural=None, context=None):
    """Pure A1/A4 reconstruction against registered saved queues, never retrieval."""
    cid = case['id']
    packet_ref, _ = _fixed(root, prefix + '/packets/' + cid + '.json', artifacts)
    packet = _parent(root, packet_ref, artifacts, 'packet')['payload']
    plan_ref, _ = _fixed(root, prefix + '/plans/' + cid + '.json', artifacts)
    plan = _parent(root, plan_ref, artifacts, 'query-plan')['payload']
    structural, profile_ref, profile, map_ref, originals, sources = context or _packet_context(root, runtime, artifacts, configuration, structural)
    _require(plan == plan_query(case['queryEn'], profile_ref) and packet['queryEn'] == case['queryEn'] and
             packet['queryPlan'] == plan_ref and packet['profile'] == profile_ref and packet['map'] == map_ref,
             'Plan/original question/profile/map differs')
    _, queues = _fixed(root, prefix + '/queues/' + cid + '.json', artifacts)
    _shape(queues, ('caseId', 'queryEn', 'configuration', 'profile', 'map', 'queues'), 'saved queues')
    _require(queues['caseId'] == cid and queues['queryEn'] == case['queryEn'] and
             queues['configuration'] == configuration and queues['profile'] == profile_ref and queues['map'] == map_ref and
             type(queues['queues']) is list and len(queues['queues']) == len(plan['forms']), 'Saved queue scope differs')
    for queue in queues['queues']:
        _require(type(queue) is list, 'Invalid saved candidate queue')
        for candidate in queue:
            _shape(candidate, ('chunkId', 'score'), 'saved candidate')
    evidence, trace = pack(queues['queues'], structural, profile['radius'])
    _require(packet['evidence'] == evidence and packet['trace'] == trace, 'Packet differs from deterministic saved-queue replay')
    _packet(evidence, originals, sources)
    return packet_ref, packet


def _readiness(root, runtime, artifacts, registry, cases, packets, reference_ref, purpose):
    originals, sources = custody._corpus_maps(runtime, artifacts)
    entries = [e for e in registry['entries'] if e['purpose'] == purpose]
    pins = [{'role': e['role'], 'batchOrdinal': e['batchOrdinal'], 'outputDirectory': e['outputDirectory'],
             'trustedPins': e['trustedPins']} for e in entries]
    replay = replay_holdout_readiness_v4 if purpose == 'holdout-readiness' else replay_readiness_v4
    result = replay(cases, packets, originals, sources, reference_hash=reference_ref['sha256'], execution_pins=pins)
    for e in entries:
        _require(e['scope']['reference'] == reference_ref, 'Readiness reference scope differs')
    return result, entries


def replay_holdout_v4(root, runtime, artifacts, registry, configuration, private):
    cases, reference_ref = private['cases'], private['reference']
    result_ref, raw_result = custody._fixed(root, E + '/holdout/results.json', artifacts)
    record = loads_record(raw_result)
    _require(record['kind'] == 'results' and record['identity'] == runtime['identity'] and
             record['payload']['split'] == 'holdout' and record['payload']['configuration'] == configuration and
             record['payload']['references'] == reference_ref, 'Holdout results identity/scope changed')
    _require([r['caseId'] for r in record['payload']['cases']] == [c['id'] for c in cases], 'Holdout result case coverage/order changed')
    protocol_ref = custody._fixed(root, C + '/design/rag-v2-bounded/r4/semantic-protocol.md', artifacts)[0]
    case_results, packets, packet_refs, provenance = [], [], {}, []
    structural = StructuralIndex(private['sources'], private['originals'].values())
    context = _packet_context(root, runtime, artifacts, configuration, structural)
    for case, row in zip(cases, record['payload']['cases']):
        packet_ref, packet = replay_packet_v4(root, runtime, artifacts, case, configuration, E + '/holdout', context=context)
        cid = case['id']; packet_refs[cid] = packet_ref
        packets.append({'caseId': cid, 'queryEn': case['queryEn'], 'evidence': packet['evidence']})
        _require(row['packet'] == packet_ref, 'Holdout result packet differs')
        if not case['answerable']:
            _require(row['proof'] is row['metrics'] is row['legacyDiagnosticMetrics'] is None and row['completions'] == [],
                     'Negative holdout gained metric/proof/completion')
            case_results.append({'caseId': cid, 'groups': []}); continue
        ledger_ref, _ = _fixed(root, E + '/holdout/proofs/' + cid + '.json', artifacts)
        ledger = _parent(root, ledger_ref, artifacts, 'proof-ledger')
        payload = ledger['payload']
        _require(row['proof'] == ledger_ref and payload['caseId'] == cid and payload['packet'] == packet_ref and
                 payload['reference'] == reference_ref and payload['protocol'] == protocol_ref, 'Holdout ledger input binding changed')
        groups, runs = _replay_proof_case_v4(root, runtime, artifacts, registry, 'selected', case,
                     packet, packet_ref, reference_ref, protocol_ref, ledger, purpose='holdout-proof')
        _require(row['completions'] == [{'groupId': g['groupId'], 'rank': g['completionRank'], 'witness': g['witness']}
                                      for g in groups], 'Holdout completions differ from raw checks')
        _require(row['legacyDiagnosticMetrics'] == {'algorithmVersion': 'anchor-component-first-v1',
            'authority': 'HISTORICAL_DIAGNOSTIC_ONLY', 'originalArtifacts': [packet_ref]},
            'Holdout legacy diagnostics original packet differs')
        case_results.append({'caseId': cid, 'groups': groups}); provenance += runs
    legacy_refs = {'queries': [{**c, 'requiredEvidenceGroups': [{'groupId': g['id']} for g in c['groups']]} for c in cases]}
    aggregate = aggregate_groups_generic_v4(legacy_refs, case_results)
    metric = lambda r: {'semanticCompleteGroupRecallAt8': r['semanticRecallAt8'], 'semanticCompleteGroupMrrAt8': r['queryMRR']}
    scored = {c['caseId']: c for c in aggregate['cases']}
    metrics = {'cases': {c['id']: metric(scored[c['id']]) if c['answerable'] else None for c in cases},
        'macro': metric(aggregate), 'perThemeRecall': {t: r['semanticRecallAt8'] for t, r in aggregate['perTheme'].items()}}
    verify_results_metrics(record['payload'], metrics)
    _require(record['payload']['legacyDiagnosticMetrics'] == {'algorithmVersion': 'anchor-component-first-v1',
        'authority': 'HISTORICAL_DIAGNOSTIC_ONLY', 'originalArtifacts': list(packet_refs.values())},
        'Holdout aggregate legacy diagnostic inventory differs')
    readiness_ref, _ = _fixed(root, E + '/holdout/readiness.json', artifacts)
    readiness = _parent(root, readiness_ref, artifacts, 'readiness')['payload']
    _require(readiness['results'] == result_ref and readiness['references'] == reference_ref and
             [r['caseId'] for r in readiness['cases']] == [c['id'] for c in cases], 'Readiness result/reference/coverage differs')
    replay, entries = _readiness(root, runtime, artifacts, registry, cases, packets, reference_ref, 'holdout-readiness')
    by_pair = {(e['role'], e['batchOrdinal']): e for e in entries}
    for n, (case, stored, decision) in enumerate(zip(cases, readiness['cases'], replay['decisions'])):
        reader, judge = by_pair['reader', n // 3], by_pair['judge', n // 3]
        expected = {'caseId': case['id'], 'packet': packet_refs[case['id']], 'reader': stored['reader'],
            'judge': stored['judge'], 'readerResult': reader['result'], 'judgeResult': judge['result'],
            'refused': decision['refused'], 'unsupported': decision['unsupportedAccepted'],
            'wrongDeployment': decision['wrongDeploymentAccepted'],
            'coverageComplete': not decision['refused'] and decision['judgment']['verdict'] == 'supported'}
        _require(stored == expected, 'Readiness case differs from actual reader/judge output')
        _parent_execution(root, reader, stored['reader'], None, artifacts)
        _parent_execution(root, judge, stored['judge'], None, artifacts)
    provenance += replay['executionProvenance']
    return {'record': record, 'resultRef': result_ref, 'readinessRef': readiness_ref,
            'metrics': metrics, 'readiness': replay, 'provenance': provenance}


def replay_canary_v4(root, runtime, artifacts, registry, configuration):
    _, canary = _fixed(root, E + '/canary-plan.json', artifacts)
    _shape(canary, ('version', 'cases', 'configuration', 'reference', 'packets'), 'canary plan')
    _require(canary['version'] == 'canary-input-plan-v1' and canary['configuration'] == configuration and len(canary['cases']) == 4 and
             len({c['id'] for c in canary['cases']}) == 4, 'Exactly four selected canary cases required')
    cases = canary['cases']
    packets = []
    _, inventory = _fixed(root, custody.D + '/packet-inventory.json', artifacts)
    for index, case in enumerate(cases):
        matches = [r for r in inventory['rows'] if r['configuration'] == configuration and r['caseId'] == case['id']]
        _require(len(matches) == 1, 'Canary lacks selected historical adoption inventory row')
        packet_ref = matches[0]['originalPacket']
        packet = _parse(custody._registered(root, packet_ref, artifacts))
        _require(packet['query'] == case['queryEn'], 'Canary original historical query changed')
        _require(len(canary['packets']) == 4 and canary['packets'][index] == packet_ref,
                 'Canary plan packet scope differs')
        packets.append({'caseId': case['id'], 'queryEn': case['queryEn'], 'evidence': packet['evidence']})
    refs = {canonical(e['scope']['reference']): e['scope']['reference'] for e in registry['entries'] if e['purpose'] == 'integration-canary'}
    _require(len(refs) == 1, 'Missing unique canary reference')
    reference_ref = next(iter(refs.values()))
    _require(reference_ref == canary['reference'] and reference_ref['path'] == E + '/canary/references.json',
             'Canary plan canonical reference differs')
    reference = _parse(custody._registered(root, reference_ref, artifacts))
    _require(reference.get('queries') == cases, 'Canary actual references differ from predeclared plan')
    replay, _ = _readiness(root, runtime, artifacts, registry, cases, packets, reference_ref, 'integration-canary')
    _require(replay['unsupportedAccepted'] == replay['wrongDeploymentAccepted'] == replay['falseRefusals'] == 0 and
             replay['negativeRefused'] == replay['negativeCount'], 'Integration canary failed actual readiness')
    return replay


def replay_gate_v4(root, runtime, artifacts, registry, selection, configuration, old80):
    released_ref, released = _fixed(root, E + '/holdout/released-seal.json', artifacts)
    private = replay_private_labels_v4(root, runtime, artifacts, released, old80)
    holdout = replay_holdout_v4(root, runtime, artifacts, registry, configuration, private)
    canary = replay_canary_v4(root, runtime, artifacts, registry, configuration)
    gate_ref, raw_gate = custody._fixed(root, E + '/full-rag-gate.json', artifacts)
    gate = loads_record(raw_gate); payload = gate['payload']
    _require(gate['kind'] == 'gate' and gate['identity'] == runtime['identity'] and payload['verdict'] == 'PASS', 'Final gate version/identity/verdict differs')
    for field, path in (('selection', E + '/selection.json'), ('freeze', E + '/freeze.json'),
                        ('claim', E + '/claim.json'), ('unseal', E + '/unseal.json'),
                        ('referenceReview', E + '/holdout/reference-review.json'),
                        ('noveltyReview', E + '/holdout/novelty-review.json')):
        _require(payload[field] == custody._fixed(root, path, artifacts)[0], 'Gate fixed input binding differs: ' + field)
    _require(payload['results'] == holdout['resultRef'] and payload['readiness'] == holdout['readinessRef'] and
             payload['verifierImplementationHash'] == runtime['identity']['implementationManifestHash'], 'Gate verifier/result binding differs')
    verify_metrics(payload['recomputed'], holdout['metrics']['macro'])
    _require(semantic_thresholds_met(holdout['metrics']['macro'], holdout['metrics']['perThemeRecall']), 'Exact semantic holdout thresholds failed')
    readiness = holdout['readiness']
    for field in ('negativeRefused', 'falseRefusals', 'wrongDeploymentAccepted', 'unsupportedAccepted'):
        _require(type(payload[field]) is int and payload[field] == readiness[field], 'Gate readiness count differs: ' + field)
    _require(readiness['negativeCount'] == readiness['negativeRefused'] == 8 and readiness['falseRefusals'] <= 1 and
             readiness['unsupportedAccepted'] == readiness['wrongDeploymentAccepted'] == 0, 'Actual holdout readiness gate failed')
    return {'record': gate, 'gateRef': gate_ref, 'provenance': private['provenance'] + holdout['provenance'] + canary['executionProvenance']}
