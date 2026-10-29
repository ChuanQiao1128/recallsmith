"""Pure offline custody/registered execution predicates; these never grant permission.

All bytes are supplied by the fixed-root loader after supervisor registration.
No filesystem read, probe, model call, or event is performed here. In particular,
private paths are strings compared against independent release bindings only.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

from jsonschema import validators

import jsonschema
from referencing import Registry

from execution_receipt_v4 import LIMITS, _json, _path, _verify_execution_bytes_v4
from proof_schedule_v4 import canonical

SIX = {'execution': 'execution.json', 'invocation': 'invocation.json',
       'result': 'result.json', 'events': 'events.jsonl', 'stderr': 'stderr.log',
       'emittedSchema': 'schema.json'}
PERMISSION_PREREQUISITES = {
    'DEV_EQUIVALENCE_EXECUTION': {'contract-review', 'current-source-review', 'isolation-denial'},
    'DEV_PROOF_EXECUTION': {'contract-review', 'reference-equivalence', 'adoption-implementation-review',
                            'current-source-review', 'isolation-denial'},
    'INTEGRATION_CANARY': {'contract-review', 'reference-equivalence', 'adoption-implementation-review',
                           'current-source-review', 'isolation-denial'},
    'LABEL_EXECUTION': {'selection-freeze', 'current-source-review', 'isolation-denial'},
    'HOLDOUT_EXECUTION': {'selection-freeze', 'label-seal', 'holdout-claim', 'unseal',
                          'current-source-review', 'isolation-denial'},
}
PERMISSIONS = {'dev-equivalence': 'DEV_EQUIVALENCE_EXECUTION',
               'dev-proof': 'DEV_PROOF_EXECUTION', 'integration-canary': 'INTEGRATION_CANARY',
               'holdout-proof': 'HOLDOUT_EXECUTION', 'holdout-readiness': 'HOLDOUT_EXECUTION'}
TRANSITIONS = {('UNFROZEN', 'DENIAL_OBSERVED'): 'UNFROZEN',
               ('UNFROZEN', 'FREEZE_ACCEPTED'): 'FROZEN',
               ('FROZEN', 'BUILDERS_STOPPED'): 'BUILDERS_STOPPED',
               ('BUILDERS_STOPPED', 'LABELS_STARTED'): 'LABELS_STARTED',
               ('LABELS_STARTED', 'SEALED'): 'SEALED',
               ('SEALED', 'CLAIM_CREATED'): 'CLAIMED',
               ('CLAIMED', 'UNSEALED'): 'UNSEALED', ('CLAIMED', 'BURNED'): 'BURNED'}
CHECKS = ('sixFileBytes', 'runtimeBinary', 'inputSchema', 'completedEvents',
          'distinctCallWorkspace', 'toolFreeRoute', 'exactCaseCoverage')


C = '/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028'
R = '/Users/qc/src/recallsmith-aws-basics-delivery-20261028'
E, D, T = C + '/evaluation/rag-v2', C + '/evaluation/rag-v2/dev/adoption-v1', C + '/evaluation/rag-v2/trusted-v4'
CORPUS = C + '/retrieval-v3/corpus'
SCHEMA_PATH = Path(__file__).with_name('semantic-v4-trusted-interfaces.schema.json')
# The distributed schema is a static runtime dependency, loaded once on import.
_SCHEMA = _json(SCHEMA_PATH.read_bytes())


def _core():
    # Shared pure primitives live here to keep the executable dependency DAG acyclic.
    return sys.modules[__name__]


def _parse(raw):
    _require(type(raw) is bytes, 'Exact JSON bytes required')
    return _json(raw)


def _exact_const(validator, const, instance, schema):
    if isinstance(const, (int, bool)) and type(instance) is not type(const):
        yield jsonschema.ValidationError('Exact constant token type required')
    elif instance != const:
        yield jsonschema.ValidationError('Constant differs')


_VALIDATOR = validators.extend(jsonschema.Draft202012Validator,
    {'const': _exact_const}, type_checker=jsonschema.Draft202012Validator.TYPE_CHECKER.redefine(
        'integer', lambda checker, value: type(value) is int))


def _validate_record(record, name):
    schema = _SCHEMA
    _require(name in schema['$defs'], 'Unknown trusted record kind')
    try:
        _VALIDATOR({'$ref': '#/$defs/' + name, '$defs': schema['$defs']}, registry=Registry()).validate(record)
    except (jsonschema.ValidationError, jsonschema.SchemaError) as exc:
        raise ValueError('Invalid closed ' + name) from exc
    return record


def _ref(ref, artifacts):
    _require(type(ref) is dict and set(ref) == {'path', 'sha256'} and
             type(ref['sha256']) is str and re.fullmatch(r'[0-9a-f]{64}', ref['sha256']) is not None,
             'Invalid closed artifact reference')
    _path(ref['path'])
    raw = artifacts.get(ref['path'])
    _require(type(raw) is bytes and _sha(raw) == ref['sha256'], 'Unregistered/stale artifact reference')
    return raw


def _digest(value):
    return _sha(canonical(value).encode('utf-8'))


def _hash(raw):
    return _sha(raw)


def _require(ok, message):
    if not ok:
        raise ValueError(message)


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _record(raw, name):
    c = _core()
    value = c._parse(raw)
    c._validate_record(value, name)
    return value


def _registered(root, ref, artifacts):
    _require(type(ref) is dict and set(ref) == {'path', 'sha256'}, 'Exact reference required')
    allowed = [item['artifact'] for item in root['artifacts'] if item['artifact']['path'] == ref['path']]
    if not allowed and ref in (root.get('runtimeManifest'), root.get('executionRegistry')):
        allowed = [ref]
    if not allowed and root.get('runtimeManifest', {}).get('path') in artifacts:
        manifest = _parse(_ref(root['runtimeManifest'], artifacts))
        allowed = [e['artifact'] for e in manifest['entries'] if e['artifact']['path'] == ref['path']]
    _require(len(allowed) == 1 and allowed[0]['sha256'] == ref['sha256'],
             'Reference absent from supervisor artifact registration')
    return _core()._ref(ref, artifacts)


def _fixed(root, path, artifacts):
    matches = [x['artifact'] for x in root['artifacts'] if x['artifact']['path'] == path]
    _require(len(matches) == 1, 'Missing fixed supervisor registration: ' + path)
    ref = {k: matches[0][k] for k in ('path', 'sha256')}
    return ref, _registered(root, ref, artifacts)


def _manifest_ref(root, value):
    _require(value == root['runtimeManifest'], 'Runtime manifest binding changed')


def _parent(root, ref, artifacts, definition, *, kind=None):
    c = _core()
    raw = _registered(root, ref, artifacts)
    _, schema_raw = _fixed(root, c.C + '/design/rag-v2-bounded/r4/contracts.schema.json', artifacts)
    schema = c._parse(schema_raw)
    value = c._parse(raw)
    target = {'$ref': '#/$defs/' + definition, '$defs': schema['$defs']}
    c._VALIDATOR(target, registry=Registry()).validate(value)
    if kind is not None:
        _require(value.get('kind') == kind, 'Parent artifact kind changed')
        _require(value.get('identity') == _parse(_ref(root['runtimeManifest'], artifacts))['identity'],
                 'Parent artifact runtime identity changed')
    return value


def _payload(value):
    return value['payload'] if 'payload' in value else value


def _authorization(root, manifest, ref, artifacts, permission):
    c = _core()
    _require(ref['path'] == c.T + '/authorizations/' + permission + '.json',
             'Wrong fixed authorization path')
    value = _record(_registered(root, ref, artifacts), 'Authorization')
    _require(value['permission'] == permission and value['supervisorTask'] == root['supervisorTask']
             and value['identity'] == manifest['identity'], 'Wrong authorization/runtime identity')
    _manifest_ref(root, value['runtimeManifest'])
    registered = {x['node']: x for x in root['authorities']}
    _require(value['prerequisites'] and len({x['node'] for x in value['prerequisites']}) ==
             len(value['prerequisites']), 'Duplicate/missing authorization prerequisite')
    _require({x['node'] for x in value['prerequisites']} == PERMISSION_PREREQUISITES[permission],
             'Incomplete applicable authorization prerequisites')
    for prerequisite in value['prerequisites']:
        _require(registered.get(prerequisite['node']) == prerequisite and prerequisite['state'] == 'PASS'
                 and (prerequisite['acceptedReview'] is not None or prerequisite['observation'] is not None),
                 'Authorization prerequisite not current PASS')
    for item in value['boundInputs']:
        _registered(root, item, artifacts)
    return value


def _authorized_inputs(root, inputs, artifacts):
    reached, visiting = set(), set()
    def walk(ref):
        token = canonical(ref)
        _require(token not in visiting, 'Cyclic authorization input graph')
        if token in reached:
            return
        raw = _registered(root, ref, artifacts)
        visiting.add(token)
        try:
            value = _parse(raw)
        except (ValueError, UnicodeError):
            value = None
        def refs(value):
            if isinstance(value, dict):
                if set(value) == {'path', 'sha256'} and type(value['path']) is str and type(value['sha256']) is str:
                    walk(value)
                else:
                    for child in value.values(): refs(child)
            elif isinstance(value, list):
                for child in value: refs(child)
        if value is not None and not (isinstance(value, dict) and ('$defs' in value or '$schema' in value)):
            refs(value)
        visiting.remove(token)
        reached.add(token)
    for ref in inputs:
        walk(ref)
    return reached


def _output(c, entry):
    p, r, scope, n = entry['purpose'], entry['role'], entry['scope'], entry['batchOrdinal']
    _require(type(n) is int and n >= 0, 'Actual integer batch ordinal required')
    ids, config, group = scope['caseIds'], scope['configuration'], scope['groupId']
    _require(ids and len(set(ids)) == len(ids), 'Missing/duplicate scoped case IDs')
    if p == 'dev-equivalence':
        _require(r in ('equivalence-one', 'equivalence-two') and config == 'none' and
                 group is None and not scope['packets'] and 1 <= len(ids) <= 3,
                 'Invalid equivalence scope')
        return f'{c.D}/reviews/{r}/{n}/raw'
    if p in ('dev-proof', 'holdout-proof'):
        _require(r in ('one', 'two') and len(ids) == 1 and group is not None and
                 len(scope['packets']) == 1 and config in
                 (('A', 'B') if p == 'dev-proof' else ('selected',)), 'Invalid proof scope')
        prefix = f'{c.D}/{config}/raw' if p == 'dev-proof' else f'{c.E}/holdout/raw/proof'
        return f'{prefix}/{ids[0]}/{group}/{r}/{n}'
    _require(p in ('integration-canary', 'holdout-readiness') and r in ('reader', 'judge') and
             config == 'selected' and group is None and 1 <= len(ids) <= 3 and
             len(scope['packets']) == len(ids), 'Invalid readiness/canary scope')
    prefix = f'{c.T}/canary/raw' if p == 'integration-canary' else f'{c.E}/holdout/raw/readiness'
    return f'{prefix}/{r}/{n}'


def _six(root, refs, hashes, directory, artifacts):
    raw = {}
    _require(set(refs) == set(SIX) and set(hashes) == set(LIMITS), 'Exact six-file references required')
    for field, name in SIX.items():
        ref = refs[field]
        _require(ref == {'path': directory + '/' + name, 'sha256': hashes[name]},
                 'Raw filename/path/hash substitution')
        # Raw references are derived solely from a registered entry/release binding.
        data = artifacts.get(ref['path'])
        _require(type(data) is bytes and len(data) <= LIMITS[name] and _sha(data) == ref['sha256'],
                 'Missing/mutated bounded raw execution bytes')
        raw[name] = data
    return raw


def _cli(manifest, invocation):
    paths = [e['artifact']['path'] for e in manifest['entries'] if e['category'] == 'binary' and
             e['role'] == 'cli-executable']
    _require(len(paths) == 1 and invocation.get('cli') == paths[0], 'Actual registered CLI path required')


def _proof_plan(root, manifest, entry, artifacts):
    """Rebuild compact proof calls from exact packet/reference input bytes."""
    from proof_transport_v4 import compact_schedule
    c, scope = _core(), entry['scope']
    reference = c._parse(_registered(root, scope['reference'], artifacts))
    reference = _payload(reference)
    cases = reference.get('queries', [])
    _require(len({x['id'] for x in cases}) == len(cases), 'Duplicate reference case')
    matched = [x for x in cases if x['id'] == scope['caseIds'][0]]
    _require(len(matched) == 1, 'Case absent from exact reference bytes')
    case = matched[0]
    groups = [x for x in case['groups'] if x['id'] == scope['groupId']]
    _require(len(groups) == 1, 'Group absent from exact reference bytes')
    packet = _payload(c._parse(_registered(root, scope['packets'][0], artifacts)))
    query = packet.get('query', packet.get('queryEn'))
    _require(query == case['queryEn'], 'Packet/reference query changed')
    evidence = packet['evidence']
    from semantic_proof_v4 import _packet
    originals, sources = c._corpus_maps(manifest, artifacts)
    _packet(evidence, originals, sources)
    plan = compact_schedule(case['id'], query, groups[0], evidence, originals)
    calls = [x for x in plan['calls'] if x['checkerId'] == entry['role']]
    n = entry['batchOrdinal']
    _require(n < len(calls), 'Extra proof batch or empty proof execution')
    return calls[n], len(calls)


def validate_execution_registry_v4(root, runtime_manifest, registry, artifacts):
    """Validate all public entries without opening any receipt-selected path."""
    c = _core()
    c._validate_record(registry, 'ExecutionRegistry')
    keys, outputs, calls, workspaces, group_batches = set(), set(), set(), set(), {}
    authorizations = {}
    for entry in registry['entries']:
        purpose, scope, ordinal = entry['purpose'], entry['scope'], entry['batchOrdinal']
        _require(purpose in PERMISSIONS, 'Private label execution forbidden in public registry')
        output = _output(c, entry)
        _require(entry['outputDirectory'] == output and output not in outputs, 'Output path/reuse rejected')
        outputs.add(output)
        _manifest_ref(root, entry['runtimeManifest'])
        _require(entry['supervisorTask'] == root['supervisorTask'] and
                 entry['observedTask'] != root['supervisorTask'], 'Observed execution task required')
        auth_key = canonical(entry['authorization'])
        if auth_key not in authorizations:
            auth = _authorization(root, runtime_manifest, entry['authorization'], artifacts, PERMISSIONS[purpose])
            authorizations[auth_key] = (auth, _authorized_inputs(root, auth['boundInputs'], artifacts))
        auth, reachable = authorizations[auth_key]
        _require(auth['permission'] == PERMISSIONS[purpose], 'Wrong permission for execution purpose')
        _require(entry['trustedPins']['controlRoot'] == c.C and
                 entry['trustedPins']['runtime'] == runtime_manifest['runtime'], 'Public runtime/root binding changed')
        key = (purpose, scope['configuration'], tuple(scope['caseIds']), scope['groupId'], entry['role'], ordinal)
        _require(key not in keys, 'Duplicate registry key')
        keys.add(key)
        for ref in scope['packets'] + [scope['reference'], scope['protocol'], scope['prompt'], scope['schema']]:
            _registered(root, ref, artifacts)
        expected_reference = c.D + '/references.json' if purpose in ('dev-proof', 'dev-equivalence') else c.E + '/holdout/references.json'
        if purpose != 'integration-canary':
            _require(scope['reference']['path'] == expected_reference, 'Reference fixed path changed')
        if purpose in ('dev-proof', 'holdout-proof'):
            designated = [e for e in runtime_manifest['entries'] if e['role'] == 'proof-output-schema']
            _require(len(designated) == 1 and designated[0]['category'] == 'schema' and
                     designated[0]['artifact']['path'] == R + '/tools/content-pipeline/semantic-v4-proof-output.schema.json',
                     'Unique fixed proof-output-schema runtime input required')
            schema_bytes = _registered(root, designated[0]['artifact'], artifacts)
            _require(scope['schema']['sha256'] == designated[0]['artifact']['sha256'] and
                     artifacts.get(scope['schema']['path']) == schema_bytes,
                     'Proof emitted schema differs from designated purpose schema')
        elif purpose == 'dev-equivalence':
            _require(any(e['category'] == 'schema' and e['artifact']['sha256'] == scope['schema']['sha256']
                         for e in runtime_manifest['entries']), 'Static emitted schema not frozen runtime input')
        _require(scope['protocol']['path'] == c.C + '/design/rag-v2-bounded/r4/semantic-protocol.md' and
                 scope['protocol']['sha256'] == runtime_manifest['identity']['protocolHash'], 'Protocol bytes changed')
        _require(scope['prompt']['path'] == output + '/prompt.txt' and scope['schema'] == entry['emittedSchema'],
                 'Prompt/schema fixed path changed')
        prompt_raw = _registered(root, scope['prompt'], artifacts)
        prompt = prompt_raw.decode('utf-8', 'strict')
        _require(_sha(prompt.encode('utf-8')) == scope['prompt']['sha256'], 'Prompt byte binding changed')
        raw = _six(root, {k: entry[k] for k in SIX}, entry['trustedPins']['expectedFileHashes'], output, artifacts)
        _require(all(canonical(ref) in reachable for ref in scope['packets'] +
                     [scope['reference'], scope['protocol']]), 'Authorization does not bind exact scope inputs')
        batch_key = (purpose, scope['configuration'], tuple(scope['caseIds']), scope['groupId'])
        if purpose in ('dev-proof', 'holdout-proof'):
            planned, count = _proof_plan(root, runtime_manifest, entry, artifacts)
            _require(prompt == planned['prompt'] and scope['projectionHash'] == planned['projectionHash'],
                     'Proof prompt/projection differs from rebuilt schedule')
            group_batches[batch_key] = count
        receipt = _verify_execution_bytes_v4(raw, output, frozen_prompt=prompt,
            frozen_schema_bytes=raw['schema.json'], trusted_pins=entry['trustedPins'])
        invocation = c._parse(raw['invocation.json'])
        _cli(runtime_manifest, invocation)
        _require(receipt['callId'] == entry['callId'] and receipt['workspaceId'] == entry['workspaceId'] and
                 receipt['callId'] not in calls and receipt['workspaceId'] not in workspaces,
                 'Observed call/workspace identity mismatch/reuse')
        calls.add(receipt['callId']); workspaces.add(receipt['workspaceId'])
    for batch_key, count in group_batches.items():
        required = {(*batch_key, role, n) for role in ('one', 'two') for n in range(count)}
        _require(required <= keys, 'Missing complete proof role/batch coverage')
    _validate_equivalence_scopes(root, runtime_manifest, registry, artifacts)
    _validate_readiness_scopes(root, runtime_manifest, registry, artifacts)
    return registry


def _validate_equivalence_scopes(root, manifest, registry, artifacts):
    c = _core()
    entries = [x for x in registry['entries'] if x['purpose'] == 'dev-equivalence']
    if not entries:
        return
    _, contract_raw = _fixed(root, c.R + '/tools/content-pipeline/semantic-v4-adoption-contract.json', artifacts)
    contract = c._parse(contract_raw)
    def validate(value, name):
        c._VALIDATOR({'$ref': '#/$defs/' + name, '$defs': contract['$defs']}, registry=Registry()).validate(value)
    _, schedule_raw = _fixed(root, c.D + '/reviews/schedule.json', artifacts)
    schedule = c._parse(schedule_raw)
    validate(schedule, 'EquivalenceSchedule')
    _require(schedule['candidateMapping']['path'] == c.D + '/candidate-mapping.json', 'Fixed candidate mapping required')
    candidate = c._parse(_registered(root, schedule['candidateMapping'], artifacts))
    validate(candidate, 'CandidateMapping')
    _require(candidate['proofConsumer']['identity'] == manifest['identity'] and
             candidate['proofConsumer']['dependencyManifest'] == root['runtimeManifest'], 'Equivalence consumer not current')
    originals_raw = _registered(root, candidate['originalReferences'], artifacts)
    adapted_raw = _registered(root, candidate['adaptedReferences'], artifacts)
    original_cases = _payload(c._parse(originals_raw))['queries']
    adapted_cases = _payload(c._parse(adapted_raw))['queries']
    mappings = candidate['cases']
    _require(len(original_cases) == len(adapted_cases) == len(mappings) == 80 and
             [x['id'] for x in original_cases] == [x['id'] for x in adapted_cases] ==
             [x['caseId'] for x in mappings], 'Full historical 80-case order required')
    _, sources = c._corpus_maps(manifest, artifacts)
    instruction_entries = [x for x in manifest['entries'] if x['category'] == 'prompt' and
                           x['role'] == 'equivalence-instructions']
    schema_entries = [x for x in manifest['entries'] if x['category'] == 'schema' and
                      x['role'] == 'equivalence-output-schema']
    _require(len(instruction_entries) == len(schema_entries) == 1, 'Reviewed equivalence instructions/schema required')
    instructions = c._ref(instruction_entries[0]['artifact'], artifacts).decode('utf-8', 'strict')
    schema_bytes = c._ref(schema_entries[0]['artifact'], artifacts)
    def source_ids(value):
        found = set()
        if isinstance(value, dict):
            if 'sourceId' in value:
                found.add(value['sourceId'])
            if 'sourceHashes' in value:
                def hashes(v):
                    if isinstance(v, str) and v in sources: found.add(v)
                    elif isinstance(v, dict):
                        for k, child in v.items(): hashes(k); hashes(child)
                    elif isinstance(v, list):
                        for child in v: hashes(child)
                hashes(value['sourceHashes'])
            for child in value.values(): found |= source_ids(child)
        elif isinstance(value, list):
            for child in value: found |= source_ids(child)
        return found
    def build(start, size, ordinal):
        old, new, maps = original_cases[start:start+size], adapted_cases[start:start+size], mappings[start:start+size]
        required_sources = source_ids(old) | source_ids(new)
        _require(required_sources <= sources.keys(), 'Equivalence source missing')
        projected = {'kind': 'dev80-source-equivalence-projection', 'batchOrdinal': ordinal,
                     'caseIds': [x['id'] for x in old], 'originalCases': old, 'adaptedCases': new,
                     'caseMappings': maps, 'sources': [{k: sources[sid][k] for k in
                         ('sourceId', 'sourceVersion', 'text')} for sid in sorted(required_sources)]}
        validate(projected, 'EquivalenceProjection')
        raw = canonical(projected).encode('utf-8')
        digest = _sha(raw)
        prompt = instructions + canonical({'batchOrdinal': ordinal, 'projectionHash': digest}) + '\n' + canonical(projected)
        return projected, raw, prompt, digest
    expected, start = [], 0
    while start < len(original_cases):
        ordinal = len(expected)
        chosen = None
        for size in range(1, min(3, len(original_cases) - start) + 1):
            built = build(start, size, ordinal)
            if len(built[2]) < 60000:
                chosen = built
        _require(chosen is not None, 'One-case equivalence prompt exceeds limit')
        expected.append(chosen)
        start += len(chosen[0]['caseIds'])
    _require(schedule['batches'] == [{'batchOrdinal': n, 'caseIds': v[0]['caseIds'],
             'projectionHash': v[3], 'promptScalarCount': len(v[2])} for n, v in enumerate(expected)],
             'Equivalence schedule differs from complete greedy rebuild')
    by_key = {(x['role'], x['batchOrdinal']): x for x in entries}
    _require(len(by_key) == len(entries) and set(by_key) == {(r, n) for r in
             ('equivalence-one', 'equivalence-two') for n in range(len(expected))},
             'Missing/extra equivalence role/batch')
    for n, (projection, projection_raw, prompt, digest) in enumerate(expected):
        _, supplied_projection = _fixed(root, f'{c.D}/reviews/projections/{n}.json', artifacts)
        _require(supplied_projection == projection_raw, 'Equivalence projection not exact canonical rebuild')
        for role in ('equivalence-one', 'equivalence-two'):
            entry = by_key[role, n]
            _require(entry['scope']['caseIds'] == projection['caseIds'] and
                     entry['scope']['projectionHash'] == digest and
                     artifacts[entry['scope']['prompt']['path']] == prompt.encode('utf-8') and
                     artifacts[entry['emittedSchema']['path']] == schema_bytes,
                     'Equivalence prompt/schema/scope mismatch')


def _validate_readiness_scopes(root, manifest, registry, artifacts):
    from readiness import READER, JUDGE, reader_schema, judge_schema, exact_rows
    from semantic_readiness_v4 import _judge_cases
    c = _core()
    for purpose in ('integration-canary', 'holdout-readiness'):
        entries = [x for x in registry['entries'] if x['purpose'] == purpose]
        if not entries:
            continue
        reference_refs = {canonical(x['scope']['reference']) for x in entries}
        _require(len(reference_refs) == 1, 'Readiness reference changed between calls')
        refs = _payload(c._parse(_registered(root, entries[0]['scope']['reference'], artifacts)))['queries']
        ids = [x['id'] for x in refs]
        _require(len(set(ids)) == len(ids), 'Duplicate readiness reference cases')
        by_key = {(x['role'], x['batchOrdinal']): x for x in entries}
        batches = (len(refs) + 2) // 3
        _require(set(by_key) == {(r, n) for r in ('reader', 'judge') for n in range(batches)},
                 'Missing/extra readiness batches')
        for n, start in enumerate(range(0, len(refs), 3)):
            batch = refs[start:start + 3]
            reader = by_key['reader', n]
            _require(reader['scope']['caseIds'] == [x['id'] for x in batch], 'Readiness cases out of order')
            from semantic_readiness_v4 import _cases
            originals, sources = c._corpus_maps(manifest, artifacts)
            packets = []
            for ref, packet_ref in zip(batch, reader['scope']['packets']):
                packet = _payload(c._parse(_registered(root, packet_ref, artifacts)))
                packets.append({'caseId': ref['id'], 'queryEn': packet.get('query', packet.get('queryEn')),
                                'evidence': packet['evidence']})
            projected = _cases(batch, packets, originals, sources, reader['scope']['reference']['sha256'])
            for role in ('reader', 'judge'):
                entry = by_key[role, n]
                _require(entry['scope']['caseIds'] == reader['scope']['caseIds'] and
                         entry['scope']['packets'] == reader['scope']['packets'], 'Judge scope changed')
                projection = projected
                if role == 'judge':
                    result = c._parse(artifacts[reader['result']['path']])
                    answers = exact_rows(result, [x['id'] for x in projected])
                    projection = _judge_cases(batch, projected, answers)
                body = {'cases': projection}
                prompt = (READER if role == 'reader' else JUDGE) + canonical(body)
                schema = (reader_schema if role == 'reader' else judge_schema)([x['id'] for x in projected])
                schema_raw = json.dumps(schema, ensure_ascii=False, indent=2).encode('utf-8')
                _require(artifacts[entry['scope']['prompt']['path']] == prompt.encode('utf-8') and
                         entry['scope']['projectionHash'] == _sha(canonical(body).encode('utf-8')) and
                         artifacts[entry['emittedSchema']['path']] == schema_raw,
                         'Readiness prompt/projection/schema differs from rebuilt schedule')


def _utc(value):
    _require(type(value) is str and value == value.strip(), 'Observed UTC timestamp required')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Observed UTC timestamp required') from exc
    _require(parsed.tzinfo is not None and parsed.utcoffset() == timezone.utc.utcoffset(parsed),
             'Observed UTC timestamp required')
    return parsed


def _external_action(root, ref, artifacts, event, expected, required_inputs):
    """Shared observed identity/evidence checks for lifecycle and private replay."""
    action = _record(_registered(root, ref, artifacts), 'ExternalAction')
    _require(action['event'] == event and action['supervisorTask'] == root['supervisorTask'],
             'Actual action event/supervisor differs')
    for key, value in expected.items():
        _require(action[key] == value, 'Action/observation binding changed: ' + key)
    _require(action['processIdentity'] == action['processIdentity'].strip() and
             action['processIdentity'].casefold() not in ('unknown', 'self', 'none', 'null', 'pending', 'unavailable', ''),
             'Actual process identity required')
    _utc(action['observedUtc'])
    for item in action['inputs']:
        _require(item != ref, 'External action cannot be its own input')
        _registered(root, item, artifacts)
    _inputs(action, [root['runtimeManifest'], *required_inputs])
    observed = set()
    for outcome in action['outcomes']:
        key = (outcome['operation'], outcome['target'])
        _require(key not in observed, 'Duplicate actual action operation/target')
        observed.add(key)
        transcript = _registered(root, outcome['evidence'], artifacts)
        _require(bool(transcript.strip()) and outcome['evidence'] != ref and
                 outcome['evidence']['path'] not in [r['path'] for r in action['inputs']],
                 'Separately registered external transcript required')
    return action


def _action(root, observation, artifacts):
    keys = ('supervisorTask', 'custodianRunId', 'custodianPrincipal', 'sequence',
            'runtimeManifest', 'policyHash', 'observedUtc')
    required = [] if observation['freeze'] is None else [observation['freeze']]
    action = _external_action(root, observation['actionRecord'], artifacts, observation['detail']['event'],
                              {key: observation[key] for key in keys}, required)
    _exact_outcomes(action, _lifecycle_outcomes(observation))
    return action


def _exact_outcomes(action, expected):
    _require({(x['operation'], x['target']) for x in action['outcomes']} == set(expected),
             'Unexpected or missing external action effect')
    for (operation, target), (result, exit_code) in expected.items():
        _outcome(action, operation, target, result, exit_code)


def _lifecycle_outcomes(observation):
    detail = observation['detail']
    event = detail['event']
    if event == 'DENIAL_OBSERVED':
        return {(x['capability'], x['targetClass']): ('DENIED', x['exitCode']) for x in detail['attempts']} | {
            ('tools-disabled', 'all'): ('DISABLED', 0), ('public-log-inspection', 'all'): ('NO_LEAK', 0)}
    if event == 'FREEZE_ACCEPTED':
        return {('accept-freeze', detail['freeze']['path']): ('ACCEPTED', 0)}
    if event == 'BUILDERS_STOPPED':
        return {('terminate', x['taskId']): ('TERMINATED', 0) for x in detail['workers']} | {
            ('prevent-restart', 'all'): ('BLOCKED', 0)}
    if event == 'LABELS_STARTED':
        return {('private-store', detail['privateStoreId']): ('CUSTODIAN_CONTROLLED', 0),
                ('labels-start', 'holdout'): ('STARTED', 0)}
    if event == 'SEALED':
        return {('private-checks', 'all'): ('ALL_PASS', 0), ('quota', 'holdout'): ('VERIFIED', 0),
                ('nonce-entropy', 'holdout'): ('VERIFIED', 0)}
    if event == 'CLAIM_CREATED':
        path = detail['claimDescriptor']['path']
        return {('exclusive-create', path): ('CREATED', 0), ('fsync', path): ('DURABLE', 0),
                ('prior-claim', path): ('ABSENT', 0)}
    if event == 'UNSEALED':
        return {('manifest-digest', detail['privateManifestHash']): ('VERIFIED', 0),
                ('queries-only', 'holdout'): ('RELEASED', 0),
                ('continuity', detail['claim']['path']): ('UNINTERRUPTED', 0)}
    if event == 'BURNED':
        return {('burn', detail['claim']['path']): ('BURNED', 0)}
    _require(event == 'INVALIDATED', 'Unknown lifecycle action')
    return {('invalidate', 'holdout'): ('INVALID', 0)}


def _outcome(action, operation, target, result, exit_code=0):
    """Closed observed vocabulary: successful effects exit 0; denial exits nonzero."""
    outcomes = [x for x in action['outcomes'] if (x['operation'], x['target']) == (operation, target)]
    _require(len(outcomes) == 1 and outcomes[0]['result'] == result and
             type(outcomes[0]['exitCode']) is int and
             (outcomes[0]['exitCode'] != 0 if exit_code is None else outcomes[0]['exitCode'] == exit_code),
             'Missing actual outcome: ' + operation + '/' + target + '/' + result)
    return outcomes[0]


def _inputs(action, required):
    _require(all(ref in action['inputs'] for ref in required), 'Actual action missing exact input bindings')


def _denial(root, observation, action, artifacts):
    c, detail = _core(), observation['detail']
    _require(action['source'] in ('launcher', 'syscall'), 'Actual launcher/syscall denial source required')
    plan_ref, plan_raw = _fixed(root, c.T + '/denial-plan.json', artifacts)
    plan = _record(plan_raw, 'DenialPlan')
    _require(plan['parentAccessProtocol']['path'] == c.C + '/design/rag-v2-bounded/r4/access-protocol.md',
             'Parent I3 access protocol required')
    _registered(root, plan['parentAccessProtocol'], artifacts)
    _require(plan['launcherIdentity'] == detail['launcherIdentity'] and
             plan['policyHash'] == detail['policyHash'] == observation['policyHash'], 'Denial launcher/policy changed')
    roots = ('home', 'repository', 'control', 'private-pdf', 'private-labels', 'outside-projection')
    required = {(cap, target) for cap in ('absolute-read', 'relative-read', 'symlink-read',
                'hardlink-read', 'uri-read', 'directory-list', 'write-back') for target in roots}
    required |= {('process-inspection', 'process'), ('environment-read', 'environment'),
                 ('parent-stdin-read', 'parent-stdin'), ('child-spawn', 'child'),
                 ('mcp-call', 'mcp'), ('network', 'network'), ('public-log-leak', 'public-output')}
    planned = [(x['capability'], x['targetClass']) for x in plan['required']]
    attempts = [(x['capability'], x['targetClass']) for x in detail['attempts']]
    _require(len(set(planned)) == len(planned) and required <= set(planned) and
             len(set(attempts)) == len(attempts) and set(attempts) == set(planned),
             'Incomplete/duplicate I3 capability/target matrix')
    _require(detail['toolsDisabledObserved'] is True and detail['noPublicLeakObserved'] is True,
             'Unknown tool/public-log denial observation')
    _inputs(action, [plan_ref, plan['parentAccessProtocol']])
    for attempt in detail['attempts']:
        _require(attempt['result'] == 'DENIED' and type(attempt['exitCode']) is int and attempt['exitCode'] != 0,
                 'Unknown/allowed capability or missing denial exit')
        outcome = _outcome(action, attempt['capability'], attempt['targetClass'], 'DENIED', None)
        _require(outcome['exitCode'] == attempt['exitCode'] and outcome['evidence'] == attempt['launcherRecord'],
                 'Denial attempt lacks matching external syscall/launcher evidence')
    _outcome(action, 'tools-disabled', 'all', 'DISABLED')
    _outcome(action, 'public-log-inspection', 'all', 'NO_LEAK')


def _current_authorities(root, names):
    by_node = {x['node']: x for x in root['authorities']}
    for name in names:
        value = by_node.get(name)
        _require(value is not None and value['state'] == 'PASS' and
                 (value['acceptedReview'] is not None or value['observation'] is not None),
                 'Current authority unavailable: ' + name)


def _check_no_future_inputs(action, forbidden):
    _require(not any(x['path'] in forbidden for x in action['inputs']),
             'Cyclic/downstream external action input')


def _validate_custodian_observations_v4(root, runtime_manifest, observations, artifacts):
    """Validate append-only observed history. No returned state is gate PASS."""
    c = _core()
    _require(isinstance(observations, (list, tuple)), 'Ordered custodian observations required')
    registered_observations = {x['artifact']['path'] for x in root['artifacts']
                               if x['category'] == 'custodian-observation'}
    _require(registered_observations == {f'{c.T}/custodian/{n}.json' for n in range(len(observations))},
             'Missing or extra registered custodian observation')
    previous_utc = None
    state, previous, identity, freeze, seal, store, claim_observation = 'UNFROZEN', None, None, None, None, None, None
    seen, denial, freeze_value, sealed_observation = set(), None, None, None
    for sequence, obs in enumerate(observations):
        c._validate_record(obs, 'CustodianObservation')
        own_ref, own_raw = _fixed(root, f'{c.T}/custodian/{sequence}.json', artifacts)
        _require(c._parse(own_raw) == obs and obs['sequence'] == sequence and obs['previous'] == previous,
                 'Custodian sequence/previous/raw binding changed')
        _require(obs['supervisorTask'] == root['supervisorTask'], 'Custodian supervisor mismatch')
        observed_utc = _utc(obs['observedUtc'])
        _require(previous_utc is None or observed_utc > previous_utc, 'Custody observations must be chronological')
        previous_utc = observed_utc
        _manifest_ref(root, obs['runtimeManifest'])
        current = tuple(obs[k] if not isinstance(obs[k], dict) else canonical(obs[k]) for k in
                        ('custodianRunId', 'custodianPrincipal', 'policyHash', 'runtimeManifest'))
        if identity is None:
            identity = current
        _require(identity == current, 'Custodian run/principal/policy/runtime changed')
        event, detail = obs['detail']['event'], obs['detail']
        _require(event not in seen and state not in ('INVALID', 'BURNED'), 'Repeated event or terminal-state transition')
        if event == 'INVALIDATED':
            _require(state != 'UNSEALED' or obs['freeze'] == freeze, 'Changed freeze after unseal')
            next_state = 'INVALID'
        else:
            _require((state, event) in TRANSITIONS, 'Illegal custody lifecycle transition')
            next_state = TRANSITIONS[state, event]
        _require(obs['freeze'] is not None or event in ('DENIAL_OBSERVED', 'INVALIDATED') and freeze is None,
                 'Null freeze outside pre-freeze observation')
        if freeze is not None:
            _require(obs['freeze'] == freeze, 'Current freeze changed')
            _registered(root, freeze, artifacts)
        action = _action(root, obs, artifacts)
        _check_no_future_inputs(action, {own_ref['path']})
        if event == 'DENIAL_OBSERVED':
            _require(obs['freeze'] is None, 'Denial must precede accepted freeze')
            _denial(root, obs, action, artifacts)
            denial = own_ref
        elif event == 'FREEZE_ACCEPTED':
            _require(denial is not None and obs['freeze'] == detail['freeze'] and
                     detail['freeze']['path'] == c.E + '/freeze.json' and
                     detail['selection']['path'] == c.E + '/selection.json', 'Freeze/selection/denial binding changed')
            _current_authorities(root, ('current-source-review', 'isolation-denial', 'selection-freeze'))
            freeze = detail['freeze']
            freeze_envelope = _parent(root, freeze, artifacts, 'Envelope', kind='freeze')
            _require(freeze_envelope['identity'] == runtime_manifest['identity'], 'Freeze runtime identity changed')
            freeze_value = freeze_envelope['payload']
            _require(freeze_value['selection'] == detail['selection'] and freeze_value['denialReceipt'] == denial,
                     'Freeze selection/denial changed')
            _registered(root, detail['selection'], artifacts)
            _inputs(action, [freeze, detail['selection'], denial])
            _outcome(action, 'accept-freeze', freeze['path'], 'ACCEPTED')
        elif event == 'BUILDERS_STOPPED':
            inventory_ref, raw = _fixed(root, c.T + '/worker-inventory.json', artifacts)
            inventory = _record(raw, 'WorkerInventory')
            _require(inventory['supervisorTask'] == root['supervisorTask'], 'Worker inventory supervisor mismatch')
            expected = {w['taskId']: w for w in inventory['workers']}
            workers = {w['taskId']: w for w in detail['workers']}
            _require(len(expected) == len(inventory['workers']) and len(workers) == len(detail['workers']) and
                     set(workers) == set(expected) == set(detail['completeWorkerSet']) and
                     len(detail['completeWorkerSet']) == len(expected) and detail['restartBlockedObserved'] is True,
                     'Incomplete/duplicate worker set or unknown restart prevention')
            _inputs(action, [inventory_ref])
            for task, worker in workers.items():
                _require(all(worker[k] == expected[task][k] for k in ('taskId', 'processIdentity', 'startedUtc')) and
                         worker['exitObserved'] is True and
                         _utc(worker['startedUtc']) < _utc(worker['stoppedUtc']) <= observed_utc,
                         'Worker process/start/termination changed')
                _require(worker['launcherRecord'] in freeze_value['builderTerminationReceipts'],
                         'Termination report not frozen before observation')
                outcome = _outcome(action, 'terminate', task, 'TERMINATED')
                _require(outcome['evidence'] == worker['launcherRecord'], 'Termination lacks external report')
            _outcome(action, 'prevent-restart', 'all', 'BLOCKED')
        elif event == 'LABELS_STARTED':
            authorization = _authorization(root, runtime_manifest, detail['authorization'], artifacts, 'LABEL_EXECUTION')
            prefix_inputs = _validate_label_authorization_prefix_v4(root, runtime_manifest, artifacts, authorization['observedUtc'])
            _require(all(ref in authorization['boundInputs'] for ref in prefix_inputs),
                     'Label permission omits completed builder-stop prefix evidence')
            _require(observed_utc > _utc(authorization['observedUtc']),
                     'Labels must start after existing label permission')
            _inputs(action, [detail['authorization']])
            store = detail['privateStoreId']
            _require('/' not in store, 'Public privateStoreId must be opaque')
            _outcome(action, 'private-store', store, 'CUSTODIAN_CONTROLLED')
            _outcome(action, 'labels-start', 'holdout', 'STARTED')
        elif event == 'SEALED':
            _require(detail['privateStoreId'] == store and detail['privateChecksVerified'] is True and
                     detail['quotaVerified'] is True and type(detail['nonceBits']) is int and detail['nonceBits'] >= 256,
                     'Private checks/quota/entropy not verified')
            seal = detail['sealReceipt']
            _require(seal['path'] == c.E + '/seal-receipt.json', 'Fixed seal receipt required')
            sealed = _parent(root, seal, artifacts, 'Envelope', kind='seal-receipt')['payload']
            _require(sealed['commitment'] == detail['commitment'] and sealed['verdict'] == 'PASS' and
                     sealed['protocolHash'] == runtime_manifest['identity']['protocolHash'] and
                     sealed['sourceManifestHash'] == runtime_manifest['identity']['sourceManifestHash'] and
                     sealed['denialReceipt'] == freeze_value['denialReceipt'], 'Seal receipt binding changed')
            _inputs(action, [seal])
            _outcome(action, 'private-checks', 'all', 'ALL_PASS')
            _outcome(action, 'quota', 'holdout', 'VERIFIED')
            _outcome(action, 'nonce-entropy', 'holdout', 'VERIFIED')
            sealed_observation = obs
        elif event == 'CLAIM_CREATED':
            _require(detail['sealReceipt'] == seal and all(detail[k] is True for k in
                     ('exclusiveCreateObserved', 'fsyncObserved', 'priorClaimAbsentObserved')), 'Undurable/ambiguous claim')
            descriptor_ref = detail['claimDescriptor']
            _require(descriptor_ref['path'] == c.T + '/claim-descriptor.json', 'Fixed claim descriptor required')
            descriptor = _record(_registered(root, descriptor_ref, artifacts), 'ClaimDescriptor')
            _require(descriptor['freeze'] == freeze and descriptor['sealReceipt'] == seal and
                     descriptor['custodianRunId'] == obs['custodianRunId'] and
                     descriptor['policyHash'] == obs['policyHash'], 'Claim descriptor inputs changed')
            _manifest_ref(root, descriptor['runtimeManifest'])
            _inputs(action, [descriptor_ref, seal])
            _check_no_future_inputs(action, {c.E + '/claim.json', c.E + '/unseal.json'})
            _outcome(action, 'exclusive-create', descriptor_ref['path'], 'CREATED')
            _outcome(action, 'fsync', descriptor_ref['path'], 'DURABLE')
            _outcome(action, 'prior-claim', descriptor_ref['path'], 'ABSENT')
            claim_observation = (own_ref, obs)
        elif event in ('UNSEALED', 'BURNED'):
            _require(detail['claim']['path'] == c.E + '/claim.json', 'Fixed parent claim required')
            claim = _parent(root, detail['claim'], artifacts, 'Envelope', kind='claim')['payload']
            _require(claim['freeze'] == freeze and claim['sealReceipt'] == seal and
                     claim['exclusiveCreationReceipt'] == claim_observation[0] and
                     claim['eventHash'] == claim_observation[1]['actionRecord']['sha256'], 'Parent claim action binding changed')
            _inputs(action, [detail['claim'], seal])
            if event == 'BURNED':
                _outcome(action, 'burn', detail['claim']['path'], 'BURNED')
            else:
                _require(detail['sealReceipt'] == seal and detail['queriesOnlyProjectionObserved'] is True and
                         detail['unseal']['path'] == c.E + '/unseal.json', 'Unseal claim/seal/projection changed')
                _check_no_future_inputs(action, {detail['unseal']['path'], c.E + '/holdout/released-seal.json'})
                unseal = _parent(root, detail['unseal'], artifacts, 'Envelope', kind='unseal')['payload']
                _require(unseal['claim'] == detail['claim'] and unseal['sealReceipt'] == seal and
                         unseal['eventHash'] == obs['actionRecord']['sha256'] and
                         unseal['privateManifestHash'] == detail['privateManifestHash'], 'Parent unseal/action binding changed')
                _outcome(action, 'manifest-digest', detail['privateManifestHash'], 'VERIFIED')
                _outcome(action, 'queries-only', 'holdout', 'RELEASED')
                _outcome(action, 'continuity', detail['claim']['path'], 'UNINTERRUPTED')
        elif event == 'INVALIDATED':
            _outcome(action, 'invalidate', 'holdout', 'INVALID')
        seen.add(event)
        previous, state = own_ref, next_state
    released_paths = [x['artifact']['path'] for x in root['artifacts'] if x['artifact']['path'].startswith(c.E + '/holdout/seal-evidence/')
                      or x['artifact']['path'] in (c.E + '/holdout/released-seal.json', c.E + '/holdout/references.json')]
    if 'UNSEALED' not in seen:
        _require(not released_paths, 'Private release admitted before witnessed durable unseal')
    elif released_paths:
        _require(state == 'UNSEALED', 'Invalidated/burned custody cannot admit released replay')
    return tuple(observations)


def _validate_label_authorization_prefix_v4(root, runtime, artifacts, observed_utc):
    """Consume the completed pre-label prefix; never follow a later permission."""
    cutoff = _utc(observed_utc)
    observations, refs = [], []
    for sequence in range(len(root['artifacts']) + 1):
        path = f'{T}/custodian/{sequence}.json'
        ref, raw = _fixed(root, path, artifacts)
        obs = _record(raw, 'CustodianObservation')
        observations.append(obs); refs.append(ref)
        if obs['detail']['event'] == 'BUILDERS_STOPPED':
            break
        _require(obs['detail']['event'] in ('DENIAL_OBSERVED', 'FREEZE_ACCEPTED'),
                 'Completed BUILDERS_STOPPED prefix required before label authorization')
    _require(observations and observations[-1]['detail']['event'] == 'BUILDERS_STOPPED',
             'Completed BUILDERS_STOPPED prefix required before label authorization')
    prefix_paths = {ref['path'] for ref in refs}
    def retain(slot):
        path = slot['artifact']['path']
        return (slot['category'] != 'custodian-observation' or path in prefix_paths) and not (
            path.startswith(E + '/holdout/seal-evidence/') or
            path in (E + '/holdout/released-seal.json', E + '/holdout/references.json'))
    prefix_root = {**root, 'artifacts': [slot for slot in root['artifacts'] if retain(slot)]}
    _validate_custodian_observations_v4(prefix_root, runtime, observations, artifacts)
    required = {canonical(ref): ref for ref in refs}
    forbidden = {T + '/authorizations/LABEL_EXECUTION.json', E + '/seal-receipt.json',
                 T + '/claim-descriptor.json', E + '/claim.json', E + '/unseal.json'}
    for obs in observations:
        _require(_utc(obs['observedUtc']) < cutoff, 'Builder-stop prefix must predate label permission')
        action = _action(prefix_root, obs, artifacts)
        _require(_utc(action['observedUtc']) < cutoff, 'Builder-stop action must predate label permission')
        _check_no_future_inputs(action, forbidden)
        for ref in [obs['actionRecord'], *action['inputs'], *(x['evidence'] for x in action['outcomes'])]:
            _require(ref['path'] not in forbidden and not ref['path'].startswith(E + '/holdout/'),
                     'Label authorization prefix contains downstream input')
            required[canonical(ref)] = ref
        if obs['detail']['event'] == 'BUILDERS_STOPPED':
            for worker in obs['detail']['workers']:
                _require(_utc(worker['startedUtc']) < _utc(worker['stoppedUtc']) <= _utc(obs['observedUtc']) < cutoff,
                         'Worker termination must predate label permission')
    inventory_ref, _ = _fixed(prefix_root, T + '/worker-inventory.json', artifacts)
    required[canonical(inventory_ref)] = inventory_ref
    return sorted(required.values(), key=lambda ref: ref['path'])


def validate_custodian_chain_v4(root, runtime_manifest, observations, artifacts):
    result = _validate_custodian_observations_v4(root, runtime_manifest, observations, artifacts)
    if any(x['detail']['event'] == 'UNSEALED' for x in result):
        sealed = next(x for x in result if x['detail']['event'] == 'SEALED')
        _validate_released_seal(root, runtime_manifest, result, artifacts, sealed)
    return result


def _validate_released_seal(root, manifest, observations, artifacts, sealed_observation):
    c = _core()
    _, raw = _fixed(root, c.E + '/holdout/released-seal.json', artifacts)
    released = _record(raw, 'ReleasedSeal')
    unsealed = next(x for x in observations if x['detail']['event'] == 'UNSEALED')
    for key in ('freeze', 'sealReceipt', 'claim', 'unseal'):
        expected = unsealed['freeze'] if key == 'freeze' else unsealed['detail'][key]
        _require(released[key] == expected, 'Released seal fixed parent binding changed')
    directory = c.E + '/holdout/seal-evidence'
    copies = {}
    for key, filename in (('privateManifest', 'private-manifest'), ('labels', 'labels'),
                          ('author', 'author'), ('checker', 'checker'), ('novelty', 'novelty')):
        _require(released[key]['path'] == f'{directory}/{filename}.json', 'Released fixed copy path changed')
        copies[key] = _registered(root, released[key], artifacts)
    private = _parent(root, released['privateManifest'], artifacts, 'SealManifest')
    _require(_sha(copies['privateManifest']) == unsealed['detail']['privateManifestHash'] and
             private['nonceHex'] == released['nonceHex'] and private['freeze'] == released['freeze'],
             'Released original manifest/nonce/freeze changed')
    for key in ('labels', 'author', 'checker', 'novelty'):
        _require(private[key]['sha256'] == _sha(copies[key]), 'Released copy differs from original private ref')
    for key in ('protocolHash', 'sourceManifestHash', 'denialReceipt'):
        _require(released[key] == private[key], 'Released protocol/source/denial changed')
    freeze = _parent(root, released['freeze'], artifacts, 'Envelope', kind='freeze')
    _require(private['denialReceipt'] == freeze['payload']['denialReceipt'] and
             private['protocolHash'] == manifest['identity']['protocolHash'] and
             private['sourceManifestHash'] == manifest['identity']['sourceManifestHash'],
             'Released source/denial not current')
    nonce = bytes.fromhex(private['nonceHex'])
    _require(len(nonce) == 32, 'Exact 256-bit nonce required')
    seal = _parent(root, released['sealReceipt'], artifacts, 'Envelope', kind='seal-receipt')['payload']
    _require(seal['commitment'] == _sha(nonce + copies['labels']) and
             seal['privateReviewCommitment'] == _sha(nonce + canonical({k: private[k] for k in
                      ('author', 'checker', 'novelty')}).encode('utf-8')) and
             sealed_observation['detail']['privateManifestCommitment'] == _sha(nonce + copies['privateManifest']),
             'Salted private commitments changed')
    labels = _parent(root, released['labels'], artifacts, 'Envelope', kind='references')
    _require(labels['payload']['split'] == 'holdout', 'Released labels must be holdout References')
    from semantic_readiness_v4 import _references, THEMES
    rows = _references(labels['payload']['queries'])
    _require(len(rows) == 40 and sum(x['answerable'] for x in rows) == 32 and
             {x['module'] for x in rows} == THEMES and all(
                 sum(x['module'] == theme and x['answerable'] for x in rows) == 4 and
                 sum(x['module'] == theme and not x['answerable'] for x in rows) == 1 for theme in THEMES),
             'Released actual holdout quotas changed')
    _, references = _fixed(root, c.E + '/holdout/references.json', artifacts)
    _require(references == copies['labels'], 'Holdout reference bytes reserialized/substituted')
    _released_executions(root, manifest, released, artifacts, unsealed)
    return released


def _released_executions(root, manifest, released, artifacts, unsealed):
    c = _core()
    registry_raw = artifacts.get(root.get('executionRegistry', {}).get('path'))
    public = c._parse(registry_raw)['entries'] if registry_raw is not None else []
    used_calls = {x['callId'] for x in public}
    used_workspaces = {x['workspaceId'] for x in public}
    batches = {}
    unseal_action = _action(root, unsealed, artifacts)
    _require(unseal_action['source'] == 'custodian', 'Actual custodian unseal action required for released replay')
    prior_utc = _utc(unseal_action['observedUtc'])
    roles = {'author': 0, 'checker': 1, 'novelty': 2}
    ordered = sorted(released['executions'], key=lambda x: (roles[x['role']], x['batchOrdinal']))
    _require(released['executions'] == ordered, 'Released executions must be in canonical role/batch order')
    for release_index, execution in enumerate(ordered):
        c._validate_record(execution, 'ReleasedExecution')
        role, ordinal = execution['role'], execution['batchOrdinal']
        _require(execution['purpose'] == {'author': 'label-author', 'checker': 'label-check',
                                         'novelty': 'novelty-check'}[role], 'Private purpose/role mismatch')
        directory = f'{c.E}/holdout/seal-evidence/raw/{role}/{ordinal}'
        binding_ref, binding_raw = _fixed(root, directory + '/release-binding.json', artifacts)
        binding = _record(binding_raw, 'ReleaseBinding')
        for key in ('role', 'batchOrdinal', 'originalControlRoot', 'originalOutputDirectory',
                    'originalWorkspaceId', 'callId', 'expectedFileHashes', 'runtime', 'prompt',
                    'projectionHash', 'custodianReplayAction', 'releasedFiles'):
            _require(execution[key] == binding[key], 'Supervisor original release binding changed: ' + key)
        _require(binding['runtime'] == manifest['runtime'] and binding['prompt']['path'] == directory + '/prompt.txt',
                 'Released runtime/prompt fixed path changed')
        raw = _six(root, {field: execution['releasedFiles'][name] for field, name in SIX.items()},
                   binding['expectedFileHashes'], directory, artifacts)
        prompt_raw = _registered(root, binding['prompt'], artifacts)
        _require(binding['custodianReplayAction']['path'] == directory + '/custodian-replay.json',
                 'Fixed custodian replay action required')
        _require(binding['claim'] == released['claim'] and binding['unseal'] == released['unseal'],
                 'Release binding claim/unseal changed')
        expected = {key: unsealed[key] for key in
                    ('supervisorTask', 'custodianRunId', 'custodianPrincipal', 'policyHash', 'runtimeManifest')}
        expected.update(processIdentity=unseal_action['processIdentity'],
                        sequence=unsealed['sequence'] + 1 + release_index)
        action = _external_action(root, binding['custodianReplayAction'], artifacts, 'PRIVATE_REPLAY', expected,
            [binding['prompt'], released['freeze'], released['sealReceipt'], released['claim'], released['unseal'],
             *execution['releasedFiles'].values()])
        expected_inputs = [root['runtimeManifest'], binding['prompt'], released['freeze'], released['sealReceipt'],
                           released['claim'], released['unseal'], *execution['releasedFiles'].values()]
        _require(action['source'] == 'custodian' and {canonical(ref) for ref in action['inputs']} ==
                 {canonical(ref) for ref in expected_inputs}, 'Private replay exact input/source binding changed')
        observed_utc = _utc(action['observedUtc'])
        _require(observed_utc > prior_utc, 'Private replay must follow unseal in strictly increasing observed order')
        prior_utc = observed_utc
        _exact_outcomes(action, {(key, f'{role}/{ordinal}'): ('VERIFIED', 0) for key in CHECKS})
        _require(set(binding['checksEvidence']) == set(CHECKS), 'Exact private replay evidence checks required')
        for key in CHECKS:
            evidence = _registered(root, binding['checksEvidence'][key], artifacts)
            _require(bool(evidence.strip()), 'Missing private replay transcript')
            outcome = _outcome(action, key, f'{role}/{ordinal}', 'VERIFIED')
            _require(outcome['evidence'] == binding['checksEvidence'][key], 'Private replay check lacks actual evidence')
        pins = {'controlRoot': binding['originalControlRoot'], 'expectedFileHashes': binding['expectedFileHashes'],
                'runtime': binding['runtime']}
        receipt = _verify_execution_bytes_v4(raw, binding['originalOutputDirectory'],
            frozen_prompt=prompt_raw.decode('utf-8', 'strict'), frozen_schema_bytes=raw['schema.json'], trusted_pins=pins)
        _cli(manifest, c._parse(raw['invocation.json']))
        _require(receipt['callId'] == binding['callId'] and receipt['workspaceId'] == binding['originalWorkspaceId'] and
                 receipt['callId'] not in used_calls and receipt['workspaceId'] not in used_workspaces,
                 'Released observed call/workspace changed or reused')
        used_calls.add(receipt['callId']); used_workspaces.add(receipt['workspaceId'])
        _require(ordinal not in batches.setdefault(role, set()), 'Duplicate private batch')
        batches[role].add(ordinal)
    _require(set(batches) == {'author', 'checker', 'novelty'} and all(v == set(range(len(v))) for v in batches.values()),
             'Missing private role/contiguous batch coverage')


def _corpus_maps(runtime, artifacts):
    """Current finite registered corpus bytes, without retrieval or model loading."""
    entries = {entry['artifact']['path']: entry for entry in runtime['entries']}
    def record(path):
        _require(path in entries, 'Corpus input missing from runtime inventory')
        return _parse(_ref(entries[path]['artifact'], artifacts))
    manifest = record(CORPUS + '/manifest.json')
    chunks = record(CORPUS + '/chunks.json')
    index = record(CORPUS + '/index.json')
    identity = runtime['identity']
    for field, name in (('sourceManifestHash', 'manifest'), ('chunksHash', 'chunks'), ('indexHash', 'index')):
        _require(identity[field] == entries[CORPUS + '/' + name + '.json']['artifact']['sha256'],
                 'Corpus raw-byte identity mismatch: ' + field)
    _require(type(manifest.get('sources')) is list and bool(manifest['sources']) and
             type(chunks) is list and bool(chunks), 'Missing corpus sources/chunks')
    sources, originals = {}, {}
    for row in manifest['sources']:
        sid = row.get('sourceId')
        _require(type(sid) is str and sid and '/' not in sid and sid not in ('.', '..') and sid not in sources,
                 'Invalid/duplicate corpus source ID')
        source = record(CORPUS + '/sources/' + sid + '.json')
        _require(source.get('sourceId') == sid and source.get('sourceVersion') == row.get('sourceVersion') and
                 type(source.get('text')) is str and _hash(source['text'].encode('utf-8')) == row['sourceVersion'],
                 'Corpus source identity/text mismatch')
        sources[sid] = source
    corpus = _digest({'sources': [(row['sourceId'], row['sourceVersion']) for row in manifest['sources']],
                      'chunking': manifest['chunking'], 'embeddingModel': manifest['model']})
    _require(identity['corpusVersion'] == manifest.get('corpusVersion') == index.get('corpusVersion') == corpus and
             index.get('model') == manifest['model'], 'Corpus version/model mismatch')
    for chunk in chunks:
        cid = chunk.get('chunkId')
        _require(type(cid) is str and cid not in originals and chunk.get('sourceId') in sources,
                 'Invalid/duplicate corpus chunk')
        originals[cid] = chunk
    from semantic_proof_v4 import _packet
    for chunk in chunks:
        _packet([chunk], originals, sources)
    _require(manifest.get('sourceCount') == len(sources) and manifest.get('chunkCount') == len(chunks),
             'Corpus counts mismatch')
    model_refs = [entry['artifact'] for entry in runtime['entries']
                  if entry['category'] == 'model' and entry['role'] == 'embedding-model']
    _require(model_refs and identity['embeddingModelHash'] == _digest(model_refs),
             'Installed embedding model artifacts missing or stale')
    return originals, sources
