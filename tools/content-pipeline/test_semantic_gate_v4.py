"""Full public synthetic success and destructive logic tests; no real permissions."""
import copy
import json
from pathlib import Path
import unittest
import tempfile

import author
import batch_author
import semantic_gate_v4 as gate
import trusted_interfaces_v4 as core
from holdout_gate_replay_v4 import replay_private_labels_v4, replay_holdout_v4, replay_packet_v4
from test_holdout_gate_fixtures_v4 import full_fixture
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
        f = copy.deepcopy(self.base)
        with f.public_io():
            result = batch_author.require_rag_gate(Path(core.C), Path(core.C + '/retrieval-v3'), f.catalogue,
                                                  Path(core.E + '/full-rag-gate.json'))
            self.assertEqual(result['payload']['verdict'], 'PASS')
            packet = author.validate_packet(Path(core.C), Path(core.C + '/retrieval-v3'), f.catalogue,
                                           f.catalogue['goals'][0], f.goal_wrapper)
            self.assertEqual(packet['goal'], f.catalogue['goals'][0])
            self.assertEqual(packet['evidence'], [f.seed])
            self.assertFalse(f.goal_wrapper['releaseAuthorized'])

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
        value['payload']['cases'].pop()
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
