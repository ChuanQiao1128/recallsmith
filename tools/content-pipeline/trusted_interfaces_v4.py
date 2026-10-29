"""Offline trusted-registration consumers. Matching bytes never create external authority.

The sole production constructor reads the fixed supervisor node. Test snapshots
are separately branded and cannot enter any public authorization consumer.
Semantic proof replay and the final Selection/gate consumer belong to Stage C.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass
import hashlib
import json
import os
import re
from pathlib import Path
import stat
import sys
from types import MappingProxyType
import weakref

import jsonschema
from jsonschema import validators
from referencing import Registry

from execution_receipt_v4 import _json, LIMITS
from pipeline import canonical

C = '/Users/qc/.local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028'
R = '/Users/qc/src/recallsmith-aws-basics-delivery-20261028'
E, D, T = C + '/evaluation/rag-v2', C + '/evaluation/rag-v2/dev/adoption-v1', C + '/evaluation/rag-v2/trusted-v4'
P = R + '/tools/content-pipeline'
CORPUS = C + '/retrieval-v3/corpus'
INTERFACE_VERSION, CYCLE_ID = 'trusted-v4-1', 'aws-basics-v4-1'
SCHEMA_PATH = str(Path(__file__).with_name('semantic-v4-trusted-interfaces.schema.json'))
CONTRACT_PATH = Path(__file__).with_name('semantic-v4-adoption-contract.json')
SOURCE_RULES = frozenset(('source-closure', 'runtime-binaries', 'dependency-closure',
    'projection-boundary', 'tool-network-boundary', 'credential-nonexposure',
    'public-log-nonleak', 'entrypoint-confinement'))
NODES = ('contract-review', 'reference-equivalence', 'adoption-implementation-review',
         'current-source-review', 'isolation-denial', 'integration-canary',
         'selection-freeze', 'label-seal', 'holdout-claim', 'unseal', 'semantic-gate')
REVIEW_NODES = frozenset(('contract-review', 'reference-equivalence',
    'adoption-implementation-review', 'current-source-review', 'integration-canary', 'semantic-gate'))
PREREQUISITES = {
    'contract-review': (), 'reference-equivalence': ('contract-review',),
    'adoption-implementation-review': ('contract-review',), 'current-source-review': (),
    'isolation-denial': ('current-source-review',),
    'integration-canary': ('current-source-review', 'isolation-denial'),
    'selection-freeze': ('contract-review', 'reference-equivalence', 'adoption-implementation-review',
                         'current-source-review', 'isolation-denial', 'integration-canary'),
    'label-seal': ('selection-freeze',), 'holdout-claim': ('label-seal',),
    'unseal': ('holdout-claim',), 'semantic-gate': ('unseal',),
}
PERMISSION_PREREQUISITES = {
    'ADOPT_INPUTS_ONLY': ('contract-review', 'reference-equivalence', 'adoption-implementation-review'),
    'DEV_EQUIVALENCE_EXECUTION': ('contract-review', 'current-source-review', 'isolation-denial'),
    'DEV_PROOF_EXECUTION': ('contract-review', 'reference-equivalence', 'adoption-implementation-review',
                            'current-source-review', 'isolation-denial'),
    'INTEGRATION_CANARY': ('contract-review', 'reference-equivalence', 'adoption-implementation-review',
                         'current-source-review', 'isolation-denial'),
    'LABEL_EXECUTION': ('selection-freeze', 'current-source-review', 'isolation-denial'),
    'HOLDOUT_EXECUTION': ('selection-freeze', 'label-seal', 'holdout-claim', 'unseal',
                          'current-source-review', 'isolation-denial'),
}
CORE_MODULES = ('pipeline', 'evaluate', 'readiness', 'author', 'batch_author', 'model_dispatch',
    'curate', 'mcp_evidence', 'semantic_proof_v4', 'semantic_runtime_v4', 'semantic_readiness_v4',
    'dev_adoption_v4', 'proof_schedule_v4', 'proof_transport_v4', 'execution_receipt_v4',
    'metric_wire_v4', 'trusted_interfaces_v4', 'trusted_custody_v4', 'dev_gate_replay_v4',
    'holdout_gate_replay_v4', 'semantic_gate_v4', 'author_execution', 'query_validation')
C_ASSETS = ('SEMANTIC_V4_GATE_CONSUMERS.md', 'semantic-v4-equivalence-input-policy-v2.json',
    'equivalence-instructions-v2.txt', 'semantic-v4-equivalence-output-v2.schema.json',
    'semantic-v4-equivalence-schedule-v2.schema.json', 'test_dev_gate_replay_v4.py',
    'test_dev_gate_fixtures_v4.py', 'test_full_gate_fixtures_v4.py', 'test_holdout_gate_fixtures_v4.py',
    'test_semantic_gate_v4.py', 'private-label-instructions-v1.json',
    'test_trusted_interfaces_v4.py', 'test_trusted_custody_v4.py', 'test_execution_receipt_v4.py',
    'test_semantic_proof_v4.py', 'test_dev_adoption_v4.py')
WORKBENCH_ASSETS = ('Workbench/Contracts.cs', 'Workbench/Program.cs', 'Workbench/CodexExecutor.cs',
    'Workbench/CodexChatClient.cs', 'Workbench/Ledger.cs', 'Workbench/Telemetry.cs', 'Workbench/Workbench.csproj',
    'Workbench.Tests/Program.cs', 'Workbench.Tests/Workbench.Tests.csproj', 'scripts/unix-process-host.py')


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _hash(raw):
    return hashlib.sha256(raw).hexdigest()


def _digest(value):
    return _hash(canonical(value).encode('utf-8'))


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
    schema = _parse(_read_stable(SCHEMA_PATH))
    _require(name in schema['$defs'], 'Unknown trusted record kind')
    try:
        _VALIDATOR({'$ref': '#/$defs/' + name, '$defs': schema['$defs']},
                   registry=Registry()).validate(record)
    except (jsonschema.ValidationError, jsonschema.SchemaError) as exc:
        raise ValueError('Invalid closed ' + name) from exc
    return record


def _path(value):
    _require(type(value) is str and value.startswith('/') and value != '/' and
             str(Path(value)) == value and '..' not in Path(value).parts and
             '\x00' not in value, 'Noncanonical absolute path')
    return value


def _read_stable(path, limit=2_000_000, identities=None):
    """Open every ancestor without following aliases; reject substitution/read races."""
    _path(path)
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        parts = Path(path).parts[1:]
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(fd)
            identity = (before.st_dev, before.st_ino)
            _require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= limit,
                     'Nonregular/hardlinked/oversized file')
            _require(identities is None or identity not in identities, 'Repeated file identity')
            with os.fdopen(fd, 'rb', closefd=False) as stream:
                raw = stream.read(limit + 1)
            after = os.fstat(fd)
            current = os.stat(parts[-1], dir_fd=directory, follow_symlinks=False)
            keys = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
            _require(len(raw) <= limit and all(getattr(before, key) == getattr(after, key) ==
                     getattr(current, key) for key in keys), 'File changed during read')
            if identities is not None:
                identities.add(identity)
            return raw
        finally:
            os.close(fd)
    except OSError as exc:
        raise ValueError('Unavailable/aliased trusted file: ' + path) from exc
    finally:
        os.close(directory)


def _ref(ref, artifacts):
    _require(type(ref) is dict and set(ref) == {'path', 'sha256'} and
             type(ref['sha256']) is str and re.fullmatch(r'[0-9a-f]{64}', ref['sha256']) is not None,
             'Invalid closed artifact reference')
    _path(ref['path'])
    raw = artifacts.get(ref['path'])
    _require(type(raw) is bytes and _hash(raw) == ref['sha256'], 'Unregistered/stale artifact reference')
    return raw


def _refs(refs, artifacts):
    paths = [ref['path'] for ref in refs]
    _require(len(paths) == len(set(paths)), 'Duplicate input reference')
    for ref in refs:
        _ref(ref, artifacts)


def _bindings(root):
    _require(len(root['authorities']) == len(NODES) and
             {item['node'] for item in root['authorities']} == set(NODES), 'Missing/duplicate authority node')
    return {item['node']: item for item in root['authorities']}


def _fixed_ref(ref, path, artifacts):
    _require(ref['path'] == path, 'Reference does not match fixed registered path')
    return _ref(ref, artifacts)


def _runtime_required_inputs(root, runtime):
    # The complete manifest closes source/runtime bytes; no HEAD-only substitute.
    contract = _parse(_read_stable(str(CONTRACT_PATH)))
    refs = [root['runtimeManifest']] + contract['x-contract']['parentContracts']
    refs += [entry['artifact'] for entry in runtime['entries']]
    return {ref['path']: ref for ref in refs}


def _validate_runtime_manifest(root, manifest, artifacts):
    _validate_record(manifest, 'RuntimeManifest')
    seen, entries, dependencies = {}, manifest['entries'], {}
    forbidden = (E + '/', C + '/authoring/')
    for entry in entries:
        ref, category = entry['artifact'], entry['category']
        path = _path(ref['path'])
        _require(path not in seen and path != C + '/run.json' and
                 (not any(path.startswith(prefix) for prefix in forbidden) or
                  (path == T + '/requested-model-route.json' and category == 'model' and entry['role'] == 'model-contract')),
                 'Duplicate/self/generated runtime dependency')
        _require(not path.startswith(C + '/') or path.startswith(CORPUS + '/') or
                 path.startswith(C + '/design/rag-v2-bounded/r4/') or
                 path == T + '/requested-model-route.json', 'Generated/control artifacts cannot be runtime inputs')
        raw = _ref(ref, artifacts)
        _require(len(raw) <= _entry_limit(entry), 'Runtime file exceeds reviewed byte bound')
        deps = entry['dependencies']
        _require(len({d['path'] for d in deps}) == len(deps) and all(
            d['path'] in seen and seen[d['path']]['artifact'] == d for d in deps),
            'Dependency must equal an earlier runtime entry')
        if path == P + '/semantic-v4-equivalence-input-policy-v2.json':
            policy = _parse(raw)
            fixed_inputs = [P + '/' + name for name in ('equivalence-instructions-v2.txt',
                'semantic-v4-equivalence-output-v2.schema.json', 'semantic-v4-equivalence-schedule-v2.schema.json')]
            _require(type(policy) is dict and deps == [policy.get(key) for key in
                     ('instructions', 'outputSchema', 'scheduleSchema')] and
                     [dep['path'] for dep in deps] == fixed_inputs,
                     'Equivalence policy dependencies must be exactly the three fixed input references in order')
        _require(entry['role'] not in ('runner-assembly', 'process-host', 'cli-executable') or
                 category == 'binary', 'Runtime executable role requires binary category')
        seen[path], dependencies[path] = entry, [d['path'] for d in deps]
        if path.endswith('.py') and category in ('source', 'algorithm'):
            try:
                tree = ast.parse(raw.decode('utf-8'))
            except (SyntaxError, UnicodeError) as exc:
                raise ValueError('Invalid inventoried Python source') from exc
            imported = {node.module.split('.')[0] for node in ast.walk(tree)
                        if isinstance(node, ast.ImportFrom) and node.module and not node.level}
            imported |= {alias.name.split('.')[0] for node in ast.walk(tree)
                         if isinstance(node, ast.Import) for alias in node.names}
            direct = set(dependencies[path])
            for name in imported - sys.stdlib_module_names - {'__future__'}:
                local = P + '/' + name + '.py'
                candidates = [p for p in direct if p == local or
                              ('/' + name + '/') in p or Path(p).name.startswith(name + '.') or ('/' + name + '-') in p]
                _require(bool(candidates), 'Missing direct Python import/dependency: ' + name)
    _refs(manifest['entrypoints'], artifacts)
    _require(all(ref['path'] in seen and seen[ref['path']]['artifact'] == ref and
                 seen[ref['path']]['category'] in ('source', 'binary', 'algorithm')
                 for ref in manifest['entrypoints']), 'Invalid runtime entrypoint')
    reachable = set()
    def visit(path):
        if path not in reachable:
            reachable.add(path)
            for dependency in dependencies[path]:
                visit(dependency)
    for ref in manifest['entrypoints']:
        visit(ref['path'])
    _require(reachable == set(seen), 'Unreachable runtime entry')
    required = {P + '/' + name + '.py' for name in CORE_MODULES}
    required |= {P + '/' + name for name in ('TRUSTED_V4_INTERFACES.md',
        'semantic-v4-trusted-interfaces.schema.json', 'semantic-v4-adoption-contract.json',
        'SEMANTIC_V4_ADOPTION.md', 'semantic-v4-rational-metric-wire-v1.schema.json')}
    required |= {R + '/tools/mcp-server/src/server.ts', R + '/tools/mcp-server/package-lock.json',
                 R + '/tools/content-workbench/Workbench/CodexExecutor.cs',
                 R + '/tools/content-workbench/Workbench/Workbench.csproj'}
    required |= {P + '/' + name for name in C_ASSETS}
    required |= {R + '/tools/content-workbench/' + name for name in WORKBENCH_ASSETS}
    _require(any('/tools/mcp-server/' in p and '/dist/' in p and p.endswith('.js')
                 for p in seen), 'Built MCP bundle missing')
    _require(required <= set(seen), 'Incomplete required consumer inventory')
    required_tests = {P + '/' + name for name in C_ASSETS if name.startswith('test_')}
    required_tests |= {R + '/tools/content-workbench/' + name for name in WORKBENCH_ASSETS
                       if name.startswith('Workbench.Tests/')}
    _require(all(seen[path]['category'] == 'test' for path in required_tests),
             'Consumer regression/fixture sources must enter the test identity')
    _require(seen[P + '/private-label-instructions-v1.json']['category'] == 'prompt',
             'Private label instructions must enter the prompt identity')
    _require(any(e['category'] == 'dependency' for e in entries), 'Installed dependency inventory missing')
    _require(any(p.endswith(('.lock', 'lock.json', 'requirements.txt', 'requirements.lock.txt')) for p in seen), 'Dependency lockfile missing')
    route_entries = [entry for entry in entries if entry['role'] == 'model-contract']
    _require(len(route_entries) == 1 and route_entries[0]['category'] == 'model' and
             route_entries[0]['artifact']['path'] == T + '/requested-model-route.json', 'Exactly one fixed requested-route model contract required')
    _validate_record(_parse(_ref(route_entries[0]['artifact'], artifacts)), 'RequestedModelRoute')
    proof_schemas = [entry for entry in entries if entry['role'] == 'proof-output-schema']
    proof_schema_path = P + '/semantic-v4-proof-output.schema.json'
    _require(len(proof_schemas) == 1 and proof_schemas[0]['category'] == 'schema' and
             proof_schemas[0]['artifact']['path'] == proof_schema_path, 'Exactly one fixed proof output schema required')
    _require(_ref(proof_schemas[0]['artifact'], artifacts) ==
             _read_stable(str(Path(__file__).with_name('semantic-v4-proof-output.schema.json'))),
             'Proof output schema differs from actual consumer schema bytes')
    for category, field in (('test', 'testsHash'), ('prompt', 'promptsHash'), ('schema', 'schemaHash'),
                            ('algorithm', 'algorithmHash'), ('model', 'modelIdentityHash')):
        refs = [e['artifact'] for e in entries if e['category'] == category]
        _require(bool(refs) and manifest['identity'][field] == _digest(refs), 'Invalid runtime ' + field)
    _require(manifest['identity']['implementationManifestHash'] == _digest(entries),
             'Invalid ordered implementation manifest identity')
    for role, field in (('runner-assembly', 'runnerAssemblyHash'), ('process-host', 'processHostHash'),
                        ('cli-executable', None)):
        refs = [e['artifact'] for e in entries if e['role'] == role]
        _require(len(refs) == 1, 'Exactly one actual binary required: ' + role)
        if field:
            _require(manifest['runtime'][field] == refs[0]['sha256'], 'Stale runtime binary')
    protocol = C + '/design/rag-v2-bounded/r4/semantic-protocol.md'
    _require(protocol in seen and seen[protocol]['category'] == 'protocol' and
             manifest['identity']['protocolHash'] == seen[protocol]['artifact']['sha256'], 'Protocol identity differs')
    for ref in _parse(_read_stable(str(CONTRACT_PATH)))['x-contract']['parentContracts']:
        _ref(ref, artifacts)
        _require(ref['path'] in seen and seen[ref['path']]['artifact'] == ref, 'Parent contract not inventoried')
    _corpus_maps(manifest, artifacts)
    return manifest


def _corpus_maps(runtime, artifacts):
    from trusted_custody_v4 import _corpus_maps as verified_corpus_maps
    return verified_corpus_maps(runtime, artifacts)


def _validate_review(root, runtime, binding, artifacts):
    node, ref = binding['node'], binding['acceptedReview']
    _require(ref is not None, 'PASS review authority needs accepted review')
    envelope = _validate_record(_parse(_fixed_ref(ref, T + '/reviews/' + node + '/accepted.json', artifacts)),
                                'AcceptedReview')
    request = _validate_record(_parse(_fixed_ref(envelope['rawRequest'], T + '/reviews/' + node + '/request.json', artifacts)),
                              'ReviewRequest')
    _fixed_ref(envelope['rawReport'], T + '/reviews/' + node + '/report.json', artifacts)
    _require(envelope['node'] == request['node'] == node and
             envelope['supervisorTask'] == root['supervisorTask'] and
             envelope['observedTask'] not in (root['supervisorTask'], request['producerTask']) and
             envelope['context'] in ('fresh-native', 'restricted-workbench', 'deterministic') and
             envelope['runtimeManifest'] == root['runtimeManifest'] and
             envelope['identity'] == runtime['identity'] and
             envelope['boundInputs'] == request['boundInputs'] == binding['boundInputs'],
             'Review independence/current input binding mismatch')
    _refs(envelope['boundInputs'], artifacts)
    rules = request['ruleIds']
    _require(len(rules) == len(set(rules)), 'Duplicate requested review rule')
    outcomes = envelope['ruleOutcomes']
    _require(len(outcomes) == len(rules) and {o['ruleId'] for o in outcomes} == set(rules),
             'Review did not cover exact requested rules')
    for outcome in outcomes:
        _refs(outcome['evidence'], artifacts)
    states = {o['outcome'] for o in outcomes}
    expected = 'FAIL' if 'FAIL' in states else 'PASS' if states == {'PASS'} else 'UNKNOWN'
    _require(envelope['accepted'] == expected == 'PASS' and not envelope['limitations'],
             'Review rule conjunction not fully accepted')
    if node == 'current-source-review':
        _require(SOURCE_RULES <= set(rules) and envelope['context'] == 'fresh-native',
                 'Missing common source/confinement rule or fresh context')
        required = _runtime_required_inputs(root, runtime)
        bound = {ref['path']: ref for ref in envelope['boundInputs']}
        _require(all(bound.get(path) == ref for path, ref in required.items()),
                 'Incomplete current source/runtime review boundary')
    return envelope


def _validate_authorities(root, runtime, artifacts, node_names=None):
    bindings = _bindings(root)
    for binding in bindings.values():
        if node_names is not None and binding['node'] not in node_names:
            continue
        _refs(binding['boundInputs'], artifacts)
        if binding['state'] != 'PASS':
            continue
        _require(all(bindings[name]['state'] == 'PASS' for name in PREREQUISITES[binding['node']]),
                 'Authority prerequisite not current PASS')
        _require(bool(binding['boundInputs']), 'PASS authority cannot bind empty inputs')
        if binding['node'] in REVIEW_NODES:
            _validate_review(root, runtime, binding, artifacts)
        else:
            _require(binding['observation'] is not None, 'PASS action authority needs observed event')
            observation = _validate_record(_parse(_ref(binding['observation'], artifacts)), 'CustodianObservation')
            _require(binding['observation']['path'] == T + '/custodian/' + str(observation['sequence']) + '.json',
                     'Authority observation is outside fixed custodian chain')
            events = {'isolation-denial': 'DENIAL_OBSERVED', 'selection-freeze': 'FREEZE_ACCEPTED',
                      'label-seal': 'SEALED', 'holdout-claim': 'CLAIM_CREATED', 'unseal': 'UNSEALED'}
            _require(observation['detail']['event'] == events[binding['node']], 'Wrong authority event')
    return bindings


def _validate_adoption_record(value, name):
    schema = _parse(_read_stable(str(CONTRACT_PATH)))
    try:
        if name == 'EquivalenceSchedule' and value.get('inputPolicyVersion') == 'dev-equivalence-input-v2':
            schema = _parse(_read_stable(P + '/semantic-v4-equivalence-schedule-v2.schema.json'))
            _VALIDATOR(schema, registry=Registry()).validate(value)
        else:
            _VALIDATOR({'$ref': '#/$defs/' + name, '$defs': schema['$defs']}, registry=Registry()).validate(value)
    except jsonschema.ValidationError as exc:
        raise ValueError('Invalid closed adoption ' + name) from exc
    return value


def _validate_authorization(root, runtime, authorization, artifacts):
    _validate_record(authorization, 'Authorization')
    permission = authorization['permission']
    _require(authorization['supervisorTask'] == root['supervisorTask'] and
             authorization['runtimeManifest'] == root['runtimeManifest'] and
             authorization['identity'] == runtime['identity'], 'Authorization identity mismatch')
    _refs(authorization['boundInputs'], artifacts)
    bindings = _bindings(root)
    prerequisites = authorization['prerequisites']
    names = [item['node'] for item in prerequisites]
    _require(len(names) == len(set(names)) and set(names) == set(PERMISSION_PREREQUISITES[permission]) and
             all(item == bindings[item['node']] and item['state'] == 'PASS' for item in prerequisites),
             'Authorization prerequisites not exact current PASS bindings')
    fixed = {root['runtimeManifest']['path']}
    if permission == 'ADOPT_INPUTS_ONLY':
        fixed |= {D + '/reference-mapping.json', D + '/packet-inventory.json'}
    elif permission == 'DEV_EQUIVALENCE_EXECUTION':
        fixed |= {D + '/candidate-mapping.json', D + '/references.json', D + '/reviews/schedule.json'}
    elif permission == 'DEV_PROOF_EXECUTION':
        fixed |= {D + '/reference-mapping.json', D + '/packet-inventory.json', D + '/references.json'}
    elif permission == 'INTEGRATION_CANARY':
        fixed |= {E + '/canary-plan.json'}
    else:
        fixed |= {E + '/freeze.json'}
        if permission == 'HOLDOUT_EXECUTION':
            fixed |= {E + '/seal-receipt.json', E + '/claim.json', E + '/unseal.json'}
            if authorization.get('contextVersion') == 'holdout-scope-inputs-v2':
                from trusted_custody_v4 import _fixed, _registered
                reference_ref, reference_raw = _fixed(root, E + '/holdout/references.json', artifacts)
                released = _parse(_fixed(root, E + '/holdout/released-seal.json', artifacts)[1])
                _require(reference_raw == _registered(root, released['labels'], artifacts),
                         'Holdout scope references differ from verified released labels')
                reference = _parse(reference_raw)
                cases = reference.get('payload', reference).get('queries')
                _require(type(cases) is list and len(cases) == 40 and
                         len({c['id'] for c in cases}) == 40,
                         'Holdout contextual authorization requires exact40 released cases')
                fixed.add(reference_ref['path'])
                for case in cases:
                    cid = case['id']
                    _require(type(cid) is str and re.fullmatch(r'[a-z][a-z0-9-]{0,63}', cid),
                             'Invalid released holdout case ID')
                    packet_ref, packet_raw = _fixed(root, E + '/holdout/packets/' + cid + '.json', artifacts)
                    packet = _parse(packet_raw)
                    _require(packet.get('identity') == runtime['identity'] and packet.get('kind') == 'packet' and
                             packet.get('payload', {}).get('queryEn') == case['queryEn'],
                             'Holdout contextual packet identity/case differs')
                    fixed.add(packet_ref['path'])
    protocol = C + '/design/rag-v2-bounded/r4/semantic-protocol.md'
    fixed.add(protocol)
    # Prerequisite receipts and each of their exact current inputs are consumed.
    for binding in prerequisites:
        fixed |= {ref['path'] for ref in binding['boundInputs']}
        fixed |= {ref['path'] for ref in (binding['acceptedReview'], binding['observation']) if ref}
    if permission in ('ADOPT_INPUTS_ONLY', 'DEV_PROOF_EXECUTION'):
        inventory = _validate_adoption_record(_parse(artifacts[D + '/packet-inventory.json']), 'PacketInventory')
        _require(inventory['proofConsumer']['identity'] == runtime['identity'] and
                 inventory['proofConsumer']['dependencyManifest'] == root['runtimeManifest'], 'Inventory consumer mismatch')
        fixed |= {item[key]['path'] for item in inventory['rows'] for key in ('originalPacket', 'packetAdoption')}
        fixed |= {inventory['proofConsumer'][key]['path'] for key in
                  ('dependencyManifest', 'adoptionContract', 'adoptionDocument')}
    if permission in ('DEV_EQUIVALENCE_EXECUTION', 'DEV_PROOF_EXECUTION', 'INTEGRATION_CANARY'):
        fixed |= {entry['artifact']['path'] for entry in runtime['entries']
                  if entry['category'] in ('prompt', 'schema')}
    if permission == 'DEV_EQUIVALENCE_EXECUTION':
        schedule = _validate_adoption_record(_parse(artifacts[D + '/reviews/schedule.json']), 'EquivalenceSchedule')
        fixed |= {D + '/reviews/projections/' + str(row['batchOrdinal']) + '.json' for row in schedule['batches']}
    if permission == 'LABEL_EXECUTION':
        from trusted_custody_v4 import _validate_label_authorization_prefix_v4
        termination_inputs = _validate_label_authorization_prefix_v4(
            root, runtime, artifacts, authorization['observedUtc'])
        fixed |= {ref['path'] for ref in termination_inputs}
    paths = {ref['path'] for ref in authorization['boundInputs']}
    _require(fixed == paths, 'Authorization omits required permission inputs')
    forbidden = {T + '/authorizations/' + permission + '.json', D + '/authority.json'}
    downstream = {
        'ADOPT_INPUTS_ONLY': (D + '/A/raw/', D + '/B/raw/'),
        'DEV_EQUIVALENCE_EXECUTION': (D + '/reviews/equivalence-one/', D + '/reviews/equivalence-two/'),
        'DEV_PROOF_EXECUTION': (D + '/A/raw/', D + '/B/raw/', D + '/A/checks/', D + '/B/checks/',
                                D + '/A/proofs/', D + '/B/proofs/'),
        'INTEGRATION_CANARY': (T + '/canary/raw/',),
        'LABEL_EXECUTION': (E + '/holdout/seal-evidence/',),
        'HOLDOUT_EXECUTION': (E + '/holdout/raw/',),
    }[permission]
    if permission in ('ADOPT_INPUTS_ONLY', 'DEV_EQUIVALENCE_EXECUTION', 'DEV_PROOF_EXECUTION'):
        forbidden |= {D + '/A/results.json', D + '/B/results.json'}
    _require(not paths & forbidden and not any(p.startswith(prefix) for p in paths for prefix in downstream),
             'Authorization depends on downstream output')
    return authorization


def _freeze(value):
    if type(value) is dict:
        return MappingProxyType({key: _freeze(child) for key, child in value.items()})
    if type(value) is list:
        return tuple(_freeze(child) for child in value)
    return value


def _thaw(value):
    if isinstance(value, (dict, MappingProxyType)):
        return {key: _thaw(child) for key, child in value.items()}
    if type(value) is tuple:
        return [_thaw(child) for child in value]
    return value


@dataclass(frozen=True, eq=False)
class _Snapshot:
    rootNode: object
    rootNodeHash: str
    runtimeManifest: object
    executionRegistry: object
    artifactsBySlot: object
    custodianObservations: object


_SNAPSHOTS = weakref.WeakKeyDictionary()


def _snapshot(root, runtime, registry, artifacts, *, synthetic):
    _validate_record(root, 'RootNode')
    _require(root['state'] == 'PASS', 'Supervisor registration is not PASS')
    _require(root['runtimeManifest']['path'] == T + '/runtime-manifest.json' and
             root['executionRegistry']['path'] == T + '/execution-registry.json', 'Wrong fixed manifest/registry path')
    _require(_parse(_ref(root['runtimeManifest'], artifacts)) == runtime and
             _parse(_ref(root['executionRegistry'], artifacts)) == registry, 'Root bytes differ from records')
    slots, paths = {}, set()
    for slot in root['artifacts']:
        _require(slot['slot'] not in slots and slot['artifact']['path'] not in paths, 'Duplicate artifact slot/path')
        slots[slot['slot']] = _ref(slot['artifact'], artifacts)
        paths.add(slot['artifact']['path'])
    _validate_runtime_manifest(root, runtime, artifacts)
    _validate_authorities(root, runtime, artifacts)
    for slot in root['artifacts']:
        path = slot['artifact']['path']
        if path.startswith(T + '/authorizations/'):
            auth = _parse(artifacts[path])
            _require(path == T + '/authorizations/' + auth.get('permission', '') + '.json', 'Authorization path mismatch')
            _validate_authorization(root, runtime, auth, artifacts)
    observations = []
    for path in sorted(paths):
        if path.startswith(T + '/custodian/'):
            value = _validate_record(_parse(artifacts[path]), 'CustodianObservation')
            _require(path == T + '/custodian/' + str(value['sequence']) + '.json', 'Observation path mismatch')
            observations.append(value)
    observations.sort(key=lambda row: row['sequence'])
    from trusted_custody_v4 import validate_execution_registry_v4, validate_custodian_chain_v4
    validate_execution_registry_v4(root, runtime, registry, artifacts)
    validate_custodian_chain_v4(root, runtime, observations, artifacts)
    snapshot = _Snapshot(_freeze(root), _digest(root), _freeze(runtime), _freeze(registry),
                         MappingProxyType(slots), _freeze(observations))
    _SNAPSHOTS[snapshot] = (synthetic, MappingProxyType(dict(artifacts)))
    return snapshot


def _snapshot_from_test_bytes(root, runtime_manifest, execution_registry, artifacts):
    """Private pure fixture path; its brand is rejected by every public consumer."""
    return _snapshot(root, runtime_manifest, execution_registry, artifacts, synthetic=True)


def _read_root():
    run = _parse(_read_stable(C + '/run.json', 16_000_000))
    _require(type(run) is dict and type(run.get('nodes')) is dict and
             'A3V4-trusted-root' in run['nodes'], 'Missing fixed supervisor trusted root')
    return _validate_record(run['nodes']['A3V4-trusted-root'], 'RootNode')


def _released_path(path):
    return path.startswith(E + '/holdout/seal-evidence/') or path in (
        E + '/holdout/released-seal.json', E + '/holdout/references.json')


def _entry_limit(entry):
    if entry['artifact']['path'] == CORPUS + '/chunks.json':
        return 16_000_000
    return 512_000_000 if entry['category'] in ('binary', 'model', 'dependency') else 2_000_000


def _registered_read_limit(ref, entries):
    path = ref['path']
    if path in entries:
        _require(entries[path]['artifact'] == ref, 'Root/runtime duplicate reference differs')
        return _entry_limit(entries[path])
    if path in (T + '/runtime-manifest.json', T + '/execution-registry.json', E + '/structural-map.json'):
        return 16_000_000
    return LIMITS.get(Path(path).name, 2_000_000)


def _prevalidate_registry_paths(root, registry):
    """Determine public raw paths from registrations before opening their bytes."""
    from trusted_custody_v4 import _output, _core, SIX
    _validate_record(registry, 'ExecutionRegistry')
    paths = set()
    for entry in registry['entries']:
        _validate_record(entry, 'ExecutionEntry')
        directory = _output(_core(), entry)
        _require(entry['outputDirectory'] == directory, 'Receipt-selected raw output directory')
        _path(directory)
        for field, filename in SIX.items():
            expected = directory + '/' + filename
            _require(entry[field]['path'] == expected and
                     entry[field]['sha256'] == entry['trustedPins']['expectedFileHashes'][filename],
                     'Raw reference differs from derived output/pin')
            paths.add(expected)
        _require(entry['scope']['prompt']['path'] == directory + '/prompt.txt' and
                 entry['scope']['schema'] == entry['emittedSchema'], 'Fixed prompt/schema path mismatch')
    for slot in root['artifacts']:
        if slot['category'] == 'raw-execution' and not _released_path(slot['artifact']['path']):
            _require(slot['artifact']['path'] in paths, 'Raw artifact is not derived from registered execution')


def load_trusted_snapshot_v4():
    _require(str(Path(__file__)) == str(Path(__file__).resolve()) == P + '/trusted_interfaces_v4.py',
             'Production consumer must use the fixed source root')
    root = _read_root()
    _require(root['state'] == 'PASS', 'Trusted registration unavailable or pending')
    refs = [root['runtimeManifest'], root['executionRegistry']] + [slot['artifact'] for slot in root['artifacts']]
    _require(root['runtimeManifest']['path'] == T + '/runtime-manifest.json' and
             root['executionRegistry']['path'] == T + '/execution-registry.json', 'Fixed supervisor path mismatch')
    identities, artifacts = set(), {}
    def read(ref, limit=2_000_000):
        _path(ref['path'])
        if ref['path'] not in artifacts:
            artifacts[ref['path']] = _read_stable(ref['path'], limit, identities)
        _ref(ref, artifacts)
    read(root['runtimeManifest'], 16_000_000)
    runtime = _validate_record(_parse(artifacts[root['runtimeManifest']['path']]), 'RuntimeManifest')
    runtime_entries = {entry['artifact']['path']: entry for entry in runtime['entries']}
    _require(len(runtime_entries) == len(runtime['entries']), 'Duplicate runtime path')
    read(root['executionRegistry'], 16_000_000)
    registry = _validate_record(_parse(artifacts[root['executionRegistry']['path']]), 'ExecutionRegistry')
    _prevalidate_registry_paths(root, registry)
    # Pre-unseal released evidence is not even opened.
    unseal = next((binding for binding in root['authorities'] if binding['node'] == 'unseal'), None)
    released_refs = [ref for ref in refs if _released_path(ref['path'])]
    for ref in refs:
        if not _released_path(ref['path']):
            read(ref, _registered_read_limit(ref, runtime_entries))
    for entry in runtime['entries']:
        _require(not _released_path(entry['artifact']['path']), 'Released input cannot be runtime dependency')
        read(entry['artifact'], _entry_limit(entry))
    if released_refs:
        _require(unseal is not None and unseal['state'] == 'PASS', 'Private release before accepted unseal')
        _validate_runtime_manifest(root, runtime, artifacts)
        _validate_authorities(root, runtime, artifacts, set(NODES) - {'semantic-gate'})
        observations = [_parse(data) for path, data in artifacts.items() if path.startswith(T + '/custodian/')]
        observations.sort(key=lambda row: row['sequence'])
        from trusted_custody_v4 import _validate_custodian_observations_v4
        _validate_custodian_observations_v4(root, runtime, observations, artifacts)
        _require(any(row['detail']['event'] == 'UNSEALED' for row in observations), 'No witnessed unseal')
        for ref in released_refs:
            read(ref, LIMITS.get(Path(ref['path']).name, 2_000_000))
    snapshot = _snapshot(root, runtime, registry, artifacts, synthetic=False)
    _check_snapshot(snapshot)
    _check_corpus_registration(runtime)
    return snapshot


def _check_corpus_registration(runtime):
    run = _parse(_read_stable(C + '/run.json', 16_000_000))
    registration = run.get('nodes', {}).get('A2R-corpus', {})
    _require(registration.get('status') == 'produced' and
             registration.get('corpusVersion') == runtime['identity']['corpusVersion'],
             'Current supervisor corpus registration mismatch')
    entries = {entry['artifact']['path']: entry['artifact'] for entry in runtime['entries']}
    manifest_raw = _read_stable(CORPUS + '/manifest.json')
    manifest = _parse(manifest_raw)
    _require(registration.get('sourceCount') == manifest.get('sourceCount') and
             registration.get('chunkCount') == manifest.get('chunkCount') and
             manifest.get('corpusVersion') == registration['corpusVersion'] and
             CORPUS + '/manifest.json' in entries and
             _hash(manifest_raw) == entries[CORPUS + '/manifest.json']['sha256'],
             'Supervisor corpus inventory differs')


def _check_snapshot(snapshot):
    _require(type(snapshot) is _Snapshot and snapshot in _SNAPSHOTS, 'Unbranded snapshot')
    synthetic, artifacts = _SNAPSHOTS[snapshot]
    _require(not synthetic, 'Synthetic snapshot cannot authorize production')
    _require(_digest(_read_root()) == snapshot.rootNodeHash, 'Supervisor root changed; snapshot stale')
    _check_corpus_registration(_thaw(snapshot.runtimeManifest))
    identities = set()
    entries = {entry['artifact']['path']: entry for entry in _thaw(snapshot.runtimeManifest)['entries']}
    for path, raw in artifacts.items():
        limit = _registered_read_limit({'path': path, 'sha256': _hash(raw)}, entries)
        _require(_read_stable(path, limit, identities) == raw, 'Registered input changed; snapshot stale')
    _require(_digest(_read_root()) == snapshot.rootNodeHash, 'Supervisor root changed during consumption')
    return _thaw(snapshot.rootNode), _thaw(snapshot.runtimeManifest), artifacts


def require_authority_v4(snapshot, node):
    root, runtime, artifacts = _check_snapshot(snapshot)
    _require(node in NODES, 'Unknown authority node')
    bindings = _validate_authorities(root, runtime, artifacts)
    _require(bindings[node]['state'] == 'PASS', 'Required authority unavailable: ' + node)
    return _freeze(bindings[node])


def registered_executions_v4(snapshot, purpose, configuration, case_ids, group_id):
    _check_snapshot(snapshot)
    required = ('current-source-review', 'isolation-denial')
    if purpose.startswith('holdout-'):
        required += ('unseal',)
    for node in required:
        require_authority_v4(snapshot, node)
    registry = _thaw(snapshot.executionRegistry)
    entries = [entry for entry in registry['entries'] if entry['purpose'] == purpose and
               entry['scope']['configuration'] == configuration and entry['scope']['caseIds'] == list(case_ids) and
               entry['scope']['groupId'] == group_id]
    _require(bool(entries), 'No exact registered execution scope')
    role_key = 'checkerId' if purpose in ('dev-proof', 'holdout-proof') else 'role'
    return [{role_key: entry['role'], 'batchOrdinal': entry['batchOrdinal'],
             'outputDirectory': entry['outputDirectory'], 'trustedPins': entry['trustedPins']}
            for entry in entries]


def verify_custodian_chain_v4(snapshot):
    root, runtime, artifacts = _check_snapshot(snapshot)
    from trusted_custody_v4 import validate_custodian_chain_v4
    return _freeze(validate_custodian_chain_v4(root, runtime, _thaw(snapshot.custodianObservations), artifacts))


def _validate_selection_context(selection, results, verified_metrics, artifacts, identity):
    """Stage C private arithmetic bridge: metrics must follow full immutable replay."""
    from metric_wire_v4 import loads_record, verify_results_metrics, compare_semantic_metrics, encode_metrics
    loads_record(canonical(selection).encode('utf-8'))
    _require(selection['kind'] == 'selection' and selection['identity'] == identity,
             'Selection runtime identity mismatch')
    payload = selection['payload']
    _require([row['configuration'] for row in payload['evaluated']] == ['A', 'B'] and
             payload['newConfigurationCount'] == 2 and payload['historicalAttempts'] == 3 and
             payload['numericDevGate'] is None and set(results) == set(verified_metrics) == {'A', 'B'},
             'Selection must consume exact historical A/B slots')
    consumer = None
    for row in payload['evaluated']:
        config = row['configuration']
        raw = _fixed_ref(row['result'], D + '/' + config + '/results.json', artifacts)
        result = loads_record(raw)
        _require(result == results[config] and result['kind'] == 'dev80-adoption-results' and
                 result['proofConsumer']['identity'] == identity and result['configuration'] == result['payload']['configuration'] == config,
                 'Selection result identity/configuration mismatch')
        if consumer is None:
            consumer = result['proofConsumer']
        _require(result['proofConsumer'] == consumer, 'A/B proofConsumer differs')
        _ref(row['correctnessReview'], artifacts)
        verify_results_metrics(result['payload'], verified_metrics[config])
    score = compare_semantic_metrics(encode_metrics(verified_metrics['A']['macro']),
                                     encode_metrics(verified_metrics['B']['macro']))
    winner = 'A' if score >= 0 else 'B'
    _require(payload['selected'] == winner, 'Selected configuration differs from exact comparator')
    profile = _parse(_fixed_ref(payload['profile'], E + '/profiles/' + winner + '.json', artifacts))
    parent_schema = _parse(artifacts[C + '/design/rag-v2-bounded/r4/contracts.schema.json'])
    try:
        _VALIDATOR({'$ref': '#/$defs/Envelope', '$defs': parent_schema['$defs']}, registry=Registry()).validate(profile)
    except jsonschema.ValidationError as exc:
        raise ValueError('Invalid closed selected parent profile') from exc
    _require(profile['kind'] == 'profile' and profile['identity'] == identity and
             profile['payload']['configuration'] == winner and
             profile['payload']['radius'] == (1 if winner == 'A' else 2), 'Selected radius/profile identity mismatch')
    _fixed_ref(profile['payload']['map'], E + '/structural-map.json', artifacts)
    _ref(payload['canary'], artifacts)
    return winner


def validate_selection_bridge_v4(snapshot):
    """Compare A/B only after full immutable input and raw proof replay."""
    root, runtime, artifacts = _check_snapshot(snapshot)
    from dev_gate_replay_v4 import replay_dev_adoption_v4, replay_dev_results_v4
    from trusted_custody_v4 import _fixed
    registry = _thaw(snapshot.executionRegistry)
    adoption = replay_dev_adoption_v4(root, runtime, artifacts, registry, 'DEV_PROOF_EXECUTION')
    verified = {config: replay_dev_results_v4(root, runtime, artifacts, registry, config, adoption)
                for config in ('A', 'B')}
    selection = _parse(_fixed(root, E + '/selection.json', artifacts)[1])
    review = next(binding for binding in root['authorities'] if binding['node'] == 'adoption-implementation-review')
    _require(review['state'] == 'PASS' and review['acceptedReview'] is not None and all(
        row['correctnessReview'] == review['acceptedReview'] for row in selection['payload']['evaluated']),
        'Selection correctness reviews must match the current accepted implementation review')
    winner = _validate_selection_context(selection, {c: v['record'] for c, v in verified.items()},
               {c: v['metrics'] for c, v in verified.items()}, artifacts, runtime['identity'])
    _check_snapshot(snapshot)
    return winner


__all__ = ['load_trusted_snapshot_v4', 'require_authority_v4', 'registered_executions_v4',
           'verify_custodian_chain_v4', 'validate_selection_bridge_v4']
