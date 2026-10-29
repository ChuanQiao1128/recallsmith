"""Synthetic in-memory/Temp evidence only; no actual custody/model/isolation claim."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import trusted_interfaces_v4 as core
import trusted_custody_v4 as custody
from execution_receipt_v4 import _verify_execution_bytes_v4
import test_execution_receipt_v4 as receipt_fixtures
from test_execution_receipt_v4 import encoded
from test_trusted_interfaces_v4 import _parent_fixture_bytes


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def base(kind, **extra):
    return {'kind': kind, 'interfaceVersion': 'trusted-v4-1', 'cycleId': 'aws-basics-v4-1',
            'releaseAuthorized': False, **extra}


class Fixture:
    """A synthetic external supervisor boundary, never persisted to real C."""
    def __init__(self):
        self.artifacts = {}
        self.root = {'supervisorTask': 'synthetic-supervisor', 'artifacts': [], 'authorities': []}
        schema = json.loads(Path(core.SCHEMA_PATH).read_bytes())
        identity = {key: sha(key.encode()) for key in schema['$defs']['Identity']['required']}
        self.manifest = {'identity': identity, 'runtime': {'runnerAssemblyHash': 'a' * 64,
                         'processHostHash': 'b' * 64, 'cliVersion': 'synthetic-cli'},
                         'entries': [{'artifact': {'path': '/synthetic/actual/codex', 'sha256': 'a' * 64}, 'category': 'binary',
                                      'role': 'cli-executable'}]}
        self.root['runtimeManifest'] = self.put(core.T + '/runtime-manifest.json', self.manifest)
        self.root['executionRegistry'] = self.put(core.T + '/execution-registry.json', base('trusted-v4-execution-registry', entries=[]))
        parent = core.C + '/design/rag-v2-bounded/r4/'
        self.put(parent + 'contracts.schema.json', _parent_fixture_bytes()[parent + 'contracts.schema.json'])
        self.protocol = self.put(parent + 'semantic-protocol.md', b'SYNTHETIC semantic protocol')
        identity['protocolHash'] = self.protocol['sha256']
        self.root['runtimeManifest'] = self.put(core.T + '/runtime-manifest.json', self.manifest)
        self.access = self.put(parent + 'access-protocol.md', b'SYNTHETIC parent access protocol')
        self.observations = []
        self.observation_times = {}
        self.freeze = None
        self.policy = 'c' * 64
        self.run = 'synthetic-custodian-run'
        for node in ('current-source-review', 'isolation-denial', 'selection-freeze'):
            report = self.put(core.T + '/reviews/' + node + '/accepted.json', {'synthetic': node})
            self.root['authorities'].append({'node': node, 'state': 'PASS', 'acceptedReview': report,
                                            'observation': None, 'boundInputs': []})
        self.counter = 0

    def put(self, path, obj):
        raw = obj if isinstance(obj, bytes) else encoded(obj)
        ref = {'path': path, 'sha256': sha(raw)}
        self.artifacts[path] = raw
        self.root['artifacts'][:] = [x for x in self.root['artifacts'] if x['artifact']['path'] != path]
        self.root['artifacts'].append({'slot': 'synthetic-' + str(len(self.root['artifacts'])), 'artifact': ref,
                                      'category': 'custodian-observation' if '/custodian/' in path else 'input'})
        return ref

    def envelope(self, kind, payload):
        return {'schemaVersion': 4, 'cycleId': 'aws-basics-v4-1', 'retrievalVersion': 4,
                'metricVersion': 'complete-group-v1', 'kind': kind,
                'identity': self.manifest['identity'], 'payload': payload}

    def evidence(self, name):
        self.counter += 1
        return self.put(core.T + f'/synthetic-transcripts/{self.counter}.log',
                        ('SYNTHETIC observed external transcript: ' + name).encode())

    def auth(self, permission, inputs):
        observed = '2026-10-29T00:00:02.500000Z' if permission == 'LABEL_EXECUTION' else '2026-10-29T00:00:00Z'
        if permission == 'LABEL_EXECUTION':
            prefix = custody._validate_label_authorization_prefix_v4(self.root, self.manifest, self.artifacts, observed)
            inputs = list({custody.canonical(ref): ref for ref in [*inputs, *prefix]}.values())
        return self.put(core.T + '/authorizations/' + permission + '.json',
            base('trusted-v4-authorization', permission=permission, supervisorTask=self.root['supervisorTask'],
                 observedUtc=observed, runtimeManifest=self.root['runtimeManifest'],
                 identity=self.manifest['identity'], boundInputs=inputs, prerequisites=[x for x in self.root['authorities']
                    if x['node'] in custody.PERMISSION_PREREQUISITES[permission]]))

    def observe(self, detail, outcomes, inputs=()):
        seq = len(self.observations)
        shared = dict(supervisorTask=self.root['supervisorTask'], custodianRunId=self.run,
                      custodianPrincipal='synthetic-protected-principal', sequence=seq,
                      runtimeManifest=self.root['runtimeManifest'], policyHash=self.policy,
                      observedUtc=self.observation_times.get(seq, f'2026-10-29T00:00:{seq:02d}Z'))
        values = []
        for operation, target, result, *rest in outcomes:
            values.append({'operation': operation, 'target': target, 'result': result,
                           'exitCode': rest[0] if rest else 0,
                           'evidence': rest[1] if len(rest) > 1 else self.evidence(operation + '/' + target)})
        action_inputs = [self.root['runtimeManifest'], *inputs]
        if self.freeze is not None and self.freeze not in action_inputs:
            action_inputs.append(self.freeze)
        action = base('trusted-v4-external-action', event=detail['event'], source='custodian' if detail['event'] == 'UNSEALED' else 'launcher',
                      processIdentity='synthetic-process-42', inputs=action_inputs, outcomes=values, **shared)
        action_ref = self.put(core.T + f'/synthetic-actions/{seq}.json', action)
        previous = None if seq == 0 else {'path': core.T + f'/custodian/{seq-1}.json',
                                        'sha256': sha(self.artifacts[core.T + f'/custodian/{seq-1}.json'])}
        obs = base('trusted-v4-custodian-observation', previous=previous, freeze=self.freeze,
                   actionRecord=action_ref, detail=detail, **shared)
        self.put(core.T + f'/custodian/{seq}.json', obs)
        self.observations.append(obs)
        return obs

    def denial(self):
        roots = ('home', 'repository', 'control', 'private-pdf', 'private-labels', 'outside-projection')
        pairs = [(cap, target) for cap in ('absolute-read', 'relative-read', 'symlink-read', 'hardlink-read',
                 'uri-read', 'directory-list', 'write-back') for target in roots]
        pairs += [('process-inspection', 'process'), ('environment-read', 'environment'),
                  ('parent-stdin-read', 'parent-stdin'), ('child-spawn', 'child'),
                  ('mcp-call', 'mcp'), ('network', 'network'), ('public-log-leak', 'public-output')]
        plan = self.put(core.T + '/denial-plan.json', base('trusted-v4-denial-plan',
            parentAccessProtocol=self.access, launcherIdentity='synthetic-launcher', policyHash=self.policy,
            required=[{'capability': cap, 'targetClass': target} for cap, target in pairs]))
        attempts, outcomes = [], []
        for cap, target in pairs:
            evidence = self.evidence(cap + '/' + target)
            attempts.append({'capability': cap, 'targetClass': target, 'result': 'DENIED',
                             'exitCode': 13, 'launcherRecord': evidence})
            outcomes.append((cap, target, 'DENIED', 13, evidence))
        return self.observe({'event': 'DENIAL_OBSERVED', 'launcherIdentity': 'synthetic-launcher',
            'policyHash': self.policy, 'projectionHash': 'd' * 64, 'attempts': attempts,
            'toolsDisabledObserved': True, 'noPublicLeakObserved': True},
            outcomes + [('tools-disabled', 'all', 'DISABLED'), ('public-log-inspection', 'all', 'NO_LEAK')],
            [plan, self.access])

    def through_seal(self):
        self.denial()
        self.termination = self.evidence('builder terminated')
        self.inventory = self.put(core.T + '/worker-inventory.json', base('trusted-v4-worker-inventory',
            supervisorTask=self.root['supervisorTask'], workers=[{'taskId': 'builder',
                'processIdentity': 'builder-process', 'startedUtc': '2026-10-28T00:00:00Z'}]))
        selection = self.put(core.E + '/selection.json', {'synthetic': 'selection'})
        self.freeze = self.put(core.E + '/freeze.json', self.envelope('freeze',
            {'selection': selection, 'registration': self.protocol, 'reviews': [self.protocol],
             'denialReceipt': {'path': core.T + '/custodian/0.json',
                              'sha256': sha(self.artifacts[core.T + '/custodian/0.json'])},
             'builderTerminationReceipts': [self.termination], 'parentPlan': self.protocol}))
        self.observe({'event': 'FREEZE_ACCEPTED', 'freeze': self.freeze, 'selection': selection},
            [('accept-freeze', self.freeze['path'], 'ACCEPTED')],
            [selection, {'path': core.T + '/custodian/0.json', 'sha256': sha(self.artifacts[core.T + '/custodian/0.json'])}])
        self.observe({'event': 'BUILDERS_STOPPED', 'workers': [{'taskId': 'builder',
            'processIdentity': 'builder-process', 'startedUtc': '2026-10-28T00:00:00Z',
            'stoppedUtc': '2026-10-29T00:00:00Z', 'exitObserved': True, 'launcherRecord': self.termination}],
            'completeWorkerSet': ['builder'], 'restartBlockedObserved': True},
            [('terminate', 'builder', 'TERMINATED', 0, self.termination), ('prevent-restart', 'all', 'BLOCKED')],
            [self.inventory])
        auth = self.auth('LABEL_EXECUTION', [self.freeze, self.protocol])
        self.observe({'event': 'LABELS_STARTED', 'authorization': auth, 'privateStoreId': 'opaque-store'},
            [('private-store', 'opaque-store', 'CUSTODIAN_CONTROLLED'), ('labels-start', 'holdout', 'STARTED')], [auth])
        self.nonce = bytes.fromhex('7a' * 32)
        import test_semantic_proof_v4 as proof_fixture
        fixture = proof_fixture.SemanticProofDiagnosticsTests().fixture(1)
        quote = proof_fixture.SemanticProofDiagnosticsTests().quote(fixture, next(iter(fixture['originals'])))
        group = {'id': 'group-one', 'requiredFacts': [{'id': 'fact-one', 'text': 'Synthetic fact'}],
                 'mandatoryScope': [], 'optionalFacts': [], 'anchorSets': [{'id': 'anchor-one',
                 'coverage': [{'atomId': 'fact-one', 'quotes': [quote], 'reason': 'Synthetic only'}]}]}
        themes = ('cloud', 'identity', 'compute', 'storage', 'databases', 'networking', 'messaging', 'operations')
        rows = [{'id': f'{theme}-synthetic-{n}', 'module': theme, 'queryEn': f'Synthetic {theme} query {n}?',
                 'answerable': n < 4, 'groups': [group] if n < 4 else [],
                 'negativeReason': None if n < 4 else 'Synthetic negative',
                 'principalFactDeploymentTuples': [{'fact': 'fixture', 'deployment': 'fixture'}]}
                for theme in themes for n in range(5)]
        self.labels_raw = encoded(self.envelope('references', {'split': 'holdout', 'queries': rows, 'old80': self.protocol}))
        self.private = {'schemaVersion': 4, 'cycleId': 'aws-basics-v4-1', 'privateStorePath': '/never/open/private',
            'nonceHex': self.nonce.hex(), 'labels': {'path': '/never/open/labels.json', 'sha256': sha(self.labels_raw)},
            **{k: {'path': '/never/open/' + k + '.json', 'sha256': sha(encoded({'synthetic': k}))}
               for k in ('author', 'checker', 'novelty')}, 'freeze': self.freeze,
            'protocolHash': self.manifest['identity']['protocolHash'],
            'sourceManifestHash': self.manifest['identity']['sourceManifestHash'],
            'denialReceipt': {'path': core.T + '/custodian/0.json',
                             'sha256': sha(self.artifacts[core.T + '/custodian/0.json'])}, 'lastEventHash': 'f' * 64}
        self.private_raw = encoded(self.private)
        self.seal = self.put(core.E + '/seal-receipt.json', self.envelope('seal-receipt',
            {'commitment': sha(self.nonce + self.labels_raw), 'total': 40, 'positive': 32, 'negative': 8,
             'themes': 8, 'positivePerTheme': 4, 'negativePerTheme': 1,
             'protocolHash': self.private['protocolHash'], 'sourceManifestHash': self.private['sourceManifestHash'],
             'denialReceipt': self.private['denialReceipt'], 'privateReviewCommitment': sha(self.nonce +
                custody.canonical({k: self.private[k] for k in ('author', 'checker', 'novelty')}).encode()), 'verdict': 'PASS'}))
        self.observe({'event': 'SEALED', 'sealReceipt': self.seal, 'commitment': sha(self.nonce + self.labels_raw),
            'privateStoreId': 'opaque-store', 'privateManifestCommitment': sha(self.nonce + self.private_raw),
            'privateChecksVerified': True, 'quotaVerified': True, 'nonceBits': 256},
            [('private-checks', 'all', 'ALL_PASS'), ('quota', 'holdout', 'VERIFIED'),
             ('nonce-entropy', 'holdout', 'VERIFIED')], [self.seal])

    def claim(self):
        descriptor = self.put(core.T + '/claim-descriptor.json',
            {k: v for k, v in base('trusted-v4-claim-descriptor', custodianRunId=self.run,
             freeze=self.freeze, sealReceipt=self.seal, policyHash=self.policy,
             runtimeManifest=self.root['runtimeManifest']).items() if k != 'releaseAuthorized'})
        obs = self.observe({'event': 'CLAIM_CREATED', 'claimDescriptor': descriptor, 'sealReceipt': self.seal,
            'exclusiveCreateObserved': True, 'fsyncObserved': True, 'priorClaimAbsentObserved': True},
            [('exclusive-create', descriptor['path'], 'CREATED'), ('fsync', descriptor['path'], 'DURABLE'),
             ('prior-claim', descriptor['path'], 'ABSENT')], [descriptor, self.seal])
        obs_ref = {'path': core.T + '/custodian/5.json', 'sha256': sha(self.artifacts[core.T + '/custodian/5.json'])}
        self.claim_ref = self.put(core.E + '/claim.json', self.envelope('claim', {'freeze': self.freeze,
            'sealReceipt': self.seal, 'exclusiveCreationReceipt': obs_ref, 'eventHash': obs['actionRecord']['sha256']}))

    def unseal(self):
        placeholder = self.put(core.E + '/unseal.json', {'synthetic': 'not yet assembled'})
        detail = {'event': 'UNSEALED', 'claim': self.claim_ref, 'sealReceipt': self.seal,
                  'unseal': placeholder, 'privateManifestHash': sha(self.private_raw),
                  'queriesOnlyProjectionObserved': True}
        obs = self.observe(detail, [('manifest-digest', sha(self.private_raw), 'VERIFIED'),
            ('queries-only', 'holdout', 'RELEASED'), ('continuity', self.claim_ref['path'], 'UNINTERRUPTED')],
            [self.claim_ref, self.seal])
        unseal = self.put(core.E + '/unseal.json', self.envelope('unseal', {
            'claim': self.claim_ref, 'sealReceipt': self.seal,
            'eventHash': obs['actionRecord']['sha256'], 'privateManifestHash': sha(self.private_raw)}))
        obs['detail']['unseal'] = unseal
        self.put(core.T + '/custodian/6.json', obs)
        return obs

    def released(self, test):
        obs = self.unseal()
        directory = core.E + '/holdout/seal-evidence'
        copies = {'privateManifest': self.put(directory + '/private-manifest.json', self.private_raw),
                  'labels': self.put(directory + '/labels.json', self.labels_raw),
                  **{k: self.put(directory + '/' + k + '.json', {'synthetic': k})
                     for k in ('author', 'checker', 'novelty')}}
        self.put(core.E + '/holdout/references.json', self.labels_raw)
        executions = []
        for index, (role, purpose) in enumerate((('author', 'label-author'), ('checker', 'label-check'), ('novelty', 'novelty-check'))):
            raw_fixture = receipt_fixtures.SyntheticReceiptTests(); raw_fixture.setUp()
            test.addCleanup(raw_fixture.doCleanups)
            raw_fixture.runtime = dict(self.manifest['runtime'])
            raw_fixture.invocation.update(self.manifest['runtime'])
            raw_fixture.invocation['cli'] = '/synthetic/actual/codex'
            raw_fixture.events[0]['thread_id'] = 'synthetic-private-' + role
            raw_fixture.write_fixture()
            folder = directory + '/raw/' + role + '/0'
            files = {name: self.put(folder + '/' + name, raw_fixture.raw[name]) for name in custody.SIX.values()}
            prompt = self.put(folder + '/prompt.txt', raw_fixture.prompt.encode())
            evidence = {key: self.evidence(role + '/' + key) for key in custody.CHECKS}
            outcomes = [{'operation': key, 'target': role + '/0', 'result': 'VERIFIED',
                         'exitCode': 0, 'evidence': evidence[key]} for key in custody.CHECKS]
            action = base('trusted-v4-external-action', event='PRIVATE_REPLAY', source='custodian',
                supervisorTask=self.root['supervisorTask'], custodianRunId=self.run,
                custodianPrincipal=obs['custodianPrincipal'], processIdentity='synthetic-process-42',
                sequence=7 + index, runtimeManifest=self.root['runtimeManifest'], policyHash=self.policy,
                inputs=[prompt, self.freeze, self.seal, self.claim_ref, obs['detail']['unseal'], self.root['runtimeManifest'], *files.values()],
                outcomes=outcomes, observedUtc=f'2026-10-29T00:00:{7 + index:02d}Z')
            replay = self.put(folder + '/custodian-replay.json', action)
            binding = base('trusted-v4-release-binding', role=role, batchOrdinal=0,
                originalControlRoot=str(raw_fixture.root), originalOutputDirectory=str(raw_fixture.output),
                originalWorkspaceId=raw_fixture.workspace, callId='synthetic-private-' + role,
                expectedFileHashes=raw_fixture.pins['expectedFileHashes'], runtime=raw_fixture.runtime,
                prompt=prompt, projectionHash='d' * 64, custodianReplayAction=replay, checksEvidence=evidence,
                claim=self.claim_ref, unseal=obs['detail']['unseal'], releasedFiles=files)
            self.put(folder + '/release-binding.json', binding)
            executions.append({k: v for k, v in binding.items() if k not in
                ('kind', 'interfaceVersion', 'cycleId', 'releaseAuthorized', 'checksEvidence', 'claim', 'unseal', 'releasedFiles')} |
                {'purpose': purpose, 'releasedFiles': files, 'checks': {key: True for key in custody.CHECKS}})
        released = base('trusted-v4-released-seal', **copies, nonceHex=self.nonce.hex(),
            freeze=self.freeze, sealReceipt=self.seal, claim=self.claim_ref, unseal=obs['detail']['unseal'],
            protocolHash=self.private['protocolHash'], sourceManifestHash=self.private['sourceManifestHash'],
            denialReceipt=self.private['denialReceipt'], executions=executions)
        self.put(core.E + '/holdout/released-seal.json', released)
        return released

    def verify(self):
        return custody.validate_custodian_chain_v4(self.root, self.manifest, self.observations, self.artifacts)


class CustodyTests(unittest.TestCase):
    def test_lossless_seventh_digit_custody_chronology(self):
        for second in ('0000002', '0000001', '0000000'):
            f = Fixture()
            f.observation_times = {0: '2026-10-29T00:00:00.0000001Z',
                                   1: '2026-10-29T00:00:00.' + second + '+00:00'}
            f.denial()
            f.observe({'event': 'INVALIDATED', 'reason': 'SYNTHETIC invalidation'},
                      [('invalidate', 'holdout', 'INVALID')])
            with self.subTest(second=second):
                if second == '0000002': self.assertEqual(len(f.verify()), 2)
                else:
                    with self.assertRaisesRegex(ValueError, 'chronological'): f.verify()

    def test_all_pre_unseal_legal_edges_and_pure_repeated_snapshot(self):
        f = Fixture()
        self.assertEqual(f.verify(), ())
        f.through_seal(); f.claim()
        self.assertEqual(len(f.verify()), 6)
        self.assertEqual(f.verify(), f.verify())

    def test_burn_after_durable_claim_is_terminal(self):
        f = Fixture(); f.through_seal(); f.claim()
        f.observe({'event': 'BURNED', 'reason': 'Synthetic ambiguous interruption', 'claim': f.claim_ref},
                  [('burn', f.claim_ref['path'], 'BURNED')], [f.claim_ref, f.seal])
        self.assertEqual(len(f.verify()), 7)
        f.observe({'event': 'INVALIDATED', 'reason': 'Synthetic restart'}, [('invalidate', 'holdout', 'INVALID')])
        with self.assertRaises(ValueError): f.verify()

    def test_invalidated_is_legal_pre_freeze_and_terminal(self):
        f = Fixture()
        f.observe({'event': 'INVALIDATED', 'reason': 'Synthetic unavailable custodian'},
                  [('invalidate', 'holdout', 'INVALID')])
        self.assertEqual(len(f.verify()), 1)

    def test_every_reordered_or_missing_edge_rejects(self):
        f = Fixture(); f.through_seal(); f.claim()
        original = copy.deepcopy(f.observations)
        for index in range(len(original)):
            with self.subTest(index=index):
                f.observations = original[:index] + original[index + 1:]
                with self.assertRaises(ValueError): f.verify()
        f.observations = list(reversed(original))
        with self.assertRaises(ValueError): f.verify()

    def test_mutated_observation_identity_freeze_or_sequence_rejects(self):
        f = Fixture(); f.through_seal(); f.claim()
        for key, value in [('sequence', True), ('custodianRunId', 'other'), ('policyHash', 'e' * 64),
                           ('freeze', f.protocol), ('previous', None)]:
            original = copy.deepcopy(f.observations[3]); changed = copy.deepcopy(original); changed[key] = value
            f.observations[3] = changed; f.put(core.T + '/custodian/3.json', changed)
            with self.subTest(key=key), self.assertRaises(ValueError): f.verify()
            f.observations[3] = original; f.put(core.T + '/custodian/3.json', original)

    def test_hash_boolean_or_missing_action_never_proves_observation(self):
        f = Fixture(); f.denial()
        path = f.observations[0]['actionRecord']['path']
        for raw in (b'true', encoded({'integrityVerified': True}), b'', encoded({'result': 'DENIED'})):
            f.artifacts[path] = raw
            with self.assertRaises(ValueError): f.verify()

    def test_incomplete_denial_plan_and_attempts_reject(self):
        f = Fixture(); f.denial()
        for field in ('attempts',):
            f.observations[0]['detail'][field].pop()
            f.put(core.T + '/custodian/0.json', f.observations[0])
            with self.assertRaises(ValueError): f.verify()

    def test_incomplete_worker_set_and_restart_reject(self):
        f = Fixture(); f.through_seal()
        f.observations[2]['detail']['completeWorkerSet'] = ['invented-worker']
        f.put(core.T + '/custodian/2.json', f.observations[2])
        with self.assertRaises(ValueError): f.verify()

    def test_private_copy_admission_before_unseal_rejects(self):
        f = Fixture(); f.through_seal()
        f.put(core.E + '/holdout/seal-evidence/labels.json', b'SYNTHETIC private bytes')
        with self.assertRaisesRegex(ValueError, 'before witnessed'): f.verify()

    def test_claim_action_must_not_hash_future_claim(self):
        f = Fixture(); f.through_seal(); f.claim()
        action_ref = f.observations[-1]['actionRecord']; action = json.loads(f.artifacts[action_ref['path']])
        action['inputs'].append(f.claim_ref)
        new_ref = f.put(action_ref['path'], action)
        f.observations[-1]['actionRecord'] = new_ref
        f.put(core.T + '/custodian/5.json', f.observations[-1])
        with self.assertRaisesRegex(ValueError, 'downstream'): f.verify()


class ExactActionRepairTests(unittest.TestCase):
    def test_every_lifecycle_action_rejects_extra_missing_duplicate_and_contradictory_effects(self):
        main = Fixture(); main.through_seal(); main.claim(); main.unseal()
        burned = Fixture(); burned.through_seal(); burned.claim()
        burned.observe({'event': 'BURNED', 'reason': 'Synthetic interrupted claim', 'claim': burned.claim_ref},
                       [('burn', burned.claim_ref['path'], 'BURNED')], [burned.claim_ref, burned.seal])
        invalid = Fixture(); invalid.observe({'event': 'INVALIDATED', 'reason': 'Synthetic invalidation'},
                                             [('invalidate', 'holdout', 'INVALID')])
        events = [(main, obs) for obs in main.observations] + [(burned, burned.observations[-1]),
                                                              (invalid, invalid.observations[-1])]
        for original, observation in events:
            for mutation in ('extra', 'missing', 'duplicate', 'result', 'exit', 'target'):
                with self.subTest(event=observation['detail']['event'], mutation=mutation):
                    f = copy.deepcopy(original); obs = copy.deepcopy(observation)
                    custody._action(f.root, obs, f.artifacts)
                    action = json.loads(f.artifacts[obs['actionRecord']['path']])
                    if mutation == 'extra':
                        action['outcomes'].append({'operation': 'network', 'target': 'unexpected-destination',
                            'result': 'ALLOWED', 'exitCode': 0, 'evidence': f.evidence('unexpected successful effect')})
                    elif mutation == 'missing': action['outcomes'].pop()
                    elif mutation == 'duplicate':
                        row = {**action['outcomes'][0], 'result': 'ALLOWED', 'evidence': f.evidence('contradiction')}
                        action['outcomes'].append(row)
                    elif mutation == 'result': action['outcomes'][0]['result'] = 'ALLOWED'
                    elif mutation == 'exit': action['outcomes'][0]['exitCode'] += 1
                    else: action['outcomes'][0]['target'] = 'unexpected-destination'
                    obs['actionRecord'] = f.put(obs['actionRecord']['path'], action)
                    f.put(core.T + f"/custodian/{obs['sequence']}.json", obs)
                    with self.assertRaises(ValueError): custody._action(f.root, obs, f.artifacts)

    def test_review_denial_counterexample_is_rejected_after_consistent_repin(self):
        f = Fixture(); f.denial(); self.assertEqual(len(f.verify()), 1)
        obs = f.observations[0]
        action = json.loads(f.artifacts[obs['actionRecord']['path']])
        action['outcomes'].append({'operation': 'network', 'target': 'unexpected-destination',
            'result': 'ALLOWED', 'exitCode': 0, 'evidence': f.evidence('unexpected actual network allowed')})
        obs['actionRecord'] = f.put(obs['actionRecord']['path'], action)
        f.put(core.T + '/custodian/0.json', obs)
        with self.assertRaisesRegex(ValueError, 'Unexpected or missing external action effect'): f.verify()

    def test_lossless_seventh_digit_label_permission_prefix(self):
        f = Fixture(); f.through_seal()
        self.assertTrue(custody._validate_label_authorization_prefix_v4(
            f.root, f.manifest, f.artifacts, '2026-10-29T00:00:02.0000001+00:00'))
        with self.assertRaisesRegex(ValueError, 'must predate label permission'):
            custody._validate_label_authorization_prefix_v4(
                f.root, f.manifest, f.artifacts, '2026-10-29T00:00:02.0000000Z')

    def test_label_permission_requires_completed_prior_stop_prefix_without_recursion(self):
        f = Fixture(); f.through_seal()
        refs = custody._validate_label_authorization_prefix_v4(f.root, f.manifest, f.artifacts,
                                                              '2026-10-29T00:00:02.500000Z')
        paths = {ref['path'] for ref in refs}
        self.assertIn(core.T + '/worker-inventory.json', paths)
        self.assertIn(core.T + '/custodian/2.json', paths)
        self.assertIn(f.termination['path'], paths)
        self.assertNotIn(core.T + '/authorizations/LABEL_EXECUTION.json', paths)
        self.assertNotIn(core.T + '/custodian/3.json', paths)
        for timestamp in ('2026-10-29T00:00:01Z', '2026-10-29T00:00:02Z', 'not-a-timestamp',
                          '2026-10-29T00:00:03+01:00'):
            with self.subTest(timestamp=timestamp), self.assertRaises(ValueError):
                custody._validate_label_authorization_prefix_v4(f.root, f.manifest, f.artifacts, timestamp)
        auth_ref = f.observations[3]['detail']['authorization']
        auth = json.loads(f.artifacts[auth_ref['path']]); auth['boundInputs'] = [f.freeze, f.protocol]
        new_ref = f.put(auth_ref['path'], auth)
        obs = f.observations[3]; obs['detail']['authorization'] = new_ref
        action = json.loads(f.artifacts[obs['actionRecord']['path']]); action['inputs'] = [
            new_ref if item == auth_ref else item for item in action['inputs']]
        obs['actionRecord'] = f.put(obs['actionRecord']['path'], action)
        f.put(core.T + '/custodian/3.json', obs)
        with self.assertRaisesRegex(ValueError, 'omits completed builder-stop'): f.verify()



class ReleasedCustodyTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(); self.f.through_seal(); self.f.claim()

    def test_positive_full_chain_and_private_original_paths_never_opened(self):
        f = self.f; f.released(self)
        # Loading the already pinned schema is permitted; original private paths
        # are nonexistent or Temp paths, and the byte validator never opens them.
        self.assertEqual(len(f.verify()), 7)
        with patch('execution_receipt_v4._read_files', side_effect=AssertionError('private dereference')):
            self.assertEqual(len(f.verify()), 7)

    def test_unseal_chain_can_validate_before_reading_any_released_bytes(self):
        f = self.f; f.released(self)
        public = {k: v for k, v in f.artifacts.items() if '/holdout/seal-evidence/' not in k and
                  not k.endswith('/holdout/released-seal.json') and not k.endswith('/holdout/references.json')}
        self.assertEqual(len(custody._validate_custodian_observations_v4(f.root, f.manifest, f.observations, public)), 7)

    def test_changed_nonce_or_copied_label_bytes_reject(self):
        f = self.f; release = f.released(self)
        release['nonceHex'] = '8b' * 32
        f.put(core.E + '/holdout/released-seal.json', release)
        with self.assertRaises(ValueError): f.verify()

    def test_missing_raw_evidence_and_raw_result_substitution_reject(self):
        f = self.f; release = f.released(self)
        raw_path = release['executions'][0]['releasedFiles']['events.jsonl']['path']
        del f.artifacts[raw_path]
        with self.assertRaises(ValueError): f.verify()

    def test_release_binding_original_paths_cannot_be_copied_from_receipt(self):
        f = self.f; release = f.released(self)
        release['executions'][0]['originalControlRoot'] = '/receipt/chosen'
        f.put(core.E + '/holdout/released-seal.json', release)
        with self.assertRaisesRegex(ValueError, 'Supervisor original release binding'): f.verify()

    def test_repeated_unseal_event_rejects(self):
        f = self.f; f.released(self)
        f.observe(copy.deepcopy(f.observations[-1]['detail']), [('queries-only', 'holdout', 'RELEASED')],
                  [f.claim_ref, f.seal])
        with self.assertRaises(ValueError): f.verify()


class ReleasedActionRepairTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(); self.f.through_seal(); self.f.claim()
        self.release = self.f.released(self)

    def repin(self, mutation, index=0):
        f, release = self.f, self.release
        execution = release['executions'][index]
        folder = core.E + '/holdout/seal-evidence/raw/' + execution['role'] + '/0'
        binding = json.loads(f.artifacts[folder + '/release-binding.json'])
        action = json.loads(f.artifacts[execution['custodianReplayAction']['path']])
        mutation(action)
        ref = f.put(execution['custodianReplayAction']['path'], action)
        binding['custodianReplayAction'] = execution['custodianReplayAction'] = ref
        f.put(folder + '/release-binding.json', binding)
        f.put(core.E + '/holdout/released-seal.json', release)

    def test_lossless_seventh_digit_replay_order(self):
        self.repin(lambda action: action.update(observedUtc='2026-10-29T00:00:07.0000000Z'))
        self.repin(lambda action: action.update(observedUtc='2026-10-29T00:00:07.0000001+00:00'), index=1)
        self.assertEqual(len(self.f.verify()), 7)
        self.repin(lambda action: action.update(observedUtc='2026-10-29T00:00:07.0000000+00:00'), index=1)
        with self.assertRaisesRegex(ValueError, 'strictly increasing observed order'): self.f.verify()

    def test_valid_ordered_suffix_and_no_original_private_path_reads(self):
        with patch('execution_receipt_v4._read_files', side_effect=AssertionError('private path read')):
            self.assertEqual(len(self.f.verify()), 7)

    def test_review_process_and_order_counterexample_rejects_with_rehashed_refs(self):
        self.repin(lambda action: action.update(processIdentity='unknown', sequence=0,
                                               observedUtc='2026-10-28T00:00:00Z'))
        with self.assertRaises(ValueError): self.f.verify()

    def test_every_private_replay_effect_is_exact(self):
        self.repin(lambda action: action['outcomes'].append({'operation': 'network',
            'target': 'unexpected-destination', 'result': 'ALLOWED', 'exitCode': 0,
            'evidence': self.f.evidence('unexpected replay side effect')}))
        with self.assertRaisesRegex(ValueError, 'Unexpected or missing external action effect'): self.f.verify()

    def test_private_replay_rejects_each_missing_duplicate_or_contradictory_effect(self):
        baseline_f, baseline_release = copy.deepcopy(self.f), copy.deepcopy(self.release)
        def change(action, mutation):
            if mutation == 'missing': action['outcomes'].pop()
            elif mutation == 'duplicate': action['outcomes'].append({**action['outcomes'][0],
                'result': 'ALLOWED', 'evidence': self.f.evidence('contradictory replay effect')})
            elif mutation == 'result': action['outcomes'][0]['result'] = 'ALLOWED'
            elif mutation == 'exit': action['outcomes'][0]['exitCode'] = 1
            else: action['outcomes'][0]['target'] = 'checker/0'
        for mutation in ('missing', 'duplicate', 'result', 'exit', 'target'):
            self.f, self.release = copy.deepcopy(baseline_f), copy.deepcopy(baseline_release)
            with self.subTest(mutation=mutation):
                self.repin(lambda action: change(action, mutation))
                with self.assertRaises(ValueError): self.f.verify()

    def test_claim_unseal_runtime_and_process_order_are_independently_bound(self):
        baseline_f, baseline_release = copy.deepcopy(self.f), copy.deepcopy(self.release)
        mutations = [('process', lambda a: a.update(processIdentity='different-real-process')),
            ('source', lambda a: a.update(source='launcher')),
            ('sequence', lambda a: a.update(sequence=6)),
            ('time', lambda a: a.update(observedUtc='2026-10-29T00:00:06Z')),
            ('nonutc', lambda a: a.update(observedUtc='2026-10-29T00:00:07+01:00')),
            ('unknown-input', lambda a: a['inputs'].append(self.f.evidence('extra replay input'))),
            ('missing-claim', lambda a: a.update(inputs=[x for x in a['inputs'] if x != self.f.claim_ref])),
            ('missing-unseal', lambda a: a.update(inputs=[x for x in a['inputs'] if x != self.release['unseal']]))]
        for label, mutation in mutations:
            self.f, self.release = copy.deepcopy(baseline_f), copy.deepcopy(baseline_release)
            with self.subTest(label=label):
                self.repin(mutation)
                with self.assertRaises(ValueError): self.f.verify()
        self.f, self.release = copy.deepcopy(baseline_f), copy.deepcopy(baseline_release)
        self.repin(lambda a: a.update(observedUtc='2026-10-29T00:00:07Z'), index=1)
        with self.assertRaisesRegex(ValueError, 'strictly increasing'): self.f.verify()

    def test_release_binding_claim_unseal_copies_and_array_order_reject(self):
        f = self.f
        path = core.E + '/holdout/seal-evidence/raw/author/0/release-binding.json'
        binding = json.loads(f.artifacts[path]); binding['claim'] = self.release['sealReceipt']
        f.put(path, binding)
        with self.assertRaisesRegex(ValueError, 'claim/unseal'): f.verify()
        binding['claim'] = self.release['claim']; f.put(path, binding)
        self.release['executions'].reverse(); f.put(core.E + '/holdout/released-seal.json', self.release)
        with self.assertRaisesRegex(ValueError, 'canonical role/batch'): f.verify()



class RegistryTests(unittest.TestCase):
    def setUp(self):
        from test_trusted_interfaces_v4 import fixture
        self.f = f = Fixture()
        f.root, f.manifest, _, f.artifacts = fixture()
        f.protocol = next(x['artifact'] for x in f.root['artifacts'] if
                          x['artifact']['path'].endswith('/semantic-protocol.md'))
        for binding in f.root['authorities']:
            evidence = f.evidence(binding['node'])
            binding.update(state='PASS', acceptedReview=evidence, observation=None)
        self.originals, self.sources = custody._corpus_maps(f.manifest, f.artifacts)
        self.evidence = list(self.originals.values())
        self.group = {'id': 'group-one', 'requiredFacts': [{'id': 'fact-one', 'text': 'Synthetic fact'}],
                      'mandatoryScope': []}
        self.case = {'id': 'case-one', 'module': 'cloud', 'queryEn': 'Synthetic question?',
                     'answerable': True, 'groups': [self.group], 'negativeReason': None}
        self.reference = f.put(core.D + '/references.json', {'queries': [self.case]})
        self.packet = f.put(core.E + '/dev/A/packets/case-one.json',
                            {'query': self.case['queryEn'], 'evidence': self.evidence})
        self.proof_schema = Path(__file__).with_name('semantic-v4-proof-output.schema.json').read_bytes()
        fixed_schema = f.put(core.R + '/tools/content-pipeline/semantic-v4-proof-output.schema.json', self.proof_schema)
        designated = [entry for entry in f.manifest['entries'] if entry['role'] == 'proof-output-schema']
        if not designated:
            f.manifest['entries'].append({'artifact': fixed_schema, 'category': 'schema',
                'role': 'proof-output-schema', 'dependencies': []})
        else:
            self.assertEqual(designated[0]['artifact'], fixed_schema)
        self.registry = base('trusted-v4-execution-registry', entries=[])
        self.make_proof('A', 'case-one', 'group-one')

    def make_proof(self, config, case_id, group_id):
        from proof_transport_v4 import compact_schedule
        f = self.f
        plan = compact_schedule(case_id, self.case['queryEn'], self.group, self.evidence, self.originals)
        for role in ('one', 'two'):
            planned = next(x for x in plan['calls'] if x['checkerId'] == role)
            output = f'{core.D}/{config}/raw/{case_id}/{group_id}/{role}/0'
            entry = self.raw_entry(output, planned['prompt'], role, planned['projectionHash'],
                                   schema=self.proof_schema, result=self.proof_output(planned))
            entry.update(purpose='dev-proof', scope={'configuration': config, 'caseIds': [case_id],
                'groupId': group_id, 'packets': [self.packet], 'reference': self.reference,
                'protocol': f.protocol, 'projectionHash': planned['projectionHash'],
                'prompt': entry.pop('promptRef'), 'schema': entry['emittedSchema']})
            entry['authorization'] = f.auth('DEV_PROOF_EXECUTION', [self.packet, self.reference, f.protocol])
            self.registry['entries'].append(entry)

    def proof_output(self, call):
        bit = {cid: 1 << index for index, cid in enumerate(call['chunkIds'])}
        return {'quotes': [], 'subsets': [{'mask': sum(bit[cid] for cid in member),
            'verdict': 'UNKNOWN', 'coverage': [], 'deploymentConsistent': 'UNKNOWN',
            'reason': 'Synthetic unverified'} for member in call['expectedSubsets']]}

    def raw_entry(self, output, prompt, role, projection, *, schema=None, result=None, ordinal=0):
        from execution_receipt_v4 import _config
        f = self.f
        synthetic = receipt_fixtures.SyntheticReceiptTests(); synthetic.setUp()
        self.addCleanup(synthetic.doCleanups)
        synthetic.prompt = prompt
        if schema is not None:
            synthetic.schema = schema
            synthetic.execution['schemaHash'] = synthetic.invocation['schemaHash'] = sha(schema)
        if result is not None:
            synthetic.result = encoded(result)
            synthetic.execution.update(outputHash=sha(synthetic.result), outputBytes=len(synthetic.result))
            synthetic.events[3]['item']['text'] = synthetic.result.decode()
        synthetic.runtime = dict(f.manifest['runtime'])
        synthetic.invocation.update(synthetic.runtime)
        synthetic.invocation['cli'] = '/synthetic/cli-executable'
        synthetic.invocation['startedUtc'] = '2026-10-29T00:01:01Z'
        synthetic.output = Path(output)  # Strings only; write_fixture below is never called.
        workspace = core.C + '/model-workspaces/synthetic-' + str(len(f.artifacts)) + '-' + role
        synthetic.invocation['args'][10] = workspace
        synthetic.invocation['args'][14] = output + '/schema.json'
        synthetic.invocation['args'][16] = output + '/result.pipe'
        config = _config(workspace)
        synthetic.invocation['config'] = config
        synthetic.invocation['args'][18:] = [value for k, v in config.items() for value in ('-c', k + '=' + v)]
        synthetic.execution['attemptDirectory'] = output
        synthetic.execution['inputHash'] = synthetic.invocation['inputHash'] = sha(prompt.encode())
        synthetic.events[0]['thread_id'] = 'synthetic-' + role + '-' + str(len(f.artifacts))
        events = b''.join(encoded(x) + b'\n' for x in synthetic.events)
        synthetic.execution['eventsHash'] = sha(events)
        raw = {'execution.json': encoded(synthetic.execution), 'invocation.json': encoded(synthetic.invocation),
               'events.jsonl': events, 'stderr.log': b'', 'schema.json': synthetic.schema, 'result.json': synthetic.result}
        refs = {field: f.put(output + '/' + name, raw[name]) for field, name in custody.SIX.items()}
        f.manifest['entries'].append({'artifact': f.put('/synthetic/frozen-schema-' + str(len(f.artifacts)) + '.json', raw['schema.json']),
            'category': 'schema', 'role': 'other', 'dependencies': []})
        return {'role': role, 'batchOrdinal': ordinal, 'outputDirectory': output,
            'trustedPins': {'controlRoot': core.C, 'runtime': f.manifest['runtime'],
                            'expectedFileHashes': {k: sha(v) for k, v in raw.items()}},
            'runtimeManifest': f.root['runtimeManifest'], 'supervisorTask': f.root['supervisorTask'],
            'observedRunId': 'synthetic-run-' + role, 'observedTask': 'synthetic-task-' + role,
            'observedUtc': '2026-10-29T00:02:00Z', 'callId': synthetic.events[0]['thread_id'],
            'workspaceId': workspace, 'promptRef': f.put(output + '/prompt.txt', prompt.encode()), **refs}

    def verify(self):
        f = self.f
        return custody.validate_execution_registry_v4(f.root, f.manifest, self.registry, f.artifacts)

    def readiness(self, purpose):
        from semantic_readiness_v4 import _cases, _judge_cases
        from readiness import READER, JUDGE, reader_schema, judge_schema
        f = self.f
        self.registry['entries'] = []
        reference_path = core.E + ('/holdout/references.json' if purpose == 'holdout-readiness' else '/canary-plan.json')
        reference = f.put(reference_path, {'queries': [self.case]})
        packets = [{'caseId': self.case['id'], 'queryEn': self.case['queryEn'], 'evidence': self.evidence}]
        cases = _cases([self.case], packets, self.originals, self.sources, reference['sha256'])
        opaque = cases[0]['id']
        answer = {'id': opaque, 'verdict': 'needs_evidence', 'answer': '', 'scope': '',
                  'supportingEvidenceIds': [], 'refusalReason': 'Synthetic refusal'}
        for role in ('reader', 'judge'):
            projection = cases if role == 'reader' else _judge_cases([self.case], cases, {opaque: answer})
            body = {'cases': projection}
            prompt = (READER if role == 'reader' else JUDGE) + custody.canonical(body)
            schema = json.dumps((reader_schema if role == 'reader' else judge_schema)([opaque]),
                                ensure_ascii=False, indent=2).encode()
            result = {'cases': [answer if role == 'reader' else {'id': opaque,
                'verdict': 'unnecessary_refusal', 'reason': 'Synthetic unsupported'}]}
            prefix = core.T + '/canary/raw' if purpose == 'integration-canary' else core.E + '/holdout/raw/readiness'
            output = prefix + '/' + role + '/0'
            entry = self.raw_entry(output, prompt, role, sha(custody.canonical(body).encode()), schema=schema, result=result)
            entry.update(purpose=purpose, scope={'configuration': 'selected', 'caseIds': [self.case['id']],
                'groupId': None, 'packets': [self.packet], 'reference': reference, 'protocol': f.protocol,
                'projectionHash': sha(custody.canonical(body).encode()), 'prompt': entry.pop('promptRef'),
                'schema': entry['emittedSchema']})
            permission = custody.PERMISSIONS[purpose]
            entry['authorization'] = f.auth(permission, [self.packet, reference, f.protocol])
            self.registry['entries'].append(entry)

    def test_both_readiness_purposes_and_roles_rebuild_exactly(self):
        for purpose in ('integration-canary', 'holdout-readiness'):
            with self.subTest(purpose=purpose):
                self.readiness(purpose)
                self.assertIs(self.verify(), self.registry)

    def test_holdout_proof_fixed_paths_and_roles_pass(self):
        f = self.f
        self.registry['entries'] = []
        self.reference = f.put(core.E + '/holdout/references.json', {'queries': [self.case]})
        from proof_transport_v4 import compact_schedule
        plan = compact_schedule(self.case['id'], self.case['queryEn'], self.group, self.evidence, self.originals)
        for role in ('one', 'two'):
            call = next(x for x in plan['calls'] if x['checkerId'] == role)
            output = f'{core.E}/holdout/raw/proof/case-one/group-one/{role}/0'
            entry = self.raw_entry(output, call['prompt'], role, call['projectionHash'],
                                   schema=self.proof_schema, result=self.proof_output(call))
            entry.update(purpose='holdout-proof', scope={'configuration': 'selected', 'caseIds': ['case-one'],
                'groupId': 'group-one', 'packets': [self.packet], 'reference': self.reference,
                'protocol': f.protocol, 'projectionHash': call['projectionHash'],
                'prompt': entry.pop('promptRef'), 'schema': entry['emittedSchema']})
            entry['authorization'] = f.auth('HOLDOUT_EXECUTION', [self.packet, self.reference, f.protocol])
            self.registry['entries'].append(entry)
        self.assertIs(self.verify(), self.registry)

    def equivalence(self):
        import dev_adoption_v4 as adoption
        from test_dev_adoption_v4 import fixture as old_fixture
        f = self.f
        self.registry['entries'] = []
        original, originals, sources = old_fixture()
        original_raw = custody.canonical(original).encode()
        with patch.object(adoption, 'ORIGINAL_REFERENCE_SHA256', sha(original_raw)):
            prepared = adoption.prepare_dev_references_v4(original_raw, originals, sources)
        original_ref = f.put(adoption.ORIGINAL_REFERENCE_PATH, original_raw)
        adapted = prepared['adaptedReferences']
        adapted['originalReferences'] = original_ref
        adapted_ref = f.put(core.D + '/references.json', adapted)
        source = next(iter(sources.values())); chunk = next(iter(originals.values()))
        corpus = {'model': 'synthetic-installed-model', 'chunking': {'fixture': 1},
                  'sources': [{'sourceId': source['sourceId'], 'sourceVersion': source['sourceVersion']}],
                  'sourceCount': 1, 'chunkCount': 1}
        corpus['corpusVersion'] = custody._digest({'sources': [(source['sourceId'], source['sourceVersion'])],
            'chunking': corpus['chunking'], 'embeddingModel': corpus['model']})
        for name, value in (('manifest', corpus), ('chunks', [chunk]), ('index', {
                'corpusVersion': corpus['corpusVersion'], 'model': corpus['model']})):
            path = core.CORPUS + '/' + name + '.json'; ref = f.put(path, custody.canonical(value).encode())
            entry = next(x for x in f.manifest['entries'] if x['artifact']['path'] == path)
            entry['artifact'] = ref
            f.manifest['identity'][{'manifest': 'sourceManifestHash', 'chunks': 'chunksHash', 'index': 'indexHash'}[name]] = ref['sha256']
        f.manifest['identity']['corpusVersion'] = corpus['corpusVersion']
        f.manifest['entries'].append({'artifact': f.put(core.CORPUS + '/sources/' + source['sourceId'] + '.json', source),
                                     'category': 'dependency', 'role': 'other', 'dependencies': []})
        contract_raw = Path(__file__).with_name('semantic-v4-adoption-contract.json').read_bytes()
        contract = json.loads(contract_raw)
        contract_ref = f.put(core.R + '/tools/content-pipeline/semantic-v4-adoption-contract.json', contract_raw)
        schema = json.dumps(contract['$defs']['EquivalenceBatchOutput'], ensure_ascii=False, indent=2).encode()
        instructions = 'SYNTHETIC equivalence instructions; no actual model call.\n'
        for role, category, path, data in (('equivalence-instructions', 'prompt', '/synthetic/equivalence.txt', instructions.encode()),
                                         ('equivalence-output-schema', 'schema', '/synthetic/equivalence-schema.json', schema)):
            f.manifest['entries'].append({'artifact': f.put(path, data), 'category': category, 'role': role, 'dependencies': []})
        current_refs = {x['artifact']['path']: x['artifact'] for x in f.manifest['entries']}
        for runtime_entry in f.manifest['entries']:
            runtime_entry['dependencies'] = [current_refs[x['path']] for x in runtime_entry['dependencies']]
        f.root['runtimeManifest'] = f.put(core.T + '/runtime-manifest.json', f.manifest)
        candidate = {'contractVersion': 'dev80-adoption-v1', 'cycleId': 'aws-basics-v4-1', 'schemaVersion': 4,
            'metricVersion': 'complete-group-v1', 'releaseAuthorized': False, 'kind': 'dev80-candidate-mapping',
            'proofConsumer': {'identity': f.manifest['identity'], 'dependencyManifest': f.root['runtimeManifest'],
                             'adoptionContract': contract_ref, 'adoptionDocument': contract_ref},
            'originalReferences': original_ref, 'adaptedReferences': adapted_ref,
            'provenance': 'POST_OBSERVATION_REPRESENTATION_ONLY', 'cases': prepared['candidateCaseMaps']}
        candidate_ref = f.put(core.D + '/candidate-mapping.json', candidate)
        batches, start, projected = [], 0, []
        while start < 80:
            n = len(batches)
            chosen = None
            for size in range(1, min(3, 80-start) + 1):
                rows = original['queries'][start:start+size]
                projection = {'kind': 'dev80-source-equivalence-projection', 'batchOrdinal': n,
                    'caseIds': [x['id'] for x in rows], 'originalCases': rows,
                    'adaptedCases': adapted['queries'][start:start+size],
                    'caseMappings': candidate['cases'][start:start+size], 'sources': [source]}
                raw = custody.canonical(projection).encode(); digest = sha(raw)
                prompt = instructions + custody.canonical({'batchOrdinal': n, 'projectionHash': digest}) + '\n' + custody.canonical(projection)
                if len(prompt) < 60000: chosen = projection, raw, digest, prompt
            if chosen is None: raise AssertionError('Synthetic one-case projection unexpectedly oversized')
            projection, raw, digest, prompt = chosen
            batches.append({'batchOrdinal': n, 'caseIds': projection['caseIds'], 'projectionHash': digest,
                            'promptScalarCount': len(prompt)})
            f.put(f'{core.D}/reviews/projections/{n}.json', raw)
            projected.append(chosen); start += len(projection['caseIds'])
        schedule = {'contractVersion': 'dev80-adoption-v1', 'cycleId': 'aws-basics-v4-1', 'schemaVersion': 4,
            'metricVersion': 'complete-group-v1', 'releaseAuthorized': False, 'kind': 'dev80-equivalence-schedule',
            'candidateMapping': candidate_ref, 'batches': batches}
        schedule_ref = f.put(core.D + '/reviews/schedule.json', schedule)
        auth = f.auth('DEV_EQUIVALENCE_EXECUTION', [candidate_ref, adapted_ref, f.protocol, schedule_ref])
        for n, (projection, _, digest, prompt) in enumerate(projected):
            result = {'kind': 'dev80-source-equivalence-batch', 'batchOrdinal': n, 'projectionHash': digest,
                'cases': [{'caseId': row['id'], 'classificationAndOptionalStatus': 'PASS',
                           'groups': [{'groupId': group['id'], **{key: 'PASS' for key in ('claim', 'necessaryScope',
                               'nestedScopeClaimAndNecessaryScope', 'anchorSets', 'representationOnly')},
                               'reason': 'Synthetic only'} for group in row['groups']],
                           'verdict': 'PASS', 'reason': 'Synthetic only'} for row in projection['adaptedCases']]}
            for role in ('equivalence-one', 'equivalence-two'):
                output = f'{core.D}/reviews/{role}/{n}/raw'
                entry = self.raw_entry(output, prompt, role, digest, schema=schema, result=result, ordinal=n)
                entry.update(purpose='dev-equivalence', authorization=auth, scope={'configuration': 'none',
                    'caseIds': projection['caseIds'], 'groupId': None, 'packets': [], 'reference': adapted_ref,
                    'protocol': f.protocol, 'projectionHash': digest, 'prompt': entry.pop('promptRef'),
                    'schema': entry['emittedSchema']})
                self.registry['entries'].append(entry)

    def test_equivalence_both_roles_cover_full_greedy_80_case_schedule(self):
        self.equivalence()
        self.assertIs(self.verify(), self.registry)
        self.registry['entries'].pop()
        with self.assertRaisesRegex(ValueError, 'Missing/extra equivalence'): self.verify()

    def test_complete_two_role_registered_proof_passes(self):
        self.assertIs(self.verify(), self.registry)

    def test_missing_extra_batches_and_wrong_raw_names_reject(self):
        original = copy.deepcopy(self.registry)
        self.registry['entries'].pop()
        with self.assertRaisesRegex(ValueError, 'Missing complete'): self.verify()
        self.registry = copy.deepcopy(original)
        self.registry['entries'][0]['result']['path'] += '.pipe'
        with self.assertRaises(ValueError): self.verify()
        self.registry = copy.deepcopy(original)
        self.registry['entries'][0]['outputDirectory'] += '/other'
        with self.assertRaises(ValueError): self.verify()

    def test_duplicate_call_workspace_and_private_public_purpose_reject(self):
        original = copy.deepcopy(self.registry)
        for key in ('callId', 'workspaceId'):
            self.registry = copy.deepcopy(original)
            self.registry['entries'][1][key] = self.registry['entries'][0][key]
            with self.subTest(key=key), self.assertRaises(ValueError): self.verify()
        self.registry = copy.deepcopy(original)
        self.registry['entries'][0]['purpose'] = 'label-author'
        with self.assertRaisesRegex(ValueError, 'Private label execution'): self.verify()

    def test_review_mismatched_proof_role_schema_rejects_despite_registered_schema(self):
        old = self.registry['entries'].pop()
        new = self.raw_entry(old['outputDirectory'], self.f.artifacts[old['scope']['prompt']['path']].decode(),
            'two', old['scope']['projectionHash'], schema=b'{"type":"object","additionalProperties":false}', result={})
        new.pop('promptRef')
        new.update(purpose=old['purpose'], scope={**old['scope'], 'schema': new['emittedSchema']}, authorization=old['authorization'])
        self.registry['entries'].append(new)
        with self.assertRaisesRegex(ValueError, 'designated purpose schema'): self.verify()

    def test_original_packet_mutation_even_repinned_reference_rejects(self):
        changed = json.loads(self.f.artifacts[self.packet['path']])
        changed['evidence'][0]['text'] += ' tampered'
        self.packet = self.f.put(self.packet['path'], changed)
        for entry in self.registry['entries']:
            entry['scope']['packets'] = [self.packet]
            entry['authorization'] = self.f.auth('DEV_PROOF_EXECUTION', [self.packet, self.reference, self.f.protocol])
        with self.assertRaises(ValueError): self.verify()


class PureRawTests(unittest.TestCase):
    def setUp(self):
        self.f = receipt_fixtures.SyntheticReceiptTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)

    def test_pure_original_byte_predicates_never_open_original_private_paths(self):
        f = self.f
        with patch('builtins.open', side_effect=AssertionError('private path read')), \
             patch('os.open', side_effect=AssertionError('private path read')):
            receipt = _verify_execution_bytes_v4(f.raw, str(f.output), frozen_prompt=f.prompt,
                       frozen_schema_bytes=f.schema, trusted_pins=f.pins)
        self.assertEqual(receipt['callId'], 'synthetic-thread-001')
        self.assertEqual(receipt['executionAuthenticity'], 'HOST_RECORDS_ONLY')
        self.assertFalse(receipt['sourceReviewVerified']); self.assertFalse(receipt['releaseAuthorized'])

    def test_relocated_raw_files_still_require_original_registered_strings(self):
        f = self.f
        with self.assertRaises(ValueError):
            _verify_execution_bytes_v4(f.raw, str(f.root / 'relocated'), frozen_prompt=f.prompt,
                frozen_schema_bytes=f.schema, trusted_pins=f.pins)


if __name__ == '__main__':
    unittest.main()
