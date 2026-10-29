"""Full public synthetic success and destructive logic tests; no real permissions."""
import copy
import json
from pathlib import Path
import unittest
import tempfile
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

import author
import batch_author
import semantic_gate_v4 as gate
import trusted_interfaces_v4 as core
from holdout_gate_replay_v4 import replay_private_labels_v4, replay_holdout_v4, replay_packet_v4
from test_holdout_gate_fixtures_v4 import full_fixture, authoring337_fixture, synthetic_author_transport
from test_dev_gate_replay_v4 import rebind
from test_dev_gate_fixtures_v4 import write_authority


class FullSemanticGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = full_fixture()

    def private(self, f):
        return replay_private_labels_v4(f.root, f.manifest, f.artifacts,
            core._parse(f.artifacts[core.E + '/holdout/released-seal.json']),
            core._parse(f.artifacts[core.C + '/evaluation/references.json']))

    def test_complete_public_gate_and_both_authoring_entry_paths(self):
        f = authoring337_fixture(copy.deepcopy(self.base))
        root, corpus = Path(core.C), Path(core.C + '/retrieval-v3')
        original_factory = gate._authoring_operation_v4
        callbacks, operations = [], []
        mutation = {'enabled': False}
        # Observe the real context; no gate, execution, quote or scoring result is stubbed.
        @contextmanager
        def observe(catalogue):
            seen = []
            with original_factory(catalogue) as validate:
                operations.append(seen); callbacks.append(validate)
                def observed(goal, wrapper):
                    result = validate(goal, wrapper); seen.append(goal['stableUid'])
                    if mutation['enabled'] and len(seen) == 337:
                        first_response.write_bytes(original_response + b' ')
                    return result
                yield observed
        with f.public_io(workflow=True) as mapping:
            first = f.catalogue['goals'][0]; last = f.catalogue['goals'][-1]
            first_response = mapping[f.goal_wrapper['retrieval']['path']]
            original_response = first_response.read_bytes()
            with patch.object(gate, '_authoring_operation_v4', observe):
                created = batch_author.checked_plan(root, corpus, f.catalogue, f.batch_config, create=True)
                self.assertEqual(337, len(created['inputs']))
                self.assertEqual(334, len(created['config']['legacyUids']))
                self.assertEqual([g['stableUid'] for g in f.catalogue['goals']], operations[-1])
                self.assertEqual(created['inputs'][first['stableUid']]['packetFileHash'],
                    f.ref(core.C + '/authoring/' + first['stableUid'] + '/v4-packet.json')['sha256'])
                with self.assertRaisesRegex(ValueError, 'operation has ended'):
                    callbacks[-1](first, f.goal_wrapper)
                batch_author.inventory(root, created)
                # An unrelated historical legacy packet cannot relabel v4 plan inputs.
                legacy = root / 'authoring' / first['stableUid'] / 'packet.json'
                legacy.write_text('{"SYNTHETIC":"unrelated legacy packet"}')
                rebuilt = batch_author.checked_plan(root, corpus, f.catalogue)
                self.assertEqual(created, rebuilt)
                self.assertEqual(2, len(operations))
                print('SYNTHETIC actual337 create/resume/inventory verified; one full gate per operation', flush=True)
                extra = root / 'authoring' / first['stableUid'] / 'generate-1'
                extra.write_text('SYNTHETIC forbidden per-card execution namespace')
                with self.assertRaisesRegex(ValueError, 'execution namespace'):
                    batch_author.inventory(root, created)
                extra.unlink()
                # Both a missing first input and a missing final input block, even with legacy data.
                for goal in (first, last):
                    wrapper_path = core.C + '/authoring/' + goal['stableUid'] + '/v4-packet.json'
                    actual = mapping[wrapper_path]; saved = actual.read_bytes(); actual.unlink()
                    try:
                        with self.assertRaises((ValueError, OSError)):
                            batch_author.checked_plan(root, corpus, f.catalogue)
                        self.assertEqual(2, len(operations))  # Constructor failed before any context could yield.
                    finally:
                        actual.write_bytes(saved)
                mutation['enabled'] = True
                plan_path = root / batch_author.PLAN; frozen_plan = plan_path.read_bytes()
                with self.assertRaisesRegex(ValueError, 'stale|changed'):
                    batch_author.checked_plan(root, corpus, f.catalogue, f.batch_config, create=True)
                self.assertEqual(337, len(operations[-1]))
                self.assertEqual(frozen_plan, plan_path.read_bytes())
                with self.assertRaisesRegex(ValueError, 'operation has ended'):
                    callbacks[-1](first, f.goal_wrapper)
                first_response.write_bytes(original_response)
                self.assertEqual(3, len(operations))
                print('SYNTHETIC missing/downgrade/late-goal/namespace/final-freshness checks verified', flush=True)
        # A separate operation exercises actual single-author persistence using only Temp transport.
        with f.public_io(workflow=True) as mapping:
            goal = f.catalogue['goals'][0]
            packet = {'goal': goal, 'curriculumHash': f.catalogue['curriculumHash'], 'query': goal['retrievalQueryEn'],
                'evidence': [f.seed], 'corpusVersion': f.manifest['identity']['corpusVersion'],
                'packetHash': f.ref(core.C + '/authoring/' + goal['stableUid'] + '/v4-packet.json')['sha256']}
            transport, calls = synthetic_author_transport(f, mapping, packet, repair=True)
            folder = root / 'authoring' / goal['stableUid']
            (folder / 'packet.json').write_text('{"SYNTHETIC":"wrong legacy identity"}')
            args = SimpleNamespace(root=root, corpus_root=corpus, dotnet=transport)
            author.one(args, goal, f.catalogue)
            receipt = json.loads((folder / 'verified.json').read_bytes())
            self.assertEqual(receipt['packetHash'], packet['packetHash'])
            self.assertNotEqual(receipt['packetHash'], core._hash((folder / 'packet.json').read_bytes()))
            events = [json.loads(row) for row in calls.read_text().splitlines()]
            self.assertEqual([r['stage'] for r in events], ['generate-1', 'review-1', 'generate-2', 'review-2'])
            self.assertTrue(all(r['synthetic'] and not r['modelCalled'] for r in events))
            self.assertEqual(receipt['generationAttempt'], 'generate-2')
            self.assertEqual(receipt['reviewAttempt'], 'review-2')
            repair_authorization = json.loads((folder / 'repair-authorization.json').read_bytes())
            self.assertEqual(repair_authorization['reviewHash'], core._hash((folder / 'review-1/result.json').read_bytes()))
            with self.assertRaisesRegex(ValueError, 'Only initial generation'):
                author.invoke(args, folder, 'generate', 3, 'SYNTHETIC forbidden third attempt', {}, review_packet=packet)
            self.assertEqual(len(calls.read_text().splitlines()), 4)
            print('SYNTHETIC author.one v4 receipt persisted after one bounded repair; four transport replays, zero model calls', flush=True)

    def test_exact_recomputed_score_rejects_consistently_rehashed_result(self):
        f = copy.deepcopy(self.base)
        path = core.E + '/holdout/results.json'; value = json.loads(f.artifacts[path])
        value['payload']['macro']['semanticCompleteGroupRecallAt8'] = {'numerator': 9, 'denominator': 10}
        rebind(f, path, value)
        private = self.private(f)
        with f.public_io(), self.assertRaisesRegex(ValueError, 'metric differs'):
            replay_holdout_v4(f.root, f.manifest, f.artifacts, f.registry, 'A', private)

    def test_actual_readiness_case_cannot_be_replaced_by_stored_flags(self):
        f = copy.deepcopy(self.base)
        path = core.E + '/holdout/readiness.json'; value = json.loads(f.artifacts[path])
        value['payload']['cases'][0]['unsupported'] = True
        rebind(f, path, value)
        private = self.private(f)
        with f.public_io(), self.assertRaisesRegex(ValueError, 'Readiness case differs'):
            replay_holdout_v4(f.root, f.manifest, f.artifacts, f.registry, 'A', private)

    def test_case_coverage_rejects_even_when_every_remaining_row_is_valid(self):
        f = copy.deepcopy(self.base)
        path = core.E + '/holdout/results.json'; value = json.loads(f.artifacts[path])
        value['payload']['cases'][0], value['payload']['cases'][-1] = value['payload']['cases'][-1], value['payload']['cases'][0]
        rebind(f, path, value)
        with self.assertRaisesRegex(ValueError, 'coverage/order'):
            replay_holdout_v4(f.root, f.manifest, f.artifacts, f.registry, 'A', self.private(f))

    def test_saved_queues_reconstruct_actual_packet_without_retrieval(self):
        f = copy.deepcopy(self.base); case = self.private(f)['cases'][0]
        path = core.E + '/holdout/queues/' + case['id'] + '.json'; value = json.loads(f.artifacts[path])
        value['queues'] = [[]]
        rebind(f, path, value)
        with self.assertRaisesRegex(ValueError, 'deterministic saved-queue replay'):
            replay_packet_v4(f.root, f.manifest, f.artifacts, case, 'A', core.E + '/holdout')

    def test_global_execution_independence_crosses_private_and_public_roles(self):
        f = copy.deepcopy(self.base)
        released_path = core.E + '/holdout/released-seal.json'; value = json.loads(f.artifacts[released_path])
        value['executions'][0]['callId'] = f.registry['entries'][0]['callId']
        rebind(f, released_path, value)
        with self.assertRaisesRegex(ValueError, 'Global actual execution reuse'):
            gate._global_census(f.registry, f.artifacts, f.root)

    def test_registered_cycle_forces_v4_even_after_all_caller_markers_deleted(self):
        f = copy.deepcopy(self.base)
        with f.public_io():
            self.assertTrue(gate.v4_required(core.C, {}))
            with self.assertRaisesRegex(ValueError, 'Fixed v4 roots'):
                batch_author.require_rag_gate(Path(core.C), Path(core.C + '/retrieval-v3'), f.catalogue,
                                             Path(core.C + '/evaluation/full-rag-gate.json'))
            with self.assertRaises(ValueError):
                author.validate_packet(Path(core.C), Path(core.C + '/retrieval-v3'), f.catalogue, f.catalogue['goals'][0], {})

    def test_adopt_inputs_permission_cannot_unlock_card_generation(self):
        f = copy.deepcopy(self.base)
        f.dev['authorization'] = f.auth('ADOPT_INPUTS_ONLY')
        write_authority(f, 'ADOPT_INPUTS_ONLY')
        with f.public_io():
            adoption = gate.require_dev_adoption_v4('ADOPT_INPUTS_ONLY')
            self.assertEqual(adoption['record']['permission'], 'ADOPT_INPUTS_ONLY')
            with self.assertRaisesRegex(ValueError, 'permission/inputs differ'):
                author.validate_packet(Path(core.C), Path(core.C + '/retrieval-v3'), f.catalogue,
                                       f.catalogue['goals'][0], f.goal_wrapper)

    def test_full_curriculum_goal_is_not_reduced_to_uid_or_query(self):
        f = copy.deepcopy(self.base); goal = copy.deepcopy(f.catalogue['goals'][0])
        goal['objectiveZh'] = '修改目标'
        with f.public_io(), self.assertRaisesRegex(ValueError, 'Full curriculum goal differs'):
            author.validate_packet(Path(core.C), Path(core.C + '/retrieval-v3'), f.catalogue, goal, f.goal_wrapper)

    def test_registered_curriculum_rejects_boolean_and_float_integer_aliases(self):
        f = copy.deepcopy(self.base)
        for alias in (True, 1.0):
            supplied = copy.deepcopy(f.catalogue); supplied['goals'][0]['lessonOrdinal'] = alias
            with self.subTest(alias=type(alias).__name__), self.assertRaisesRegex(ValueError, 'registered catalogue differs'):
                gate._catalogue(f.root, f.artifacts, supplied)

    def test_author_schemas_require_current_fixed_runtime_inputs(self):
        f = copy.deepcopy(self.base)
        refs = gate._author_schema_inputs_v4(f.manifest, f.artifacts)
        self.assertEqual([r['path'] for r in refs], [core.P + '/schemas/card.json', core.P + '/schemas/review.json'])
        missing = copy.deepcopy(f.manifest)
        missing['entries'] = [e for e in missing['entries'] if e['artifact']['path'] != refs[0]['path']]
        with self.assertRaisesRegex(ValueError, 'Missing fixed author schema'):
            gate._author_schema_inputs_v4(missing, f.artifacts)
        stale, artifacts = copy.deepcopy(f.manifest), dict(f.artifacts)
        artifacts[refs[0]['path']] += b' '
        next(e for e in stale['entries'] if e['artifact']['path'] == refs[0]['path'])['artifact']['sha256'] = core._hash(artifacts[refs[0]['path']])
        with self.assertRaisesRegex(ValueError, 'Actual author schema bytes differ'):
            gate._author_schema_inputs_v4(stale, artifacts)

    def test_registered_metadata_fits_existing_bounds_after_lazy_dependency_imports(self):
        # Match the existing pipeline test's lazy imports without constructing a model.
        with patch('fastembed.TextEmbedding'), patch('fastembed.rerank.cross_encoder.TextCrossEncoder'):
            f = full_fixture()
        f.finish()
        entries = {entry['artifact']['path']: entry for entry in f.manifest['entries']}
        refs = [f.root['runtimeManifest'], f.root['executionRegistry'], *[slot['artifact'] for slot in f.root['artifacts']]]
        for ref in refs:
            self.assertLessEqual(len(f.artifacts[ref['path']]), core._registered_read_limit(ref, entries), ref['path'])
        bindings = {binding['node']: binding for binding in f.root['authorities']}
        runtime_paths = {entry['artifact']['path'] for entry in f.manifest['entries']}
        for node in ('current-source-review', 'adoption-implementation-review'):
            self.assertTrue(runtime_paths <= {ref['path'] for ref in bindings[node]['boundInputs']})
        contract_paths = {core.P + '/semantic-v4-adoption-contract.json', core.P + '/SEMANTIC_V4_ADOPTION.md'}
        contract_paths |= {entry['artifact']['path'] for entry in f.manifest['entries'] if entry['role'] in
            ('equivalence-input-policy', 'equivalence-instructions', 'equivalence-output-schema', 'equivalence-schedule-schema')}
        self.assertTrue(contract_paths <= {ref['path'] for ref in bindings['contract-review']['boundInputs']})
        mapping = core._parse(f.artifacts[core.D + '/reference-mapping.json'])
        equivalence_paths = {core.D + '/' + name + '.json' for name in ('reference-mapping', 'candidate-mapping', 'references')}
        equivalence_paths |= {review['manifest']['path'] for review in mapping['independentReviews']}
        self.assertTrue(equivalence_paths <= {ref['path'] for ref in bindings['reference-equivalence']['boundInputs']})

    def test_temp_transport_runs_original_receipt_and_card_review_checks(self):
        f = copy.deepcopy(self.base); goal = f.catalogue['goals'][0]
        packet = {'goal': goal, 'curriculumHash': f.catalogue['curriculumHash'], 'query': goal['retrievalQueryEn'],
            'evidence': [f.seed], 'corpusVersion': f.manifest['identity']['corpusVersion'],
            'packetHash': f.ref(core.C + '/authoring/' + goal['stableUid'] + '/v4-packet.json')['sha256']}
        with f.public_io(workflow=True) as mapping:
            transport, calls = synthetic_author_transport(f, mapping, packet)
            args = SimpleNamespace(root=Path(core.C), dotnet=transport)
            folder = args.root / 'authoring' / goal['stableUid']
            card = author.invoke(args, folder, 'generate', 1, author.GENERATE + author.canonical(packet), author.load(author.SCHEMAS / 'card.json'))
            author.validate_card(packet, card)
            review = author.invoke(args, folder, 'review', 1, author.REVIEW + author.canonical({'packet': packet, 'candidate': card}), author.load(author.SCHEMAS / 'review.json'))
            self.assertTrue(author.validate_review(packet, review))
            (folder / 'packet.json').write_text('{"goal":{"stableUid":"unrelated-legacy"}}')
            author.save(folder / 'repair-authorization.json', {'candidateHash': core._hash((folder / 'generate-1/result.json').read_bytes()),
                'reviewHash': core._hash((folder / 'review-1/result.json').read_bytes()), 'validationError': None})
            with self.assertRaisesRegex(ValueError, 'actual failed independent review'):
                author.invoke(args, folder, 'generate', 2, 'SYNTHETIC forbidden extra attempt', author.load(author.SCHEMAS / 'card.json'), review_packet=packet)
            self.assertEqual(len(calls.read_text().splitlines()), 2)

    def test_v4_failed_review_repair_uses_validated_packet_not_legacy_file(self):
        f = copy.deepcopy(self.base); goal = f.catalogue['goals'][0]
        packet = {'goal': goal, 'curriculumHash': f.catalogue['curriculumHash'], 'query': goal['retrievalQueryEn'],
            'evidence': [f.seed], 'corpusVersion': f.manifest['identity']['corpusVersion'],
            'packetHash': f.ref(core.C + '/authoring/' + goal['stableUid'] + '/v4-packet.json')['sha256']}
        for legacy in ('missing', 'wrong'):
            with self.subTest(legacy=legacy), f.public_io(workflow=True) as mapping:
                transport, calls = synthetic_author_transport(f, mapping, packet, repair=True)
                args = SimpleNamespace(root=Path(core.C), dotnet=transport)
                folder = args.root / 'authoring' / goal['stableUid']
                card = author.invoke(args, folder, 'generate', 1, author.GENERATE + author.canonical(packet), author.load(author.SCHEMAS / 'card.json'))
                failed = author.invoke(args, folder, 'review', 1, author.REVIEW + author.canonical({'packet': packet, 'candidate': card}), author.load(author.SCHEMAS / 'review.json'))
                self.assertFalse(author.validate_review(packet, failed))
                if legacy == 'wrong': (folder / 'packet.json').write_text('{"goal":{"stableUid":"wrong-legacy"}}')
                author.save(folder / 'repair-authorization.json', {'candidateHash': core._hash((folder / 'generate-1/result.json').read_bytes()),
                    'reviewHash': core._hash((folder / 'review-1/result.json').read_bytes()), 'validationError': None})
                revised = author.invoke(args, folder, 'generate', 2, f.synthetic_repair_prompt, author.load(author.SCHEMAS / 'card.json'), review_packet=packet)
                author.validate_card(packet, revised)
                passed = author.invoke(args, folder, 'review', 2, f.synthetic_rereview_prompt, author.load(author.SCHEMAS / 'review.json'), review_packet=packet)
                self.assertTrue(author.validate_review(packet, passed))
                with self.assertRaisesRegex(ValueError, 'Only initial generation'):
                    author.invoke(args, folder, 'generate', 3, 'SYNTHETIC denied extra attempt', {}, review_packet=packet)
                self.assertEqual(len(calls.read_text().splitlines()), 4)

    def test_per_goal_raw_capture_must_bind_a4_trace_and_current_response(self):
        f = copy.deepcopy(self.base)
        path = core.C + '/authoring/synthetic-goal/accepted.json'; value = json.loads(f.artifacts[path])
        value['ruleOutcomes'] = value['ruleOutcomes'][:-1]
        f.put(path, value)
        response = core._parse(f.artifacts[f.goal_wrapper['retrieval']['path']])
        with self.assertRaisesRegex(ValueError, 'complete required rules'):
            gate._goal_acceptance(f.root, f.manifest, f.artifacts, 'synthetic-goal',
                f.ref(core.C + '/authoring/synthetic-goal/v4-packet.json'), f.goal_wrapper, response)

    def test_private_prompt_is_rebuilt_from_complete_source_and_labels(self):
        f = full_fixture('private-input')
        with self.assertRaisesRegex(ValueError, 'Private source-only prompt/projection changed'):
            self.private(f)

    def test_novelty_partition_cannot_omit_an_old_case_even_with_valid_raw_hashes(self):
        f = full_fixture('novelty-coverage')
        with self.assertRaisesRegex(ValueError, 'Novelty raw partition verdict/complete comparison coverage'):
            self.private(f)

    def test_exact_source_quote_cannot_be_forged_with_valid_six_file_hashes(self):
        f = full_fixture('quote')
        with f.public_io(), self.assertRaisesRegex(ValueError, 'exact source'):
            replay_holdout_v4(f.root, f.manifest, f.artifacts, f.registry, 'A', self.private(f))


if __name__ == '__main__':
    unittest.main()


class RegistrationDispatchTests(unittest.TestCase):
    def test_parent_registration_node_alone_forces_v4_without_version_or_artifact(self):
        with tempfile.TemporaryDirectory(prefix='SYNTHETIC-registration-') as directory:
            Path(directory, 'run.json').write_text(json.dumps({'nodes': {'A3V4-registration': {'state': 'UNKNOWN'}}}))
            self.assertTrue(gate.v4_required(directory, {}))
