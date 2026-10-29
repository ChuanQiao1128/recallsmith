"""Explicitly SYNTHETIC new40, private/public raw host records; no real calls."""
import copy
from fractions import Fraction
import json

import trusted_interfaces_v4 as core
import trusted_custody_v4 as custody
from test_full_gate_fixtures_v4 import FullFixture
from test_trusted_interfaces_v4 import common, raw, ref, _install_review
from test_dev_gate_fixtures_v4 import populate_dev, parent_execution, write_authority
from holdout_gate_replay_v4 import (THEMES, PRIVATE_INSTRUCTIONS, private_schedule, private_output_schema)
from metric_wire_v4 import encode_metrics, encode_ratio
from pipeline import canonical
from retrieval_v4 import StructuralIndex, pack, plan_query
from semantic_readiness_v4 import _cases, _judge_cases
from readiness import READER, JUDGE, reader_schema, judge_schema
from proof_transport_v4 import compact_schedule, expand_response


def _binding(f, node, event_ref, inputs):
    next(b for b in f.root['authorities'] if b['node'] == node).update(
        state='PASS', acceptedReview=None, observation=event_ref, boundInputs=inputs)


def _packet(f, case, prefix):
    cid = case['id']; profile = f.ref(core.E + '/profiles/A.json'); map_ref = f.ref(core.E + '/structural-map.json')
    planned = plan_query(case['queryEn'], profile)
    plan_ref = f.put(prefix + '/plans/' + cid + '.json', f.envelope('query-plan', planned))
    queues = [[{'chunkId': f.seed['chunkId'], 'score': 1}] for _ in planned['forms']]
    evidence, trace = pack(queues, f.structural, 1)
    f.put(prefix + '/queues/' + cid + '.json', {'caseId': cid, 'queryEn': case['queryEn'],
        'configuration': 'A', 'profile': profile, 'map': map_ref, 'queues': queues})
    packet = {'queryEn': case['queryEn'], 'queryPlan': plan_ref, 'profile': profile, 'map': map_ref,
              'evidence': evidence, 'trace': trace}
    return f.put(prefix + '/packets/' + cid + '.json', f.envelope('packet', packet)), packet


def _readiness(f, cases, packets, refs, purpose, auth, packet_refs=None):
    projected = _cases(cases, [{'caseId': c['id'], 'queryEn': p['queryEn'], 'evidence': p['evidence']} for c, p in zip(cases, packets)],
                       f.originals, f.sources, refs['sha256'])
    entries, decisions = {}, []
    for n, start in enumerate(range(0, len(cases), 3)):
        subset, labels = projected[start:start + 3], cases[start:start + 3]
        answers = [{'id': c['id'], 'verdict': 'ready' if label['answerable'] else 'needs_evidence',
            'answer': 'SYNTHETIC supported answer' if label['answerable'] else '',
            'scope': 'SYNTHETIC test deployment' if label['answerable'] else '',
            'supportingEvidenceIds': [c['evidence'][0]['evidenceId']] if label['answerable'] else [],
            'refusalReason': '' if label['answerable'] else 'SYNTHETIC missing private facts'} for c, label in zip(subset, labels)]
        judgments = [{'id': c['id'], 'verdict': 'supported' if label['answerable'] else 'correct_refusal',
                      'reason': 'SYNTHETIC independent test decision'} for c, label in zip(subset, labels)]
        for role in ('reader', 'judge'):
            body = {'cases': subset if role == 'reader' else _judge_cases(labels, subset, {r['id']: r for r in answers})}
            schema = (reader_schema if role == 'reader' else judge_schema)([c['id'] for c in subset])
            scope = {'configuration': 'selected', 'caseIds': [c['id'] for c in labels], 'groupId': None,
                'packets': [packet_refs[c['id']] if packet_refs else f.ref(core.E + '/holdout/packets/' + c['id'] + '.json') for c in labels],
                'reference': refs, 'protocol': f.protocol, 'projectionHash': core._digest(body)}
            entries[role, n] = f.raw_entry(purpose, role, n, scope, (READER if role == 'reader' else JUDGE) + canonical(body),
                schema, {'cases': answers if role == 'reader' else judgments}, authorization=auth,
                started='2026-10-29T01:10:00Z' if purpose == 'holdout-readiness' else '2026-10-29T00:30:00Z',
                observed='2026-10-29T01:11:00Z' if purpose == 'holdout-readiness' else '2026-10-29T00:31:00Z')
        for c in labels:
            reader, judge = entries['reader', n], entries['judge', n]
            decisions.append({'caseId': c['id'], 'packet': packet_refs[c['id']] if packet_refs else f.ref(core.E + '/holdout/packets/' + c['id'] + '.json'),
                'reader': parent_execution(f, reader), 'judge': parent_execution(f, judge),
                'readerResult': reader['result'], 'judgeResult': judge['result'], 'refused': not c['answerable'],
                'unsupported': False, 'wrongDeployment': False, 'coverageComplete': c['answerable']})
    return decisions


def populate_holdout(f, mutation=None):
    """Extend actual DEV fixture with a complete synthetic success branch."""
    f.structural = StructuralIndex(f.sources, f.originals.values())
    f.seed = next(c for c in f.originals.values() if
                  20 < len(f.sources[c['sourceId']]['text']) < 2000 and f.structural.eligible(c['chunkId']) and
                  f.structural.closure(c['chunkId'], 1) == [c])
    map_ref = f.put(core.E + '/structural-map.json', f.envelope('structural-map', f.structural.map()))
    for config in ('A', 'B'):
        f.put(core.E + '/profiles/' + config + '.json', f.envelope('profile',
            {'configuration': config, 'radius': 1 if config == 'A' else 2, 'map': map_ref,
             'strategy': 'vector', 'pool': 40, 'maxFacets': 4, 'maxForms': 5, 'maxCandidateAppearances': 200,
             'maxChunks': 8, 'maxChars': 12000, 'algorithm': f.ref(core.C + '/design/rag-v2-bounded/r4/algorithm.md'),
             'aliases': {}, **{k: 'v4.2' for k in ('plannerVersion', 'parserVersion', 'eligibilityVersion', 'packingVersion')}}))
    eligible = sorted((c for c in f.dev['cases'] if c['answerable'] and f.dev['packets']['A', c['id']]['evidence']),
                      key=lambda c: len(canonical(c)) + len(canonical(f.dev['packets']['A', c['id']]['evidence'])))
    canary_cases = copy.deepcopy([*eligible[:3], next(c for c in f.dev['cases'] if not c['answerable'])])
    canary_ref = f.put(core.E + '/canary/references.json', {'queries': canary_cases})
    canary_packets = [{'queryEn': c['queryEn'], 'evidence': f.dev['packets']['A', c['id']]['evidence']} for c in canary_cases]
    canary_packet_refs = {c['id']: next(r['originalPacket'] for r in f.dev['rows'] if r['configuration'] == 'A' and r['caseId'] == c['id']) for c in canary_cases}
    f.put(core.E + '/canary-plan.json', {'version': 'canary-input-plan-v1', 'configuration': 'A', 'cases': canary_cases,
        'reference': canary_ref, 'packets': [canary_packet_refs[c['id']] for c in canary_cases]})
    auth = f.auth('INTEGRATION_CANARY')
    _readiness(f, canary_cases, canary_packets, canary_ref, 'integration-canary', auth, canary_packet_refs)
    canary_report = f.put(core.E + '/canary.json', {'kind': 'SYNTHETIC-canary', 'cases': [c['id'] for c in canary_cases]})
    _install_review(f, 'integration-canary')
    accepted_path = core.T + '/reviews/integration-canary/accepted.json'
    accepted = json.loads(f.artifacts[accepted_path]); request_path = core.T + '/reviews/integration-canary/request.json'
    request = json.loads(f.artifacts[request_path])
    accepted['boundInputs'] += [canary_report, f.ref(core.E + '/canary-plan.json')]
    request['boundInputs'] = accepted['boundInputs']; accepted['rawRequest'] = f.put(request_path, request)
    accepted_ref = f.put(accepted_path, accepted)
    next(b for b in f.root['authorities'] if b['node'] == 'integration-canary').update(acceptedReview=accepted_ref, boundInputs=accepted['boundInputs'])
    selection = f.envelope('selection', {'evaluated': [{'configuration': config, 'result': f.ref(core.D + '/' + config + '/results.json'),
        'correctnessReview': next(b['acceptedReview'] for b in f.root['authorities'] if b['node'] == 'adoption-implementation-review')} for config in ('A', 'B')],
        'selected': 'A', 'profile': f.ref(core.E + '/profiles/A.json'), 'canary': canary_report,
        'historicalAttempts': 3, 'newConfigurationCount': 2, 'numericDevGate': None})
    selection['metricWireVersion'] = 'rational-pair-v1'
    selection_ref = f.put(core.E + '/selection.json', selection)
    registration = f.put(core.E + '/registration.json', f.envelope('registration', {'profile': f.ref(core.E + '/profiles/A.json'),
        'map': map_ref, 'selection': selection_ref, 'sourceRoot': core.C + '/retrieval-v3', 'enabled': True}))
    f.termination = f.evidence('SYNTHETIC builder terminated')
    f.inventory = f.put(core.T + '/worker-inventory.json', {**common('trusted-v4-worker-inventory'),
        'supervisorTask': f.root['supervisorTask'], 'workers': [{'taskId': 'builder', 'processIdentity': 'builder-process', 'startedUtc': '2026-10-28T00:00:00Z'}]})
    from pathlib import Path
    parent_path = '/Users/qc/Desktop/DeveloperCards/plans/2026-10-28-aws-basics-bilingual-rag-delivery-plan.json'
    f.parent_plan = f.put(parent_path, Path(parent_path).read_bytes())
    visited = set()
    def register_plan_refs(value):
        if isinstance(value, dict):
            if set(value) == {'path', 'sha256'} and value['path'] not in visited:
                visited.add(value['path'])
                assert value['path'].startswith('/Users/qc/Desktop/DeveloperCards/plans/') and value['path'].endswith('.json')
                content = Path(value['path']).read_bytes()
                assert f.put(value['path'], content) == value
                register_plan_refs(json.loads(content))
            else:
                for child in value.values(): register_plan_refs(child)
        elif isinstance(value, list):
            for child in value: register_plan_refs(child)
    register_plan_refs(json.loads(f.artifacts[parent_path]))
    f.freeze = f.put(core.E + '/freeze.json', f.envelope('freeze', {'selection': selection_ref, 'registration': registration,
        'reviews': [b['acceptedReview'] for b in f.root['authorities'] if b['acceptedReview']],
        'denialReceipt': f.ref(core.T + '/custodian/0.json'), 'builderTerminationReceipts': [f.termination], 'parentPlan': f.parent_plan}))
    f.observe({'event': 'FREEZE_ACCEPTED', 'freeze': f.freeze, 'selection': selection_ref},
        [('accept-freeze', f.freeze['path'], 'ACCEPTED')], [selection_ref, f.ref(core.T + '/custodian/0.json')])
    _binding(f, 'selection-freeze', f.ref(core.T + '/custodian/1.json'), [f.freeze, registration, selection_ref])
    f.observe({'event': 'BUILDERS_STOPPED', 'workers': [{'taskId': 'builder', 'processIdentity': 'builder-process',
        'startedUtc': '2026-10-28T00:00:00Z', 'stoppedUtc': '2026-10-29T01:00:01Z', 'exitObserved': True, 'launcherRecord': f.termination}],
        'completeWorkerSet': ['builder'], 'restartBlockedObserved': True},
        [('terminate', 'builder', 'TERMINATED', 0, f.termination), ('prevent-restart', 'all', 'BLOCKED')], [f.inventory])
    label_auth = f.auth('LABEL_EXECUTION')
    f.observe({'event': 'LABELS_STARTED', 'authorization': label_auth, 'privateStoreId': 'synthetic-opaque-store'},
        [('private-store', 'synthetic-opaque-store', 'CUSTODIAN_CONTROLLED'), ('labels-start', 'holdout', 'STARTED')], [label_auth])
    quote = {k: f.seed[k] for k in ('sourceId', 'sourceVersion', 'chunkId', 'evidenceId')}
    quote.update(sourceStart=f.seed['charStart'], sourceEnd=f.seed['charEnd'], quote=f.seed['text'])
    group = {'id': 'synthetic-group', 'requiredFacts': [{'id': 'fact', 'text': f.seed['text']}],
        'mandatoryScope': [{'id': 'scope', 'text': 'SYNTHETIC fixture scope'}], 'optionalFacts': [],
        'anchorSets': [{'id': 'synthetic-anchor', 'coverage': [{'atomId': atom, 'quotes': [quote], 'reason': 'SYNTHETIC test anchor'} for atom in ('fact', 'scope')]}]}
    cases = [{'id': f'v4-{theme}-{suffix}', 'module': theme, 'queryEn': f'Which SYNTHETIC {theme} fixture fact applies for {suffix}?',
        'answerable': suffix != 'n1', 'groups': [copy.deepcopy(group)] if suffix != 'n1' else [],
        'negativeReason': None if suffix != 'n1' else 'SYNTHETIC account-specific facts absent',
        'principalFactDeploymentTuples': [{'fact': f'SYNTHETIC {theme} {suffix}', 'deployment': 'SYNTHETIC fixture only'}]}
        for theme in THEMES for suffix in ('p1', 'p2', 'p3', 'p4', 'n1')]
    labels = f.envelope('references', {'split': 'holdout', 'queries': cases, 'old80': f.ref(core.C + '/evaluation/references.json')})
    labels_raw = raw(labels); reference = f.put(core.E + '/holdout/references.json', labels_raw)
    plan = {'version': 'private-label-plan-v1', 'batches': [{'batchOrdinal': n, 'slots': [{k: c[k] for k in ('id', 'module', 'answerable')} for c in cases[start:start + 3]],
        'sourceIds': [f.seed['sourceId']]} for n, start in enumerate(range(0, 40, 3))]}
    f.put(core.E + '/holdout/seal-evidence/author-plan.json', plan)
    old80 = json.loads(f.artifacts[core.C + '/evaluation/references.json'])
    private_calls, private_entries, reviews = private_schedule(plan, cases, old80, f.sources), [], {r: [] for r in PRIVATE_INSTRUCTIONS}
    novelty_reasons = {c['id']: [] for c in cases}
    for role, n, projection, start, count in sorted(private_calls, key=lambda c: (list(PRIVATE_INSTRUCTIONS).index(c[0]), c[1])):
        target = cases[start:start + count]
        result = {'cases': target} if role == 'author' else {'cases': [{'caseId': c['id'], 'verdict': 'PASS',
            'reason': 'SYNTHETIC independent test review', **({'comparedOldIds': [o['id'] for o in projection['old80']]} if role == 'novelty' else {})} for c in target]}
        if mutation == 'novelty-coverage' and role == 'novelty' and n == 0:
            result['cases'][0]['comparedOldIds'] = result['cases'][0]['comparedOldIds'][1:]
        if mutation == 'private-input' and role == 'checker' and n == 0:
            projection = copy.deepcopy(projection)
            projection['cases'][0]['groups'][0]['mandatoryScope'] = []
        if role == 'novelty':
            for row in result['cases']:
                novelty_reasons[row['caseId']].append({'comparedOldIds': row['comparedOldIds'], 'reason': row['reason']})
        f._raw_counter += 1
        directory = f'{core.E}/holdout/seal-evidence/raw/{role}/{n}'
        prompt = PRIVATE_INSTRUCTIONS[role] + canonical(projection)
        files, call, workspace = f.raw_files(core.C + '/synthetic-private/attempts/' + role + '/' + str(n), prompt,
            private_output_schema(role, f.parent_schema), result, '2026-10-29T01:00:03.5000000Z')
        file_refs = {name: f.put(directory + '/' + name, data) for name, data in files.items()}
        prompt_ref = f.put(directory + '/prompt.txt', prompt.encode())
        execution = {'role': role, 'purpose': {'author': 'label-author', 'checker': 'label-check', 'novelty': 'novelty-check'}[role],
            'batchOrdinal': n, 'originalControlRoot': core.C, 'originalOutputDirectory': core.C + '/synthetic-private/attempts/' + role + '/' + str(n),
            'originalWorkspaceId': workspace, 'callId': call, 'expectedFileHashes': {name: core._hash(data) for name, data in files.items()},
            'runtime': f.manifest['runtime'], 'prompt': prompt_ref, 'projectionHash': core._digest(projection),
            'releasedFiles': file_refs, 'checks': {key: True for key in custody.CHECKS}}
        private_entries.append(execution)
        for c in target:
            if role == 'novelty' and any(r['caseId'] == c['id'] for r in reviews[role]): continue
            binding = {b['node']: b for b in f.root['authorities']}
            parent = {'kind': 'workbench', 'workspaceId': workspace, 'callId': call, 'model': 'gpt-6-sol', 'effort': 'high',
                'auth': 'codex-subscription', 'requestHash': prompt_ref['sha256'], 'responseHash': file_refs['result.json']['sha256'],
                'rawEvents': file_refs['events.jsonl'], 'sourceReview': binding['current-source-review']['acceptedReview'],
                'denialReceipt': binding['isolation-denial']['observation'], 'completed': True, 'toolEvents': 0}
            reviews[role].append({'caseId': c['id'], 'verdict': 'PASS', 'reason': 'SYNTHETIC independent test review', 'execution': parent,
                **({'comparedOldIds': [c['id'] for c in old80['queries']]} if role == 'novelty' else {})})
    directory = core.E + '/holdout/seal-evidence'
    for row in reviews['novelty']:
        row['reason'] = canonical(novelty_reasons[row['caseId']])
    copies = {'labels': f.put(directory + '/labels.json', labels_raw)}
    for role in PRIVATE_INSTRUCTIONS:
        copies[role] = f.put(directory + '/' + role + '.json', f.envelope('novelty-review' if role == 'novelty' else 'reference-review',
            {'references': reference, 'cases': reviews[role], **({'old80': f.ref(core.C + '/evaluation/references.json')} if role == 'novelty' else {})}))
    f.nonce = bytes.fromhex('7a' * 32)
    f.private = {'schemaVersion': 4, 'cycleId': 'aws-basics-v4-1', 'privateStorePath': '/synthetic-private/store',
        'nonceHex': f.nonce.hex(), **{key: {'path': '/synthetic-private/' + key + '.json', 'sha256': value['sha256']} for key, value in copies.items()},
        'freeze': f.freeze, 'protocolHash': f.manifest['identity']['protocolHash'], 'sourceManifestHash': f.manifest['identity']['sourceManifestHash'],
        'denialReceipt': f.ref(core.T + '/custodian/0.json'), 'lastEventHash': 'f' * 64}
    f.private_raw = raw(f.private)
    f.seal = f.put(core.E + '/seal-receipt.json', f.envelope('seal-receipt', {'commitment': core._hash(f.nonce + labels_raw),
        'total': 40, 'positive': 32, 'negative': 8, 'themes': 8, 'positivePerTheme': 4, 'negativePerTheme': 1,
        'protocolHash': f.private['protocolHash'], 'sourceManifestHash': f.private['sourceManifestHash'], 'denialReceipt': f.private['denialReceipt'],
        'privateReviewCommitment': core._hash(f.nonce + raw({k: f.private[k] for k in PRIVATE_INSTRUCTIONS})), 'verdict': 'PASS'}))
    f.observe({'event': 'SEALED', 'sealReceipt': f.seal, 'commitment': core._hash(f.nonce + labels_raw),
        'privateStoreId': 'synthetic-opaque-store', 'privateManifestCommitment': core._hash(f.nonce + f.private_raw),
        'privateChecksVerified': True, 'quotaVerified': True, 'nonceBits': 256},
        [('private-checks', 'all', 'ALL_PASS'), ('quota', 'holdout', 'VERIFIED'), ('nonce-entropy', 'holdout', 'VERIFIED')], [f.seal])
    _binding(f, 'label-seal', f.ref(core.T + '/custodian/4.json'), [f.freeze, f.seal])
    f.claim(); _binding(f, 'holdout-claim', f.ref(core.T + '/custodian/5.json'), [f.freeze, f.seal, f.claim_ref])
    obs = f.unseal(); _binding(f, 'unseal', f.ref(core.T + '/custodian/6.json'), [f.freeze, f.seal, f.claim_ref, obs['detail']['unseal']])
    for i, execution in enumerate(private_entries):
        role, n = execution['role'], execution['batchOrdinal']; folder = f'{directory}/raw/{role}/{n}'
        evidence = {key: f.evidence('SYNTHETIC private ' + role + '/' + key) for key in custody.CHECKS}
        action = {**common('trusted-v4-external-action'), 'event': 'PRIVATE_REPLAY', 'source': 'custodian',
            **{key: obs[key] for key in ('supervisorTask', 'custodianRunId', 'custodianPrincipal', 'policyHash', 'runtimeManifest')},
            'processIdentity': 'synthetic-process-42', 'sequence': 7 + i, 'observedUtc': f'2026-10-29T01:{3 + i // 60:02d}:{i % 60:02d}Z',
            'inputs': [f.root['runtimeManifest'], execution['prompt'], f.freeze, f.seal, f.claim_ref, obs['detail']['unseal'], *execution['releasedFiles'].values()],
            'outcomes': [{'operation': key, 'target': role + '/' + str(n), 'result': 'VERIFIED', 'exitCode': 0, 'evidence': evidence[key]} for key in custody.CHECKS]}
        action_ref = f.put(folder + '/custodian-replay.json', action); execution['custodianReplayAction'] = action_ref
        f.put(folder + '/release-binding.json', {**common('trusted-v4-release-binding'), **{k: v for k, v in execution.items() if k not in ('purpose', 'checks')},
            'checksEvidence': evidence, 'claim': f.claim_ref, 'unseal': obs['detail']['unseal']})
    copies['privateManifest'] = f.put(directory + '/private-manifest.json', f.private_raw)
    f.put(core.E + '/holdout/released-seal.json', {**common('trusted-v4-released-seal'), **copies,
        'nonceHex': f.nonce.hex(), 'freeze': f.freeze, 'sealReceipt': f.seal, 'claim': f.claim_ref, 'unseal': obs['detail']['unseal'],
        'protocolHash': f.private['protocolHash'], 'sourceManifestHash': f.private['sourceManifestHash'], 'denialReceipt': f.private['denialReceipt'], 'executions': private_entries})
    for role, name in (('checker', 'reference-review'), ('novelty', 'novelty-review')):
        f.put(core.E + '/holdout/' + name + '.json', f.artifacts[copies[role]['path']])
    prepared_packets = {c['id']: _packet(f, c, core.E + '/holdout') for c in cases}
    holdout_auth = f.auth('HOLDOUT_EXECUTION')
    packets, result_rows = [], []
    one = {'semanticCompleteGroupRecallAt8': Fraction(1), 'semanticCompleteGroupMrrAt8': Fraction(1)}
    legacy = lambda refs: {'algorithmVersion': 'anchor-component-first-v1', 'authority': 'HISTORICAL_DIAGNOSTIC_ONLY', 'originalArtifacts': refs}
    for case in cases:
        packet_ref, packet = prepared_packets[case['id']]; packets.append(packet)
        row = {'caseId': case['id'], 'packet': packet_ref, 'proof': None, 'metrics': None, 'completions': [], 'legacyDiagnosticMetrics': None}
        if case['answerable']:
            planned = compact_schedule(case['id'], case['queryEn'], group, packet['evidence'], f.originals)
            check_refs = {}
            for call in planned['calls']:
                role = call['checkerId']; result = {'quotes': [quote], 'subsets': [{'mask': 1, 'verdict': 'PASS',
                    'coverage': [{'atomId': atom, 'quoteIndices': [0], 'reason': 'SYNTHETIC support'} for atom in call['atomIds']],
                    'deploymentConsistent': 'YES', 'reason': 'SYNTHETIC proof'}]}
                if mutation == 'quote' and case['id'] == cases[0]['id'] and role == 'one':
                    result = copy.deepcopy(result)
                    result['quotes'][0]['quote'] = 'x' * len(result['quotes'][0]['quote'])
                scope = {'configuration': 'selected', 'caseIds': [case['id']], 'groupId': group['id'], 'packets': [packet_ref],
                    'reference': reference, 'protocol': f.protocol, 'projectionHash': call['projectionHash']}
                entry = f.raw_entry('holdout-proof', role, 0, scope, call['prompt'], f.artifacts[core.P + '/semantic-v4-proof-output.schema.json'], result,
                    started='2026-10-29T01:10:00Z', observed='2026-10-29T01:11:00Z', authorization=holdout_auth)
                check_refs[role] = f.put(f'{core.E}/holdout/checks/{case["id"]}/{group["id"]}/{role}-0.json',
                    {'schemaVersion': 4, 'cycleId': 'aws-basics-v4-1', 'caseId': case['id'], 'groupId': group['id'],
                     'checkerId': role, 'packetHash': packet_ref['sha256'], 'referenceHash': reference['sha256'],
                     'protocolHash': f.protocol['sha256'], 'projectionHash': call['projectionHash'], 'execution': parent_execution(f, entry),
                     'subsets': expand_response(raw(result), call['chunkIds'], call['expectedSubsets'], atom_ids=call['atomIds'])['subsets']})
            row.update(proof=f.put(core.E + '/holdout/proofs/' + case['id'] + '.json', f.envelope('proof-ledger',
                {'caseId': case['id'], 'reference': reference, 'packet': packet_ref, 'protocol': f.protocol,
                 'groups': [{'groupId': group['id'], 'subsets': [{'chunkIds': [f.seed['chunkId']], 'checkOne': check_refs['one'], 'checkTwo': check_refs['two']}]}]})),
                metrics=encode_metrics(one), completions=[{'groupId': group['id'], 'rank': 1, 'witness': [f.seed['chunkId']]}], legacyDiagnosticMetrics=legacy([packet_ref]))
        result_rows.append(row)
    result = f.envelope('results', {'split': 'holdout', 'configuration': 'A', 'references': reference, 'cases': result_rows,
        'macro': encode_metrics(one), 'perThemeRecall': [{'theme': t, 'value': encode_ratio(Fraction(1))} for t in THEMES],
        'legacyDiagnosticMetrics': legacy([r['packet'] for r in result_rows])})
    result['metricWireVersion'] = 'rational-pair-v1'; result_ref = f.put(core.E + '/holdout/results.json', result)
    decisions = _readiness(f, cases, packets, reference, 'holdout-readiness', holdout_auth)
    ready_ref = f.put(core.E + '/holdout/readiness.json', f.envelope('readiness', {'results': result_ref, 'references': reference, 'cases': decisions}))
    gate = f.envelope('gate', {'selection': selection_ref, 'freeze': f.freeze, 'claim': f.claim_ref, 'unseal': obs['detail']['unseal'],
        'results': result_ref, 'readiness': ready_ref, 'referenceReview': f.ref(core.E + '/holdout/reference-review.json'),
        'noveltyReview': f.ref(core.E + '/holdout/novelty-review.json'), 'verdict': 'PASS', 'recomputed': encode_metrics(one),
        'negativeRefused': 8, 'falseRefusals': 0, 'wrongDeploymentAccepted': 0, 'unsupportedAccepted': 0,
        'verifierImplementationHash': f.manifest['identity']['implementationManifestHash']})
    gate['metricWireVersion'] = 'rational-pair-v1'; f.put(core.E + '/full-rag-gate.json', gate)
    _install_review(f, 'semantic-gate')
    accepted_path = core.T + '/reviews/semantic-gate/accepted.json'; accepted = json.loads(f.artifacts[accepted_path])
    request_path = core.T + '/reviews/semantic-gate/request.json'; request = json.loads(f.artifacts[request_path])
    accepted['boundInputs'] += [f.ref(core.E + '/full-rag-gate.json'), result_ref, ready_ref, f.ref(core.E + '/holdout/released-seal.json')]
    accepted['observedUtc'] = '2026-10-29T01:12:00Z'; request['boundInputs'] = accepted['boundInputs']
    accepted['rawRequest'] = f.put(request_path, request); accepted_ref = f.put(accepted_path, accepted)
    next(b for b in f.root['authorities'] if b['node'] == 'semantic-gate').update(acceptedReview=accepted_ref, boundInputs=accepted['boundInputs'])
    write_authority(f)
    goal = {'stableUid': 'synthetic-goal', 'retrievalQueryEn': 'Which SYNTHETIC source fact applies?',
            'objectiveEn': 'SYNTHETIC complete learning objective', 'objectiveZh': '合成测试目标', 'lessonOrdinal': 1}
    f.catalogue = {'goals': [goal]}; f.catalogue['curriculumHash'] = core._digest(f.catalogue)
    f.put(core.C + '/curriculum/catalogue.json', f.catalogue)
    response = {'schemaVersion': 4, 'cycleId': 'aws-basics-v4-1', 'identity': f.manifest['identity'],
        'plan': plan_query(goal['retrievalQueryEn'], f.ref(core.E + '/profiles/A.json')), 'profile': f.ref(core.E + '/profiles/A.json'),
        'map': map_ref, 'evidence': [f.seed], 'trace': []}
    response['queryPlanHash'] = core._digest(response['plan'])
    retrieval = f.put(core.C + '/authoring/synthetic-goal/v4-retrieval.json', response)
    f.goal_wrapper = {**common('trusted-v4-goal-packet'), 'schemaVersion': 4, 'identity': f.manifest['identity'],
        'goalUid': goal['stableUid'], 'goalHash': core._digest(goal), 'curriculum': f.ref(core.C + '/curriculum/catalogue.json'),
        'curriculumHash': f.catalogue['curriculumHash'], 'query': goal['retrievalQueryEn'], 'retrieval': retrieval,
        'registration': registration, 'gate': f.ref(core.E + '/full-rag-gate.json')}
    wrapper_ref = f.put(core.C + '/authoring/synthetic-goal/v4-packet.json', f.goal_wrapper)
    from semantic_gate_v4 import GOAL_RULES
    base = core.C + '/authoring/synthetic-goal'
    evidence = {
        'goal-query-binding': [f.goal_wrapper['curriculum'], wrapper_ref, retrieval],
        'selected-profile-map': [registration, retrieval, response['profile'], map_ref, f.goal_wrapper['gate']],
        'original-chunk-equality': [retrieval, f.root['runtimeManifest']],
        'a4-packet-trace': [retrieval, registration, f.root['runtimeManifest']]}
    outcomes = [{'ruleId': rule, 'outcome': 'PASS', 'evidence': evidence[rule],
                 'reason': 'SYNTHETIC supervisor-observed deterministic capture'} for rule in GOAL_RULES]
    inputs = sorted([f.root['runtimeManifest'], wrapper_ref, f.goal_wrapper['curriculum'], retrieval,
                     registration, f.goal_wrapper['gate'], response['profile'], map_ref], key=lambda r: r['path'])
    request = {k: v for k, v in common('trusted-review-request').items() if k != 'releaseAuthorized'}
    request.update(node='semantic-gate', producerTask='synthetic-capture-producer', ruleIds=list(GOAL_RULES),
                   boundInputs=inputs, requestText='SYNTHETIC exact in-memory retrieval capture checks; no retrieval executed')
    request_ref = f.put(base + '/request.json', request)
    report_ref = f.put(base + '/report.json', {'kind': 'deterministic-goal-retrieval-v1', 'goalUid': goal['stableUid'],
        'goalHash': f.goal_wrapper['goalHash'], 'response': retrieval, 'profile': response['profile'], 'map': map_ref,
        'gate': f.goal_wrapper['gate'], 'runtimeManifest': f.root['runtimeManifest'], 'ruleOutcomes': outcomes})
    f.put(base + '/accepted.json', {**common('trusted-v4-accepted-review'), 'node': 'semantic-gate',
        'rawRequest': request_ref, 'rawReport': report_ref, 'supervisorTask': f.root['supervisorTask'],
        'observedTask': 'synthetic-independent-capture', 'observedModel': 'synthetic-deterministic-producer',
        'observedEffort': 'high', 'observedUtc': '2026-10-29T01:13:00Z', 'context': 'deterministic',
        'boundInputs': inputs, 'runtimeManifest': f.root['runtimeManifest'], 'identity': f.manifest['identity'],
        'ruleOutcomes': outcomes, 'limitations': [], 'accepted': 'PASS'})
    f.finish()
    return f


def full_fixture(mutation=None):
    f = FullFixture(); f.sync_runtime(); f.install_reviews(); populate_dev(f); return populate_holdout(f, mutation)
