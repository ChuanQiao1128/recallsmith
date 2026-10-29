"""SYNTHETIC full gate scaffolding; all writes are confined to Temp."""
import ast
import copy
from contextlib import contextmanager, ExitStack
import hashlib
import json
from pathlib import Path
import tempfile
import importlib.util
import sys
import os
from unittest.mock import patch

import trusted_interfaces_v4 as core
import trusted_custody_v4 as custody
import execution_receipt_v4 as execution_io
from pipeline import canonical
from test_trusted_interfaces_v4 import fixture, raw, ref, common, _install_review
from test_trusted_custody_v4 import Fixture
from test_execution_receipt_v4 import SyntheticReceiptTests


class FullFixture(Fixture):
    """Actual immutable80/corpus with synthetic runtime hosts and registered events."""
    def __init__(self):
        super().__init__()
        self.root, self.manifest, self.registry, self.artifacts = fixture()
        self.parent_schema = core._parse(self.artifacts[core.C + '/design/rag-v2-bounded/r4/contracts.schema.json'])
        self.protocol = ref(core.C + '/design/rag-v2-bounded/r4/semantic-protocol.md',
                            self.artifacts[core.C + '/design/rag-v2-bounded/r4/semantic-protocol.md'])
        self.access = ref(core.C + '/design/rag-v2-bounded/r4/access-protocol.md',
                          self.artifacts[core.C + '/design/rag-v2-bounded/r4/access-protocol.md'])
        self.counter = 0
        self._raw_counter = 0
        self.observations = []
        self.observation_times = {0: '2026-10-29T00:00:00Z', 1: '2026-10-29T01:00:00Z',
            2: '2026-10-29T01:00:02Z', 3: '2026-10-29T01:00:03Z',
            4: '2026-10-29T01:00:04Z', 5: '2026-10-29T01:00:05Z', 6: '2026-10-29T01:00:06Z'}
        # Preserve every actual corpus byte. Model/binary bytes remain explicitly synthetic.
        entries = self.manifest['entries']
        entries[:] = [e for e in entries if e['artifact']['path'] != '/synthetic/algorithm']
        algorithm_path = Path(core.C + '/design/rag-v2-bounded/r4/algorithm.md')
        self.add_runtime(str(algorithm_path), algorithm_path.read_bytes(), 'algorithm')
        entries[:] = [e for e in entries if not e['artifact']['path'].startswith(core.CORPUS + '/') and
                      not e['artifact']['path'].endswith('/synthetic/consumer.py')]
        for path in (Path(core.CORPUS) / 'manifest.json', Path(core.CORPUS) / 'chunks.json', Path(core.CORPUS) / 'index.json'):
            self.add_runtime(str(path), path.read_bytes(), 'dependency')
        manifest = core._parse(self.artifacts[core.CORPUS + '/manifest.json'])
        for source in manifest['sources']:
            path = Path(core.CORPUS) / 'sources' / (source['sourceId'] + '.json')
            self.add_runtime(str(path), path.read_bytes(), 'dependency')
        self.manifest['identity']['corpusVersion'] = manifest['corpusVersion']
        entries[:] = [e for e in entries if e['role'] != 'embedding-model']
        frozen_path = Path(core.C + '/evidence/r4-observed80-diagnostic/frozen-plan.json')
        frozen = json.loads(frozen_path.read_bytes())
        for model_path, expected_hash in sorted(frozen['beforeHashes'].items()):
            if '/models--Qdrant--bge-small-en-v1.5-onnx-Q/snapshots/aa8f8b060edb00e03bfdd08813a2949946c8ba55/' in model_path:
                actual = Path(model_path).resolve(strict=True); model_bytes = actual.read_bytes()
                if core._hash(model_bytes) != expected_hash: raise ValueError('Historical embedding bytes changed')
                self.add_runtime(str(actual), model_bytes, 'model', 'embedding-model')
        self.originals = {c['chunkId']: c for c in core._parse(self.artifacts[core.CORPUS + '/chunks.json'])}
        self.sources = {s['sourceId']: core._parse(self.artifacts[core.CORPUS + '/sources/' + s['sourceId'] + '.json']) for s in manifest['sources']}

    def put(self, path, obj, category='input'):
        data = obj if isinstance(obj, bytes) else raw(obj)
        artifact = ref(path, data); self.artifacts[path] = data
        self.root['artifacts'][:] = [s for s in self.root['artifacts'] if s['artifact']['path'] != path]
        self.root['artifacts'].append({'slot': 'slot-' + str(len(self.root['artifacts'])), 'artifact': artifact,
            'category': 'custodian-observation' if '/custodian/' in path else category})
        return artifact

    def ref(self, path):
        return ref(path, self.artifacts[path])

    def envelope(self, kind, payload):
        value = super().envelope(kind, payload)
        definitions = {'profile': 'Profile', 'structural-map': 'Map', 'query-plan': 'Plan', 'packet': 'Packet',
            'references': 'References', 'reference-review': 'ReferenceReview', 'novelty-review': 'NoveltyReview',
            'proof-ledger': 'ProofLedger', 'registration': 'Registration', 'selection': 'Selection',
            'freeze': 'Freeze', 'seal-receipt': 'SealReceipt', 'claim': 'Claim', 'unseal': 'Unseal', 'readiness': 'Readiness'}
        if hasattr(self, 'parent_schema') and kind in definitions:
            core._VALIDATOR({'$ref': '#/$defs/' + definitions[kind], '$defs': self.parent_schema['$defs']}).validate(payload)
        return value

    def add_runtime(self, path, data, category='source', role='other', dependencies=()):
        artifact = ref(path, data); self.artifacts[path] = data
        self.manifest['entries'][:] = [e for e in self.manifest['entries'] if e['artifact']['path'] != path]
        self.manifest['entries'].append({'artifact': artifact, 'category': category, 'role': role,
                                         'dependencies': list(dependencies)})
        return artifact

    def sync_runtime(self):
        """Inventory actual Python closure in dependency order, without self inputs."""
        entries = self.manifest['entries']
        entries[:] = [e for e in entries if not e['artifact']['path'].startswith('/synthetic/site-packages/') and
                      e['artifact']['path'] not in ('/synthetic/test', '/synthetic/prompt')]
        # Required producer/MCP sources and the installed bundle use their actual bytes.
        for entry in list(entries):
            path = Path(entry['artifact']['path'])
            if str(path).startswith(core.R + '/') and not str(path).endswith('.py') and path.exists():
                self.add_runtime(str(path), path.read_bytes(), entry['category'], entry['role'], entry['dependencies'])
        for directory, pattern, category in ((Path(core.R + '/tools/content-workbench/Workbench'), '*.cs', 'source'),
                (Path(core.R + '/tools/content-workbench/Workbench.Tests'), '*.*', 'test'),
                (Path(core.R + '/tools/mcp-server/src'), '*.ts', 'source'),
                (Path(core.R + '/tools/mcp-server/dist'), '*.*', 'source')):
            for path in sorted(directory.rglob(pattern)):
                if path.is_file() and not any(part in ('obj', 'bin') for part in path.relative_to(directory).parts):
                    self.add_runtime(str(path), path.read_bytes(), category)
        entries[:] = [e for e in entries if not (e['artifact']['path'].startswith(core.P + '/') and
                      e['artifact']['path'].endswith('.py')) and e['artifact']['path'] != '/synthetic/consumer.py']
        source_modules = set(core.CORE_MODULES)
        author_schemas = [self.add_runtime(core.P + '/schemas/' + name,
            Path(core.P + '/schemas/' + name).read_bytes(), 'schema') for name in ('card.json', 'review.json')]
        complete, visiting = {}, []
        packages = {}
        def installed(name):
            if name in packages: return packages[name]
            specification = importlib.util.find_spec(name)
            if specification is None or not specification.origin:
                raise ValueError('Actual installed dependency missing: ' + name)
            origin = Path(specification.origin).resolve()
            locations = list(specification.submodule_search_locations or [])
            files = {origin}
            for location in locations:
                for path in Path(location).resolve().rglob('*'):
                    if path.is_file() and not any(p in ('__pycache__', 'tests', 'testing') for p in path.relative_to(location).parts) and path.suffix in ('.py', '.so', '.dylib', '.json', '.txt'):
                        files.add(path)
            roots = {str(path): self.add_runtime(str(path), path.read_bytes(), 'dependency') for path in sorted(files)}
            packages[name] = roots[str(origin)]
            return packages[name]
        def add_module(name):
            if name in complete: return complete[name]
            if name in visiting: raise ValueError('Actual source import cycle: ' + ' -> '.join(visiting + [name]))
            visiting.append(name)
            path = Path(core.P) / (name + '.py'); data = path.read_bytes(); tree = ast.parse(data)
            names = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module: names.add(node.module.split('.')[0])
                if isinstance(node, ast.Import): names |= {a.name.split('.')[0] for a in node.names}
            deps = []
            import sys
            for dep in sorted(names - sys.stdlib_module_names - {'__future__'}):
                if (Path(core.P) / (dep + '.py')).exists():
                    deps.append(add_module(dep))
                else:
                    deps.append(installed(dep))
            if name == 'author_execution': deps.extend(author_schemas)
            visiting.pop()
            complete[name] = self.add_runtime(str(path), data, dependencies=deps)
            return complete[name]
        for name in sorted(source_modules): add_module(name)
        for name, module in list(sys.modules.items()):
            filename = getattr(module, '__file__', None)
            if filename and '/site-packages/' in filename and name.split('.')[0] not in packages:
                installed(name.split('.')[0])
        for name in ('SEMANTIC_V4_GATE_CONSUMERS.md', 'equivalence-instructions-v2.txt',
                     'semantic-v4-equivalence-output-v2.schema.json', 'semantic-v4-equivalence-schedule-v2.schema.json',
                     'semantic-v4-equivalence-input-policy-v2.json', 'private-label-instructions-v1.json'):
            path = Path(core.P) / name
            if path.exists():
                role = {'semantic-v4-equivalence-input-policy-v2.json': 'equivalence-input-policy',
                    'equivalence-instructions-v2.txt': 'equivalence-instructions',
                    'semantic-v4-equivalence-output-v2.schema.json': 'equivalence-output-schema',
                    'semantic-v4-equivalence-schedule-v2.schema.json': 'equivalence-schedule-schema'}.get(name, 'other')
                dependencies = []
                if role == 'equivalence-input-policy':
                    policy = json.loads(path.read_bytes())
                    dependencies = [self.ref(policy[field]['path']) for field in ('instructions', 'outputSchema', 'scheduleSchema')]
                self.add_runtime(str(path), path.read_bytes(), 'prompt' if role == 'equivalence-instructions' or name == 'private-label-instructions-v1.json' else
                                 'protocol' if role == 'equivalence-input-policy' else
                                 'schema' if name.endswith('.json') else 'source', role, dependencies)
        for path in sorted(Path(core.P).glob('test_*v4.py')):
            self.add_runtime(str(path), path.read_bytes(), 'test')
        # The actual public reader is the conservative all-input closure root.
        consumer = next(e for e in entries if e['artifact']['path'] == core.P + '/mcp_evidence.py')
        entries.remove(consumer)
        consumer['dependencies'] = [e['artifact'] for e in entries]
        entries.append(consumer)
        self.manifest['entrypoints'] = [consumer['artifact'], *[next(e['artifact'] for e in entries
            if e['artifact']['path'] == core.P + '/' + name + '.py')
            for name in ('semantic_gate_v4', 'author', 'batch_author')]]
        identity = self.manifest['identity']
        identity['embeddingModelHash'] = core._digest([e['artifact'] for e in entries if e['role'] == 'embedding-model'])
        for field, name in (('sourceManifestHash', 'manifest'), ('chunksHash', 'chunks'), ('indexHash', 'index')):
            identity[field] = core._hash(self.artifacts[core.CORPUS + '/' + name + '.json'])
        for category, field in (('test', 'testsHash'), ('prompt', 'promptsHash'), ('schema', 'schemaHash'),
                                ('algorithm', 'algorithmHash'), ('model', 'modelIdentityHash')):
            identity[field] = core._digest([e['artifact'] for e in entries if e['category'] == category])
        identity['implementationManifestHash'] = core._digest(entries)
        for entry in entries:
            path = entry['artifact']['path']
            if not path.startswith(core.CORPUS + '/') and not any(s['artifact']['path'] == path for s in self.root['artifacts']):
                self.put(path, self.artifacts[path])
        self.root['runtimeManifest'] = self.put(core.T + '/runtime-manifest.json', self.manifest)
        return self.root['runtimeManifest']

    def install_reviews(self):
        contract = core._parse(self.artifacts[core.P + '/semantic-v4-adoption-contract.json'])
        contract_inputs = [self.root['runtimeManifest'], *contract['x-contract']['parentContracts'],
            self.ref(core.P + '/semantic-v4-adoption-contract.json'), self.ref(core.P + '/SEMANTIC_V4_ADOPTION.md')]
        contract_inputs += [entry['artifact'] for entry in self.manifest['entries'] if entry['role'] in
            ('equivalence-input-policy', 'equivalence-instructions', 'equivalence-output-schema', 'equivalence-schedule-schema')]
        for node in ('contract-review', 'reference-equivalence', 'adoption-implementation-review', 'current-source-review'):
            inputs = contract_inputs if node == 'contract-review' else [self.root['runtimeManifest']] if node == 'reference-equivalence' else None
            _install_review(self, node, inputs=inputs)
        denial = self.denial()
        next(b for b in self.root['authorities'] if b['node'] == 'isolation-denial').update(
            state='PASS', acceptedReview=None, observation=ref(core.T + '/custodian/0.json', self.artifacts[core.T + '/custodian/0.json']),
            boundInputs=[self.root['runtimeManifest'], denial['actionRecord'], self.access])

    def auth(self, permission, inputs=()):
        prerequisites = [b for b in self.root['authorities'] if b['node'] in core.PERMISSION_PREREQUISITES[permission]]
        paths = {self.root['runtimeManifest']['path'], self.protocol['path'], *[r['path'] for r in inputs]}
        for b in prerequisites:
            paths |= {r['path'] for r in b['boundInputs']}
            paths |= {r['path'] for r in (b['acceptedReview'], b['observation']) if r}
        if permission == 'ADOPT_INPUTS_ONLY': paths |= {core.D + '/reference-mapping.json', core.D + '/packet-inventory.json'}
        elif permission == 'DEV_EQUIVALENCE_EXECUTION':
            paths |= {core.D + '/candidate-mapping.json', core.D + '/references.json', core.D + '/reviews/schedule.json'}
            paths |= {p for p in self.artifacts if p.startswith(core.D + '/reviews/projections/')}
        elif permission == 'DEV_PROOF_EXECUTION':
            paths |= {core.D + '/reference-mapping.json', core.D + '/packet-inventory.json', core.D + '/references.json'}
        elif permission == 'INTEGRATION_CANARY': paths.add(core.E + '/canary-plan.json')
        else:
            paths.add(core.E + '/freeze.json')
            if permission == 'HOLDOUT_EXECUTION': paths |= {core.E + '/' + p + '.json' for p in ('seal-receipt', 'claim', 'unseal')}
            if permission == 'HOLDOUT_EXECUTION':
                paths |= {core.E + '/holdout/references.json'}
                paths |= {core.E + '/holdout/packets/' + f'v4-{theme}-{suffix}.json'
                          for theme in ('cloud', 'identity', 'compute', 'storage', 'databases', 'networking', 'messaging', 'operations')
                          for suffix in ('p1', 'p2', 'p3', 'p4', 'n1')}
        if permission in ('DEV_EQUIVALENCE_EXECUTION', 'DEV_PROOF_EXECUTION', 'INTEGRATION_CANARY'):
            paths |= {e['artifact']['path'] for e in self.manifest['entries'] if e['category'] in ('prompt', 'schema')}
        if permission in ('ADOPT_INPUTS_ONLY', 'DEV_PROOF_EXECUTION'):
            inv = core._parse(self.artifacts[core.D + '/packet-inventory.json'])
            paths |= {r[key]['path'] for r in inv['rows'] for key in ('originalPacket', 'packetAdoption')}
            paths |= {inv['proofConsumer'][key]['path'] for key in ('dependencyManifest', 'adoptionContract', 'adoptionDocument')}
        observed = '2026-10-29T01:00:02.5000000Z' if permission == 'LABEL_EXECUTION' else '2026-10-29T01:00:07Z' if permission == 'HOLDOUT_EXECUTION' else '2026-10-29T00:01:00Z'
        if permission == 'LABEL_EXECUTION':
            paths |= {r['path'] for r in custody._validate_label_authorization_prefix_v4(self.root, self.manifest, self.artifacts, observed)}
        value = {**common('trusted-v4-authorization'), 'permission': permission, 'supervisorTask': self.root['supervisorTask'],
            'observedUtc': observed, 'runtimeManifest': self.root['runtimeManifest'], 'identity': self.manifest['identity'],
            'boundInputs': [ref(p, self.artifacts[p]) for p in sorted(paths)], 'prerequisites': copy.deepcopy(prerequisites)}
        if permission == 'HOLDOUT_EXECUTION': value['contextVersion'] = 'holdout-scope-inputs-v2'
        return self.put(core.T + '/authorizations/' + permission + '.json', value)

    def raw_entry(self, purpose, role, batch, scope, prompt, schema, result,
                  started='2026-10-29T00:10:00Z', observed='2026-10-29T00:11:00Z', authorization=None):
        self._raw_counter += 1
        entry = {'purpose': purpose, 'role': role, 'batchOrdinal': batch, 'scope': scope}
        directory = custody._output(custody._core(), entry)
        files, call, workspace = self.raw_files(directory, prompt, schema, result, started)
        if purpose == 'dev-equivalence':
            invocation = core._parse(files['invocation.json'])
            invocation.update(purpose=purpose, inputPolicyVersion='dev-equivalence-input-v2')
            files['invocation.json'] = raw(invocation)
        file_refs = {name: self.put(directory + '/' + name, data, 'raw-execution') for name, data in files.items()}
        schema_ref = file_refs['schema.json']; prompt_ref = self.put(directory + '/prompt.txt', prompt.encode())
        permission = custody.PERMISSIONS[purpose]
        auth = authorization or ref(core.T + '/authorizations/' + permission + '.json',
                                   self.artifacts[core.T + '/authorizations/' + permission + '.json'])
        entry.update({'runtimeManifest': self.root['runtimeManifest'],
            'supervisorTask': self.root['supervisorTask'], 'observedTask': 'synthetic-worker-' + str(self._raw_counter),
            'observedRunId': 'synthetic-run',
            'authorization': auth, 'observedUtc': observed, 'outputDirectory': directory,
            'workspaceId': workspace, 'callId': call, 'emittedSchema': schema_ref,
            'trustedPins': {'controlRoot': core.C, 'expectedFileHashes': {n: core._hash(d) for n, d in files.items()},
                            'runtime': self.manifest['runtime']},
            **{field: file_refs[name] for field, name in custody.SIX.items()}})
        entry['scope'] = {**scope, 'prompt': prompt_ref, 'schema': schema_ref}
        self.registry['entries'].append(entry)
        return entry

    def raw_files(self, directory, prompt, schema, result, started):
        host = SyntheticReceiptTests(); host.setUp()
        try:
            old_workspace, old_output = host.workspace, str(host.output)
            workspace = core.C + '/model-workspaces/synthetic-' + str(self._raw_counter)
            call = 'synthetic-call-' + str(self._raw_counter)
            schema_raw = schema if isinstance(schema, bytes) else json.dumps(schema, ensure_ascii=False, indent=2).encode()
            result_raw = result if isinstance(result, bytes) else raw(result)
            def replace(value):
                if isinstance(value, str): return value.replace(old_workspace, workspace).replace(old_output, directory)
                if isinstance(value, list): return [replace(v) for v in value]
                if isinstance(value, dict): return {k: replace(v) for k, v in value.items()}
                return value
            invocation = replace(host.invocation)
            invocation.update(self.manifest['runtime'], startedUtc=started,
                cli=next(e['artifact']['path'] for e in self.manifest['entries'] if e['role'] == 'cli-executable'),
                inputHash=core._hash(prompt.encode()), schemaHash=core._hash(schema_raw))
            execution = replace(host.execution)
            events = copy.deepcopy(host.events); events[0]['thread_id'] = call; events[3]['item']['text'] = result_raw.decode()
            events_raw = b''.join(raw(e) + b'\n' for e in events)
            execution.update(inputHash=core._hash(prompt.encode()), schemaHash=core._hash(schema_raw),
                outputHash=core._hash(result_raw), outputBytes=len(result_raw), eventsHash=core._hash(events_raw))
            return {'execution.json': raw(execution), 'invocation.json': raw(invocation), 'result.json': result_raw,
                    'events.jsonl': events_raw, 'stderr.log': b'', 'schema.json': schema_raw}, call, workspace
        finally: host.doCleanups()

    def finish(self):
        self.root['executionRegistry'] = self.put(core.T + '/execution-registry.json', self.registry)
        for n, slot in enumerate(self.root['artifacts']): slot['slot'] = 'full-' + str(n)
        corpus = core._parse(self.artifacts[core.CORPUS + '/manifest.json'])
        self.run = {'nodes': {'A3V4-trusted-root': self.root, 'A2R-corpus': {'status': 'produced',
            'corpusVersion': corpus['corpusVersion'], 'sourceCount': corpus['sourceCount'], 'chunkCount': corpus['chunkCount']}}}
        if hasattr(self, 'parent_plan'):
            self.run.update(plan=self.parent_plan['path'], planSha256=self.parent_plan['sha256'])
        self.artifacts[core.C + '/run.json'] = raw(self.run)

    @contextmanager
    def public_io(self, workflow=False):
        """Redirect only fixed-path reads to actual Temp files; every validator runs."""
        self.finish()
        with tempfile.TemporaryDirectory(prefix='SYNTHETIC-full-gate-') as folder, ExitStack() as stack:
            temporary = Path(folder).resolve()
            original_read, original_files = core._read_stable, execution_io._read_files
            mapping = {}
            for logical, data in self.artifacts.items():
                target = temporary / logical.removeprefix('/')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data); mapping[logical] = target
            def read(path, limit=2_000_000, identities=None):
                logical = str(path)
                core._path(logical)
                if logical not in mapping: raise FileNotFoundError(logical)
                return original_read(str(mapping[logical]), limit, identities)
            def files(control, output):
                return original_files(temporary / str(control).removeprefix('/'), temporary / str(output).removeprefix('/'))
            stack.enter_context(patch.object(core, '_read_stable', side_effect=read))
            stack.enter_context(patch('execution_receipt_v4._read_files', side_effect=files))
            if workflow:
                def relocated(path):
                    value = str(path)
                    return temporary / value.removeprefix('/') if value == core.C or value.startswith(core.C + '/') else path
                for method in ('open', 'stat', 'mkdir', 'unlink'):
                    original = getattr(Path, method)
                    def redirect(path, *args, _original=original, **kwargs):
                        return _original(relocated(path), *args, **kwargs)
                    stack.enter_context(patch.object(Path, method, redirect))
                original_iterdir, original_glob, original_replace = Path.iterdir, Path.glob, os.replace
                original_os_open = os.open
                def guarded_open(path, flags, *args, **kwargs):
                    value = os.fspath(path)
                    if isinstance(value, str) and os.path.isabs(value) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
                        resolved = os.path.realpath(value)
                        if resolved == core.C or resolved.startswith(core.C + '/'):
                            raise AssertionError('Unmapped production control write in synthetic workflow')
                    return original_os_open(path, flags, *args, **kwargs)
                def iterdir(path):
                    actual = relocated(path)
                    for child in original_iterdir(actual):
                        yield path / child.name if actual != path else child
                def glob(path, pattern, **kwargs):
                    actual = relocated(path)
                    for child in original_glob(actual, pattern, **kwargs):
                        yield path / child.relative_to(actual) if actual != path else child
                stack.enter_context(patch.object(Path, 'iterdir', iterdir))
                stack.enter_context(patch.object(Path, 'glob', glob))
                stack.enter_context(patch.object(os, 'replace', lambda source, target, **kwargs:
                    original_replace(relocated(source), relocated(target), **kwargs)))
                stack.enter_context(patch.object(os, 'open', guarded_open))
            yield mapping
