"""Complete temporary DEV80 chain; synthetic approvals/executions, real old pins.

No validator is mocked. Historical bytes are copied read-only; raw completions
are deliberately labelled synthetic and never persisted to production control.
"""
import copy
import json
from pathlib import Path
from fractions import Fraction

import trusted_custody_v4 as custody
from dev_adoption_v4 import prepare_dev_references_v4
from metric_wire_v4 import encode_metrics, encode_ratio
from proof_schedule_v4 import canonical, subsets
from proof_transport_v4 import compact_schedule, expand_response

C, D, P, T = custody.C, custody.D, custody.R + '/tools/content-pipeline', custody.T


def common(kind):
    return {'contractVersion': 'dev80-adoption-v1', 'cycleId': 'aws-basics-v4-1',
            'schemaVersion': 4, 'metricVersion': 'complete-group-v1',
            'releaseAuthorized': False, 'kind': kind}


def _source_ids(value, sources):
    found = set()
    if isinstance(value, dict):
        if 'sourceId' in value: found.add(value['sourceId'])
        if 'sourceHashes' in value:
            def collect(v):
                if isinstance(v, str) and v in sources: found.add(v)
                elif isinstance(v, dict):
                    for key, child in v.items(): collect(key); collect(child)
                elif isinstance(v, list):
                    for child in v: collect(child)
            collect(value['sourceHashes'])
        for child in value.values(): found |= _source_ids(child, sources)
    elif isinstance(value, list):
        for child in value: found |= _source_ids(child, sources)
    return found


def parent_execution(f, entry):
    bindings = {b['node']: b for b in f.root['authorities']}
    return {'kind': 'workbench', 'workspaceId': entry['workspaceId'], 'callId': entry['callId'],
            'model': 'gpt-6-sol', 'effort': 'high', 'auth': 'codex-subscription',
            'requestHash': entry['scope']['prompt']['sha256'], 'responseHash': entry['result']['sha256'],
            'rawEvents': entry['events'], 'sourceReview': bindings['current-source-review']['acceptedReview'],
            'denialReceipt': bindings['isolation-denial']['observation'], 'completed': True, 'toolEvents': 0}


def write_authority(f, permission='DEV_PROOF_EXECUTION'):
    d = f.dev
    pins = [{'node': b['node'], 'state': b['state'], 'receipt': b['acceptedReview'] or b['observation'],
             'boundInputs': b['boundInputs']} for b in f.root['authorities']]
    return f.put(D + '/authority.json', {**common('dev80-adoption-authority'),
        'proofConsumer': d['consumer'], 'referenceMapping': d['mapping'], 'packetInventory': d['inventory'],
        'pins': pins, 'permission': permission,
        'supervisorAuthorization': d['authorization']})


def populate_dev(f):
    """Extend FullFixture after runtime/current reviews/denial are frozen."""
    contract = json.loads(Path(P + '/semantic-v4-adoption-contract.json').read_bytes())
    pins = contract['x-contract']
    original_ref = pins['historicalReferences']
    old_raw = Path(original_ref['path']).read_bytes()
    assert f.put(original_ref['path'], old_raw) == original_ref
    for ref in pins['historicalProvenance']:
        assert f.put(ref['path'], Path(ref['path']).read_bytes()) == ref
    prepared = prepare_dev_references_v4(old_raw, f.originals, f.sources)
    original = json.loads(old_raw)
    adapted = prepared['adaptedReferences']
    adapted_ref = f.put(D + '/references.json', adapted)
    consumer = {'identity': copy.deepcopy(f.manifest['identity']), 'dependencyManifest': f.root['runtimeManifest'],
                'adoptionContract': f.ref(P + '/semantic-v4-adoption-contract.json'),
                'adoptionDocument': f.ref(P + '/SEMANTIC_V4_ADOPTION.md')}
    candidate = {**common('dev80-candidate-mapping'), 'proofConsumer': consumer,
                 'originalReferences': original_ref, 'adaptedReferences': adapted_ref,
                 'provenance': 'POST_OBSERVATION_REPRESENTATION_ONLY', 'cases': prepared['candidateCaseMaps']}
    candidate_ref = f.put(D + '/candidate-mapping.json', candidate)
    policy_ref = f.ref(P + '/semantic-v4-equivalence-input-policy-v2.json')
    policy = json.loads(f.artifacts[policy_ref['path']])
    instructions = f.artifacts[policy['instructions']['path']].decode('utf-8')
    equiv_schema = f.artifacts[policy['outputSchema']['path']]
    schedule_rows, projections, start = [], [], 0
    while start < 80:
        n = len(schedule_rows); chosen = None
        for size in range(1, min(3, 80 - start) + 1):
            olds, news = original['queries'][start:start+size], adapted['queries'][start:start+size]
            ids = _source_ids([olds, news], f.sources)
            projection = {'kind': 'dev80-source-equivalence-projection', 'batchOrdinal': n,
                'caseIds': [r['id'] for r in olds], 'originalCases': olds, 'adaptedCases': news,
                'caseMappings': candidate['cases'][start:start+size], 'sources': [{k: f.sources[sid][k]
                    for k in ('sourceId', 'sourceVersion', 'text')} for sid in sorted(ids)]}
            raw = canonical(projection).encode('utf-8'); digest = custody._hash(raw)
            prompt = instructions + canonical({'batchOrdinal': n, 'projectionHash': digest}) + '\n' + canonical(projection)
            if len(prompt) < 200000 and len(prompt.encode('utf-16-le')) // 2 < 200000:
                chosen = projection, raw, digest, prompt
        assert chosen is not None, 'Actual immutable one-case v2 projection must fit both fixed units'
        projection, raw, digest, prompt = chosen
        projection_ref = f.put(f'{D}/reviews/projections/{n}.json', raw)
        projections.append((projection, projection_ref, digest, prompt))
        schedule_rows.append({'batchOrdinal': n, 'caseIds': projection['caseIds'],
                              'projectionHash': digest, 'promptScalarCount': len(prompt)})
        start += len(projection['caseIds'])
    schedule_ref = f.put(D + '/reviews/schedule.json', {**common('dev80-equivalence-schedule'),
        'inputPolicyVersion': 'dev-equivalence-input-v2', 'inputPolicy': policy_ref,
        'candidateMapping': candidate_ref, 'batches': schedule_rows})
    equiv_auth = f.auth('DEV_EQUIVALENCE_EXECUTION', [candidate_ref, adapted_ref, schedule_ref])
    manifests = {role: [] for role in ('equivalence-one', 'equivalence-two')}
    for n, (projection, projection_ref, digest, prompt) in enumerate(projections):
        result = {'kind': 'dev80-source-equivalence-batch', 'batchOrdinal': n, 'projectionHash': digest,
            'cases': [{'caseId': c['id'], 'classificationAndOptionalStatus': 'PASS', 'groups': [
                {'groupId': g['id'], **{k: 'PASS' for k in ('claim', 'necessaryScope', 'nestedScopeClaimAndNecessaryScope',
                    'anchorSets', 'representationOnly')}, 'reason': 'SYNTHETIC test completion only'} for g in c['groups']],
                'verdict': 'PASS', 'reason': 'SYNTHETIC test completion only'} for c in projection['adaptedCases']]}
        for role in manifests:
            scope = {'configuration': 'none', 'caseIds': projection['caseIds'], 'groupId': None,
                     'packets': [], 'reference': adapted_ref, 'protocol': f.protocol, 'projectionHash': digest}
            entry = f.raw_entry('dev-equivalence', role, n, scope, prompt, equiv_schema, result,
                                authorization=equiv_auth)
            execution_ref = f.put(f'{D}/reviews/{role}/{n}/execution.json', parent_execution(f, entry))
            output_ref = f.put(f'{D}/reviews/{role}/{n}/output.json', result)
            manifests[role].append({'batchOrdinal': n, 'caseIds': projection['caseIds'],
                'execution': execution_ref, 'projection': projection_ref, 'output': output_ref,
                'workspaceId': entry['workspaceId'], 'callId': entry['callId']})
    reviews = []
    for role, batches in manifests.items():
        manifest_ref = f.put(f'{D}/reviews/{role}/manifest.json', {**common('dev80-equivalence-review-manifest'),
            'role': role, 'candidateMapping': candidate_ref, 'schedule': schedule_ref, 'batches': batches})
        reviews.append({'role': role, 'manifest': manifest_ref})
    mapping = {**candidate, 'kind': 'dev80-reference-mapping', 'candidateMapping': candidate_ref, 'independentReviews': reviews}
    mapping_ref = f.put(D + '/reference-mapping.json', mapping)
    # The later independent equivalence review binds the actual mapping and both
    # genuine-shaped raw streams, rather than only the consumer source runtime.
    binding = next(b for b in f.root['authorities'] if b['node'] == 'reference-equivalence')
    accepted = json.loads(f.artifacts[binding['acceptedReview']['path']])
    review_inputs = [*accepted['boundInputs'], mapping_ref, candidate_ref, adapted_ref,
                     *[r['manifest'] for r in reviews]]
    request = json.loads(f.artifacts[accepted['rawRequest']['path']]); request['boundInputs'] = review_inputs
    accepted['rawRequest'] = f.put(accepted['rawRequest']['path'], request)
    accepted['boundInputs'] = review_inputs; accepted['observedUtc'] = '2026-10-29T00:11:01Z'
    binding.update(acceptedReview=f.put(binding['acceptedReview']['path'], accepted), boundInputs=review_inputs)
    rows, packets = [], {}
    for config in ('A', 'B'):
        for case in sorted(original['queries'], key=lambda c: c['id']):
            cid = case['id']; path = C + f'/evidence/r4-observed80-diagnostic/{config}/{cid}.json'
            raw = Path(path).read_bytes(); old_ref = f.put(path, raw); packet = json.loads(raw)
            wrapper = {**common('dev80-historical-packet-adoption'), 'configuration': config, 'caseId': cid,
                'originalPacket': old_ref, 'originalProvenance': pins['historicalProvenance'],
                'originalRetrievalIdentityHash': custody._digest({'packet': old_ref, 'provenance': pins['historicalProvenance']}),
                'proofConsumer': consumer, 'referenceMapping': mapping_ref, 'admission': 'IMMUTABLE_INPUT_ONLY',
                **{'original' + field + 'Hash': custody._digest(packet[key]) for field, key in
                    (('Evidence', 'evidence'), ('Plan', 'plan'), ('Queues', 'candidateQueues'), ('Trace', 'trace'))}}
            wrapper_ref = f.put(f'{D}/{config}/packets/{cid}.json', wrapper)
            rows.append({'configuration': config, 'caseId': cid, 'originalPacket': old_ref, 'packetAdoption': wrapper_ref})
            packets[config, cid] = packet
    inventory_ref = f.put(D + '/packet-inventory.json', {**common('dev80-adopted-packet-inventory'),
        'proofConsumer': consumer, 'referenceMapping': mapping_ref, 'adaptedReferences': adapted_ref, 'rows': rows})
    authorization = f.auth('DEV_PROOF_EXECUTION', [mapping_ref, inventory_ref, adapted_ref])
    auth_record = json.loads(f.artifacts[authorization['path']]); auth_record['observedUtc'] = '2026-10-29T00:12:00Z'
    authorization = f.put(authorization['path'], auth_record)
    f.dev = {'consumer': consumer, 'mapping': mapping_ref, 'references': adapted_ref,
             'inventory': inventory_ref, 'authorization': authorization, 'cases': adapted['queries'],
             'packets': packets, 'schedule': schedule_ref, 'rows': rows}
    write_authority(f)
    proof_schema = f.artifacts[P + '/semantic-v4-proof-output.schema.json']
    index = {(r['configuration'], r['caseId']): r for r in rows}
    zero = encode_metrics({'semanticCompleteGroupRecallAt8': Fraction(0), 'semanticCompleteGroupMrrAt8': Fraction(0)})
    for config in ('A', 'B'):
        result_rows = []
        legacy_ref = next(r for r in pins['historicalProvenance'] if
                          r['path'] == C + '/evidence/r4-observed80-diagnostic/' + config + '/results.json')
        for case in adapted['queries']:
            cid = case['id']; row = index[config, cid]; packet = packets[config, cid]
            if not case['answerable']:
                result_rows.append({'caseId': cid, 'packet': row['originalPacket'], 'proof': None,
                                    'metrics': None, 'completions': [], 'legacyDiagnosticMetrics': None}); continue
            ledger_groups = []
            for group in case['groups']:
                plan = compact_schedule(cid, case['queryEn'], group, packet['evidence'], f.originals)
                check_refs = {}
                ordinals = {'one': 0, 'two': 0}
                for call in plan['calls']:
                    role = call['checkerId']; n = ordinals[role]; ordinals[role] += 1
                    bit = {c: 1 << i for i, c in enumerate(call['chunkIds'])}
                    raw_result = {'quotes': [], 'subsets': [{'mask': sum(bit[c] for c in member),
                        'verdict': 'UNKNOWN', 'coverage': [], 'deploymentConsistent': 'UNKNOWN',
                        'reason': 'SYNTHETIC no credit'} for member in call['expectedSubsets']]}
                    scope = {'configuration': config, 'caseIds': [cid], 'groupId': group['id'],
                        'packets': [row['originalPacket']], 'reference': adapted_ref, 'protocol': f.protocol,
                        'projectionHash': call['projectionHash']}
                    entry = f.raw_entry('dev-proof', role, n, scope, call['prompt'], proof_schema, raw_result,
                                        started='2026-10-29T00:20:00Z', observed='2026-10-29T00:21:00Z',
                                        authorization=authorization)
                    expanded = expand_response(f.artifacts[entry['result']['path']], call['chunkIds'],
                                              call['expectedSubsets'], atom_ids=call['atomIds'])
                    check = {'schemaVersion': 4, 'cycleId': 'aws-basics-v4-1', 'caseId': cid, 'groupId': group['id'],
                        'packetHash': row['originalPacket']['sha256'], 'referenceHash': adapted_ref['sha256'],
                        'protocolHash': f.protocol['sha256'], 'projectionHash': call['projectionHash'],
                        'checkerId': role, 'execution': parent_execution(f, entry), 'subsets': expanded['subsets']}
                    check_ref = f.put(f'{D}/{config}/checks/{cid}/{group["id"]}/{role}-{n}.json', check)
                    for member in call['expectedSubsets']: check_refs[role, tuple(member)] = check_ref
                ledger_groups.append({'groupId': group['id'], 'subsets': [
                    {'chunkIds': list(member), 'checkOne': check_refs['one', tuple(member)],
                     'checkTwo': check_refs['two', tuple(member)]} for member in subsets(c['chunkId'] for c in packet['evidence'])]})
            ledger_ref = f.put(f'{D}/{config}/proofs/{cid}.json', {**common('dev80-adoption-proof-ledger'),
                'proofConsumer': consumer, 'referenceMapping': mapping_ref, 'adaptedReferences': adapted_ref,
                'packetInventory': inventory_ref, 'authorization': authorization, 'configuration': config,
                'originalPacket': row['originalPacket'], 'packetAdoption': row['packetAdoption'],
                'payload': {'caseId': cid, 'reference': adapted_ref, 'packet': row['originalPacket'],
                            'protocol': f.protocol, 'groups': ledger_groups}})
            result_rows.append({'caseId': cid, 'packet': row['originalPacket'], 'proof': ledger_ref, 'metrics': zero,
                'completions': [{'groupId': g['id'], 'rank': None, 'witness': []} for g in case['groups']],
                'legacyDiagnosticMetrics': {'algorithmVersion': 'anchor-component-first-v1',
                    'authority': 'HISTORICAL_DIAGNOSTIC_ONLY', 'originalArtifacts': [row['originalPacket'], legacy_ref]}})
        f.put(f'{D}/{config}/results.json', {**common('dev80-adoption-results'), 'metricWireVersion': 'rational-pair-v1',
            'proofConsumer': consumer, 'referenceMapping': mapping_ref, 'adaptedReferences': adapted_ref,
            'packetInventory': inventory_ref, 'authorization': authorization, 'configuration': config,
            'payload': {'split': 'dev', 'configuration': config, 'references': adapted_ref, 'cases': result_rows,
                'macro': zero, 'perThemeRecall': [{'theme': theme, 'value': encode_ratio(Fraction(0))}
                     for theme in ('cloud', 'identity', 'compute', 'storage', 'databases', 'networking', 'messaging', 'operations')],
                'legacyDiagnosticMetrics': {'algorithmVersion': 'anchor-component-first-v1',
                    'authority': 'HISTORICAL_DIAGNOSTIC_ONLY',
                    'originalArtifacts': [r['originalPacket'] for r in rows if r['configuration'] == config] + [legacy_ref]}}})
    return f.dev
