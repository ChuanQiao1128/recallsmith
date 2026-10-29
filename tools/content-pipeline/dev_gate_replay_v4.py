"""Pure replay of supervisor-registered DEV adoption bytes; never grants release.

The fixed production loader validates runtime, authority and registry first. This
module has no alternate root, expected-hash override, filesystem reads or model
calls. Historical numeric diagnostics are never converted to semantic metrics.
"""
from fractions import Fraction
from functools import lru_cache
import json

from referencing import Registry

import trusted_custody_v4 as custody
from dev_adoption_v4 import prepare_dev_references_v4
from execution_receipt_v4 import _json, _verify_execution_bytes_v4
from metric_wire_v4 import verify_results_metrics
from proof_schedule_v4 import canonical, subsets
from proof_transport_v4 import compact_schedule, expand_response
from semantic_proof_v4 import _packet, inspect_decisions_v4
from semantic_runtime_v4 import aggregate_groups_v4

C, R, D, E, T = custody.C, custody.R, custody.D, custody.E, custody.T
P = R + '/tools/content-pipeline'
_require, _digest = custody._require, custody._digest


def _parse(raw):
    # Strict parsing precedes the historical canonical serializer's float form.
    _json(raw)
    return json.loads(raw)


def _schema(artifacts):
    return _parse(artifacts[P + '/semantic-v4-adoption-contract.json'])


def _validate(value, name, artifacts):
    schema = _schema(artifacts)
    try:
        if name == 'EquivalenceSchedule' and value.get('inputPolicyVersion') == 'dev-equivalence-input-v2':
            schema = _parse(artifacts[P + '/semantic-v4-equivalence-schedule-v2.schema.json'])
            custody._VALIDATOR(schema, registry=Registry()).validate(value)
        else:
            custody._VALIDATOR({'$ref': '#/$defs/' + name, '$defs': schema['$defs']},
                              registry=Registry()).validate(value)
    except Exception as exc:
        raise ValueError('Invalid closed adoption ' + name) from exc
    return value


def _fixed(root, path, artifacts, name=None):
    ref, raw = custody._fixed(root, path, artifacts)
    value = _parse(raw)
    return ref, _validate(value, name, artifacts) if name else value


def _consumer(root, runtime, artifacts, consumer):
    expected = {'identity': runtime['identity'], 'dependencyManifest': root['runtimeManifest'],
                'adoptionContract': custody._fixed(root, P + '/semantic-v4-adoption-contract.json', artifacts)[0],
                'adoptionDocument': custody._fixed(root, P + '/SEMANTIC_V4_ADOPTION.md', artifacts)[0]}
    _require(consumer == expected, 'Fresh full proof consumer differs from registered runtime')
    return expected


@lru_cache(maxsize=16)
def _authorization_utc_from_bytes(raw):
    """Cache only immutable authorization parsing, never an execution decision."""
    return custody._utc(custody._parse(raw)['observedUtc'])


def _execution(root, runtime, artifacts, entry, prompt, schema_bytes):
    directory = custody._output(custody._core(), entry)
    _require(entry['outputDirectory'] == directory and
             custody._registered(root, entry['scope']['prompt'], artifacts) == prompt.encode('utf-8'),
             'Registered prompt differs from full deterministic rebuild')
    raw = custody._six(root, {k: entry[k] for k in custody.SIX},
                      entry['trustedPins']['expectedFileHashes'], directory, artifacts)
    policy = custody._equivalence_policy(runtime, artifacts) if entry['purpose'] == 'dev-equivalence' else None
    receipt = _verify_execution_bytes_v4(raw, directory, frozen_prompt=prompt,
             frozen_schema_bytes=schema_bytes, trusted_pins=entry['trustedPins'],
             input_policy=policy['inputPolicyVersion'] if policy else None)
    _require(receipt['callId'] == entry['callId'] and receipt['workspaceId'] == entry['workspaceId'],
             'Registered actual execution identity differs')
    authorized_utc = _authorization_utc_from_bytes(custody._registered(root, entry['authorization'], artifacts))
    invocation = custody._parse(raw['invocation.json'])
    _require(authorized_utc < custody._utc(invocation.get('startedUtc')) <=
             custody._utc(entry['observedUtc']), 'Authorization/start/observation order changed')
    return receipt


def _parent_execution(root, entry, execution, receipt, artifacts):
    source = next(x for x in root['authorities'] if x['node'] == 'current-source-review')
    denial = next(x for x in root['authorities'] if x['node'] == 'isolation-denial')
    expected = {'kind': 'workbench', 'workspaceId': entry['workspaceId'], 'callId': entry['callId'],
                'model': 'gpt-6-sol', 'effort': 'high', 'auth': 'codex-subscription',
                'requestHash': entry['scope']['prompt']['sha256'], 'responseHash': entry['result']['sha256'],
                'rawEvents': entry['events'], 'sourceReview': source['acceptedReview'],
                'denialReceipt': denial['observation'], 'completed': True, 'toolEvents': 0}
    _require(execution == expected, 'Parent execution does not bind actual registered raw receipt')
    for key in ('rawEvents', 'sourceReview', 'denialReceipt'):
        custody._registered(root, execution[key], artifacts)


def _equivalence(root, runtime, artifacts, registry, candidate_ref, mapping):
    # Reuses the reviewed full source union, greedy schedule and exact prompts.
    custody._validate_equivalence_scopes(root, runtime, registry, artifacts)
    schedule_ref, schedule = _fixed(root, D + '/reviews/schedule.json', artifacts, 'EquivalenceSchedule')
    _require(schedule['candidateMapping'] == candidate_ref, 'Equivalence candidate differs')
    reviews = mapping['independentReviews']
    _require([x['role'] for x in reviews] == ['equivalence-one', 'equivalence-two'],
             'Exactly two ordered independent equivalence role streams required')
    provenance = []
    entries = [e for e in registry['entries'] if e['purpose'] == 'dev-equivalence']
    _require(len(entries) == 2 * len(schedule['batches']), 'Incomplete equivalence executions')
    for review in reviews:
        role = review['role']
        manifest_ref, manifest = _fixed(root, D + '/reviews/' + role + '/manifest.json', artifacts,
                                         'EquivalenceReviewManifest')
        _require(review['manifest'] == manifest_ref and manifest['role'] == role and
                 manifest['candidateMapping'] == candidate_ref and manifest['schedule'] == schedule_ref and
                 len(manifest['batches']) == len(schedule['batches']), 'Equivalence manifest bindings changed')
        for ordinal, (batch, planned) in enumerate(zip(manifest['batches'], schedule['batches'])):
            _require(batch['batchOrdinal'] == ordinal and batch['caseIds'] == planned['caseIds'],
                     'Equivalence manifest case/ordinal order changed')
            matches = [e for e in entries if e['role'] == role and e['batchOrdinal'] == ordinal]
            _require(len(matches) == 1, 'Missing/duplicate equivalence role/batch')
            entry = matches[0]
            projection_ref, projection = _fixed(root, f'{D}/reviews/projections/{ordinal}.json', artifacts,
                                                'EquivalenceProjection')
            execution_ref, execution = _fixed(root, f'{D}/reviews/{role}/{ordinal}/execution.json', artifacts,
                                               'Execution')
            output_ref, output = _fixed(root, f'{D}/reviews/{role}/{ordinal}/output.json', artifacts,
                                         'EquivalenceBatchOutput')
            _require(batch['projection'] == projection_ref and batch['execution'] == execution_ref and
                     batch['output'] == output_ref and batch['callId'] == entry['callId'] and
                     batch['workspaceId'] == entry['workspaceId'], 'Equivalence artifact/actual identity mismatch')
            prompt = custody._registered(root, entry['scope']['prompt'], artifacts).decode('utf-8')
            schema_bytes = custody._registered(root, entry['emittedSchema'], artifacts)
            receipt = _execution(root, runtime, artifacts, entry, prompt, schema_bytes)
            _parent_execution(root, entry, execution, receipt, artifacts)
            _require(output == _parse(receipt['rawResultBytes']) and
                     output['batchOrdinal'] == ordinal and output['projectionHash'] == planned['projectionHash'] and
                     [x['caseId'] for x in output['cases']] == planned['caseIds'],
                     'Equivalence output differs from raw completed bytes/order')
            for case, original in zip(output['cases'], projection['originalCases']):
                _require(case['verdict'] == case['classificationAndOptionalStatus'] == 'PASS' and
                         [g['groupId'] for g in case['groups']] ==
                         [g['groupId'] for g in original['requiredEvidenceGroups']],
                         'Equivalence case/group coverage or classification failed')
                for group in case['groups']:
                    _require(all(group[k] == 'PASS' for k in ('claim', 'necessaryScope',
                             'nestedScopeClaimAndNecessaryScope', 'anchorSets', 'representationOnly')),
                             'Every outer/nested mandatory text and anchor verdict must PASS')
            provenance.append({'callId': entry['callId'], 'workspaceId': entry['workspaceId'],
                               'outputDirectory': entry['outputDirectory'], 'purpose': 'dev-equivalence'})
    return provenance


def replay_dev_adoption_v4(root, runtime, artifacts, registry, permission):
    """Replay R01–R11 and external adoption authority from validated loader data."""
    _require(permission in ('ADOPT_INPUTS_ONLY', 'DEV_PROOF_EXECUTION'), 'Unsupported DEV permission')
    contract = _schema(artifacts)['x-contract']
    for ref in contract['parentContracts'] + [contract['historicalReferences']] + contract['historicalProvenance']:
        custody._registered(root, ref, artifacts)
    raw_original = custody._registered(root, contract['historicalReferences'], artifacts)
    originals, sources = custody._corpus_maps(runtime, artifacts)
    prepared = prepare_dev_references_v4(raw_original, originals, sources)
    reference_ref, references = _fixed(root, D + '/references.json', artifacts, 'AdaptedReferences')
    candidate_ref, candidate = _fixed(root, D + '/candidate-mapping.json', artifacts, 'CandidateMapping')
    mapping_ref, mapping = _fixed(root, D + '/reference-mapping.json', artifacts, 'ReferenceMapping')
    _require(references == prepared['adaptedReferences'] and
             candidate['cases'] == mapping['cases'] == prepared['candidateCaseMaps'],
             'Representation, all field maps or exact source-only anchors changed')
    consumer = _consumer(root, runtime, artifacts, mapping['proofConsumer'])
    for record in (candidate, mapping):
        _require(record['proofConsumer'] == consumer and record['originalReferences'] == contract['historicalReferences'] and
                 record['adaptedReferences'] == reference_ref, 'Mapping historical/current identity mismatch')
    _require(mapping['candidateMapping'] == candidate_ref, 'Final mapping candidate changed')
    provenance = _equivalence(root, runtime, artifacts, registry, candidate_ref, mapping)
    inventory_ref, inventory = _fixed(root, D + '/packet-inventory.json', artifacts, 'PacketInventory')
    _require(inventory['proofConsumer'] == consumer and inventory['referenceMapping'] == mapping_ref and
             inventory['adaptedReferences'] == reference_ref, 'Inventory current identity mismatch')
    cases = references['queries']
    expected_order = [(config, case['id']) for config in ('A', 'B') for case in sorted(cases, key=lambda x: x['id'])]
    _require([(r['configuration'], r['caseId']) for r in inventory['rows']] == expected_order,
             'Inventory must include exact ordered160 historical packets')
    saved, packets = [], {}
    frozen_plan = _parse(custody._registered(root, contract['historicalProvenance'][0], artifacts))
    # Old implementation/model-cache paths remain retained historical data; they
    # must never be relabelled as the current consumer's dependency identity.
    for path in (contract['historicalReferences']['path'], custody.CORPUS + '/manifest.json',
                 custody.CORPUS + '/chunks.json', custody.CORPUS + '/index.json'):
        custody._registered(root, {'path': path, 'sha256': frozen_plan['beforeHashes'][path]}, artifacts)
    original_cases = {c['id']: c for c in _parse(raw_original)['queries']}
    for row in inventory['rows']:
        config, cid = row['configuration'], row['caseId']
        original_path = C + f'/evidence/r4-observed80-diagnostic/{config}/{cid}.json'
        _require(row['originalPacket']['path'] == original_path, 'Historical packet relocated')
        packet = _parse(custody._registered(root, row['originalPacket'], artifacts))
        adoption_ref, adoption = _fixed(root, f'{D}/{config}/packets/{cid}.json', artifacts, 'PacketAdoption')
        _require(row['packetAdoption'] == adoption_ref and adoption['configuration'] == config and
                 adoption['caseId'] == cid and adoption['originalPacket'] == row['originalPacket'] and
                 adoption['originalProvenance'] == contract['historicalProvenance'] and
                 adoption['referenceMapping'] == mapping_ref and adoption['proofConsumer'] == consumer and
                 adoption['originalRetrievalIdentityHash'] == _digest({'packet': row['originalPacket'],
                    'provenance': contract['historicalProvenance']}), 'Historical adoption linkage changed')
        for field, old in (('Evidence', 'evidence'), ('Plan', 'plan'), ('Queues', 'candidateQueues'), ('Trace', 'trace')):
            _require(adoption['original' + field + 'Hash'] == _digest(packet[old]), 'Historical packet component changed')
        _require(packet['query'] == original_cases[cid]['queryEn'] and packet['configuration'] == config and
                 type(packet['retrievalConfigVersion']) is int and packet['retrievalConfigVersion'] == 4 and
                 packet['corpusVersion'] == runtime['identity']['corpusVersion'] and
                 packet['status'] == 'development_only_not_semantically_validated' and
                 packet['releaseAuthorized'] is False, 'Historical packet query/configuration/provenance changed')
        _packet(packet['evidence'], originals, sources)
        packets[config, cid] = packet
        saved.append({'configuration': config, 'caseId': cid, **{'path': original_path, 'sha256': row['originalPacket']['sha256']}})
    _require(_digest(saved) == contract['savedPacketInventoryHash'], 'Immutable160 packet inventory pin differs')
    authority_ref, authority = _fixed(root, D + '/authority.json', artifacts, 'Authority')
    _require(authority['proofConsumer'] == consumer and authority['referenceMapping'] == mapping_ref and
             authority['packetInventory'] == inventory_ref and authority['permission'] == permission,
             'Adoption authority exact permission/inputs differ')
    bindings = {x['node']: x for x in root['authorities']}
    _require([x['node'] for x in authority['pins']] == contract['authorityNodes'], 'Authority pins coverage/order changed')
    for pin in authority['pins']:
        bound = bindings[pin['node']]
        _require(pin == {'node': bound['node'], 'state': bound['state'],
                 'receipt': bound['acceptedReview'] or bound['observation'], 'boundInputs': bound['boundInputs']},
                 'Authority self-attested/current pin mismatch')
    required = ('contract-review', 'reference-equivalence', 'adoption-implementation-review')
    if permission == 'DEV_PROOF_EXECUTION': required += ('current-source-review', 'isolation-denial')
    _require(all(bindings[n]['state'] == 'PASS' for n in required), 'Current adoption prerequisite is not PASS')
    contract_inputs = {canonical(r) for r in bindings['contract-review']['boundInputs']}
    required_contracts = [consumer['adoptionContract'], consumer['adoptionDocument']]
    required_contracts += [e['artifact'] for e in runtime['entries'] if e['role'] in
                          ('equivalence-input-policy', 'equivalence-instructions',
                           'equivalence-output-schema', 'equivalence-schedule-schema')]
    _require({canonical(r) for r in required_contracts} <= contract_inputs,
             'Current contract review omits actual adoption/versioned equivalence files')
    implementation_inputs = {canonical(r) for r in bindings['adoption-implementation-review']['boundInputs']}
    _require({canonical(root['runtimeManifest']), *[canonical(e['artifact']) for e in runtime['entries']]} <=
             implementation_inputs, 'Current implementation review omits full consumer dependency closure')
    equivalence_inputs = {canonical(r) for r in bindings['reference-equivalence']['boundInputs']}
    _require({canonical(mapping_ref), canonical(candidate_ref), canonical(reference_ref),
              *[canonical(r['manifest']) for r in mapping['independentReviews']]} <= equivalence_inputs,
             'Current independent equivalence review does not bind actual mapping/full streams')
    auth_ref, auth = _fixed(root, T + '/authorizations/' + permission + '.json', artifacts)
    _require(authority['supervisorAuthorization'] == auth_ref and auth['permission'] == permission and
             auth['identity'] == runtime['identity'] and auth['runtimeManifest'] == root['runtimeManifest'],
             'External supervisor adoption authorization mismatch')
    _require({canonical(mapping_ref), canonical(inventory_ref)} <= {canonical(r) for r in auth['boundInputs']},
             'External authorization omits exact mapping/inventory')
    return {'record': authority, 'refs': {'mapping': mapping_ref, 'reference': reference_ref,
            'inventory': inventory_ref, 'authorization': auth_ref, 'authority': authority_ref},
            'cases': cases, 'inventory': inventory, 'consumer': consumer, 'packets': packets,
            'originalReferences': _parse(raw_original), 'rawOriginalReferences': raw_original,
            'provenance': provenance, 'originals': originals, 'sources': sources}


def _replay_proof_case_v4(root, runtime, artifacts, registry, configuration, case, packet,
                          packet_ref, reference_ref, protocol_ref, ledger, purpose='dev-proof', corpus=None):
    """Rebuild complete checks from six-file bytes, shared with holdout replay."""
    originals, sources = custody._corpus_maps(runtime, artifacts) if corpus is None else corpus
    evidence = packet['evidence']
    _require(packet.get('query', packet.get('queryEn')) == case['queryEn'], 'Original query changed')
    _packet(evidence, originals, sources)
    groups, provenance = [], []
    _require([g['groupId'] for g in ledger['payload']['groups']] == [g['id'] for g in case['groups']],
             'Ledger must retain all required groups in original order')
    for group, ledger_group in zip(case['groups'], ledger['payload']['groups']):
        planned = compact_schedule(case['id'], case['queryEn'], group, evidence, originals)
        role_calls = [c for c in planned['calls'] if c['checkerId'] == 'one']
        bindings = {'packetHash': packet_ref['sha256'], 'referenceHash': reference_ref['sha256'],
                    'protocolHash': protocol_ref['sha256'], 'batches': [
                    {'projectionHash': c['projectionHash'], 'subsets': [list(s) for s in c['expectedSubsets']]}
                    for c in role_calls]}
        entries = [e for e in registry['entries'] if e['purpose'] == purpose and
                   e['scope']['configuration'] == configuration and e['scope']['caseIds'] == [case['id']] and
                   e['scope']['groupId'] == group['id']]
        pairs = {(e['role'], e['batchOrdinal']): e for e in entries}
        _require(len(entries) == len(pairs) == len(planned['calls']) and set(pairs) ==
                 {(r, n) for r in ('one', 'two') for n in range(len(role_calls))},
                 'Missing/duplicate raw checker execution coverage')
        decisions, refs_by_subset = {'one': [], 'two': []}, {}
        for call in planned['calls']:
            role = call['checkerId']; ordinal = len(decisions[role]); entry = pairs[role, ordinal]
            _require(entry['scope']['packets'] == [packet_ref] and entry['scope']['reference'] == reference_ref and
                     entry['scope']['protocol'] == protocol_ref and entry['scope']['projectionHash'] == call['projectionHash'],
                     'Proof execution scope differs from original full inputs')
            schema_bytes = custody._registered(root, entry['emittedSchema'], artifacts)
            _require(schema_bytes == artifacts[P + '/semantic-v4-proof-output.schema.json'], 'Proof schema changed')
            receipt = _execution(root, runtime, artifacts, entry, call['prompt'], schema_bytes)
            expanded = expand_response(receipt['rawResultBytes'], call['chunkIds'], call['expectedSubsets'], atom_ids=call['atomIds'])
            decisions[role].append(expanded['subsets'])
            prefix = f'{D}/{configuration}/checks' if purpose == 'dev-proof' else E + '/holdout/checks'
            check_ref, check = _fixed(root, f'{prefix}/{case["id"]}/{group["id"]}/{role}-{ordinal}.json', artifacts)
            _validate(check, 'Check', artifacts)
            _parent_execution(root, entry, check['execution'], receipt, artifacts)
            expected = {'schemaVersion': 4, 'cycleId': 'aws-basics-v4-1', 'caseId': case['id'], 'groupId': group['id'],
                        **{k: bindings[k] for k in ('packetHash', 'referenceHash', 'protocolHash')},
                        'projectionHash': call['projectionHash'], 'checkerId': role,
                        'execution': check['execution'], 'subsets': expanded['subsets']}
            _require(check == expected, 'Check differs from decoded actual raw output/full bindings')
            for member in call['expectedSubsets']: refs_by_subset[role, tuple(member)] = check_ref
            provenance.append({'checkerId': role, 'batchOrdinal': ordinal, 'callId': entry['callId'],
                               'workspaceId': entry['workspaceId'], 'outputDirectory': entry['outputDirectory']})
        expected_subsets = [{'chunkIds': list(member), 'checkOne': refs_by_subset['one', tuple(member)],
                             'checkTwo': refs_by_subset['two', tuple(member)]}
                            for member in subsets(c['chunkId'] for c in evidence)]
        _require(ledger_group['subsets'] == expected_subsets, 'Ledger subset membership/check references changed')
        result = inspect_decisions_v4(case['id'], group, evidence, originals, sources,
                                     decisions['one'], decisions['two'], bindings)
        group_runs = provenance[-len(planned['calls']):] if planned['calls'] else []
        groups.append({**result, 'caseId': case['id'], 'cycleId': 'aws-basics-v4-1', 'perCallSubsetLimit': planned['perCallSubsetLimit'],
                       'executionProvenance': group_runs, 'executionAuthenticity': 'HOST_RECORDS_ONLY'})
    return groups, provenance


def replay_dev_results_v4(root, runtime, artifacts, registry, configuration, adoption=None):
    """Recompute exact full80 metrics from complete raw proof decisions."""
    _require(configuration in ('A', 'B'), 'Only original A/B configurations allowed')
    adoption = replay_dev_adoption_v4(root, runtime, artifacts, registry, 'DEV_PROOF_EXECUTION') if adoption is None else adoption
    result_ref, record = _fixed(root, f'{D}/{configuration}/results.json', artifacts, 'DevResults')
    refs = adoption['refs']; payload = record['payload']
    for field, ref in (('referenceMapping', refs['mapping']), ('adaptedReferences', refs['reference']),
                       ('packetInventory', refs['inventory']), ('authorization', refs['authorization'])):
        _require(record[field] == ref, 'DEV results shared binding changed: ' + field)
    _require(record['proofConsumer'] == adoption['consumer'] and record['configuration'] == payload['configuration'] == configuration and
             payload['references'] == refs['reference'] and [r['caseId'] for r in payload['cases']] ==
             [c['id'] for c in adoption['cases']], 'DEV results identity/case order changed')
    inventory = {(r['configuration'], r['caseId']): r for r in adoption['inventory']['rows']}
    legacy_path = C + '/evidence/r4-observed80-diagnostic/' + configuration + '/results.json'
    legacy_refs = [r for r in _schema(artifacts)['x-contract']['historicalProvenance'] if r['path'] == legacy_path]
    _require(len(legacy_refs) == 1, 'Missing fixed historical configuration results provenance')
    legacy_ref = legacy_refs[0]
    custody._registered(root, legacy_ref, artifacts)
    protocol_ref = custody._fixed(root, C + '/design/rag-v2-bounded/r4/semantic-protocol.md', artifacts)[0]
    case_results, provenance = [], list(adoption['provenance'])
    for case, row in zip(adoption['cases'], payload['cases']):
        cid = case['id']; inv = inventory[configuration, cid]
        _require(row['packet'] == inv['originalPacket'], 'Result original packet differs')
        if not case['answerable']:
            _require(row['metrics'] is row['proof'] is row['legacyDiagnosticMetrics'] is None and row['completions'] == [],
                     'Negative case gained metrics/proof/completion')
            case_results.append({'caseId': cid, 'groups': []}); continue
        ledger_ref, ledger = _fixed(root, f'{D}/{configuration}/proofs/{cid}.json', artifacts, 'DevProofLedger')
        _require(row['proof'] == ledger_ref and ledger['configuration'] == configuration and
                 ledger['originalPacket'] == inv['originalPacket'] and ledger['packetAdoption'] == inv['packetAdoption'] and
                 ledger['proofConsumer'] == adoption['consumer'], 'DEV ledger historical/current identity differs')
        for field, ref in (('referenceMapping', refs['mapping']), ('adaptedReferences', refs['reference']),
                           ('packetInventory', refs['inventory']), ('authorization', refs['authorization'])):
            _require(ledger[field] == ref, 'DEV ledger shared binding changed')
        body = ledger['payload']
        _require(body['caseId'] == cid and body['packet'] == inv['originalPacket'] and body['reference'] == refs['reference'] and
                 body['protocol'] == protocol_ref, 'DEV ledger payload bindings differ')
        groups, runs = _replay_proof_case_v4(root, runtime, artifacts, registry, configuration, case,
             adoption['packets'][configuration, cid], inv['originalPacket'], refs['reference'], protocol_ref, ledger,
             corpus=(adoption['originals'], adoption['sources']))
        _require(row['completions'] == [{'groupId': g['groupId'], 'rank': g['completionRank'], 'witness': g['witness']}
                                      for g in groups], 'Stored completions differ from exact raw replay')
        expected_legacy = {'algorithmVersion': 'anchor-component-first-v1', 'authority': 'HISTORICAL_DIAGNOSTIC_ONLY',
                           'originalArtifacts': [inv['originalPacket'], legacy_ref]}
        _require(row['legacyDiagnosticMetrics'] == expected_legacy,
                 'Case legacy diagnostics must reference original packet and immutable configuration scores')
        case_results.append({'caseId': cid, 'groups': groups}); provenance += runs
    aggregate = aggregate_groups_v4(adoption['originalReferences'], case_results, raw_reference_bytes=adoption['rawOriginalReferences'])
    by_case = {r['caseId']: r for r in aggregate['cases']}
    metric = lambda r: {'semanticCompleteGroupRecallAt8': r['semanticRecallAt8'], 'semanticCompleteGroupMrrAt8': r['queryMRR']}
    metrics = {'cases': {c['id']: metric(by_case[c['id']]) if c['answerable'] else None for c in adoption['cases']},
               'macro': metric(aggregate), 'perThemeRecall': {t: r['semanticRecallAt8'] for t, r in aggregate['perTheme'].items()}}
    verify_results_metrics(payload, metrics)
    for field in ('callId', 'workspaceId', 'outputDirectory'):
        values = [r[field] for r in provenance]
        _require(len(values) == len(set(values)), 'Reused actual identity across equivalence/proof stages')
    expected_legacy = {'algorithmVersion': 'anchor-component-first-v1', 'authority': 'HISTORICAL_DIAGNOSTIC_ONLY',
        'originalArtifacts': [r['originalPacket'] for r in adoption['inventory']['rows'] if r['configuration'] == configuration] + [legacy_ref]}
    _require(payload['legacyDiagnosticMetrics'] == expected_legacy, 'Macro legacy diagnostics original inventory differs')
    return {'record': record, 'metrics': metrics, 'provenance': provenance, 'resultRef': result_ref}
