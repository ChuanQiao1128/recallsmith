import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('final_retrieval_repair',
    Path(__file__).with_name('final_retrieval_repair.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class FinalObservationTests(unittest.TestCase):
    def test_profile_and_original_source_tampering_fail_before_observation(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            args = SimpleNamespace(output=root / 'evidence', corpus_root=root / 'corpus-root', model_cache=root / 'cache')
            source = root / 'original.json'
            source.write_text('original bytes')
            repair.save(args.output / 'original-source-proof.json', {'s': {
                'path': str(source), 'fileSha256': repair.digest(source.read_bytes())}})
            repair.save(args.output / 'eligibility-exclusions.json', [])
            profiles = {s: repair.final_profile('v', s) for s in repair.STRATEGIES}
            plan = {'sourceHashes': {'code': 'frozen'}, 'corpusInputHashes': {}, 'profiles': profiles,
                    'modelCacheHashes': {},
                    'originalSourceProofHash': repair.digest((args.output / 'original-source-proof.json').read_bytes()),
                    'exclusionHash': repair.digest((args.output / 'eligibility-exclusions.json').read_bytes()),
                    'profileHashes': {s: repair.digest(repair.canonical(p)) for s, p in profiles.items()}}
            for strategy, profile in profiles.items():
                repair.save(args.output / 'profiles' / (strategy + '.json'), profile)
            with patch.object(repair, 'source_hashes', return_value={'code': 'frozen'}):
                repair.check_freeze(args, plan)
                repair.save(args.output / 'profiles/vector.json', profiles['rrf'])
                with self.assertRaisesRegex(ValueError, 'strategy/profile'):
                    repair.check_freeze(args, plan)
                repair.save(args.output / 'profiles/vector.json', profiles['vector'])
                source.write_text('modified bytes')
                with self.assertRaisesRegex(ValueError, 'Original source'):
                    repair.check_freeze(args, plan)
            with patch.object(repair, 'source_hashes', return_value={'code': 'changed'}):
                with self.assertRaisesRegex(ValueError, 'Implementation changed'):
                    repair.check_freeze(args, plan)

    def test_exactly_one_observation_per_strategy_and_no_replay_or_activation(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            args = SimpleNamespace(output=root, corpus_root=root / 'corpus', model_cache=root / 'cache',
                                   container='local-test', dev_references=root / 'dev-only.json')
            args.dev_references.write_text('sealed dev-only fixture')
            profiles = {s: repair.final_profile('v', s) for s in repair.STRATEGIES}
            repair.save(root / 'frozen-plan.json', {'profiles': profiles, 'selectionRule': repair.SELECTION_RULE,
                'profileHashes': {s: repair.digest(repair.canonical(p)) for s, p in profiles.items()}})
            summary = {'meanRecallAt8': .5, 'meanMrrAt8': .8, 'perTheme': {'compute': .5}}
            result = {'summary': summary, 'rows': [{'id': 'case', 'recallAt8': .5}]}
            with patch.object(repair, 'check_freeze'), patch.object(repair, 'pgvector_proof', return_value={}), \
                    patch.object(repair, 'dev_references', return_value={'corpusVersion': 'v', 'queries': []}), \
                    patch.object(repair, 'EvidenceIndex') as index, \
                    patch.object(repair, 'evaluate', return_value=result) as evaluate:
                repair.observe(args)
                self.assertEqual(['bm25', 'vector', 'rrf'], [call.args[2] for call in evaluate.call_args_list])
                self.assertEqual(1, index.call_count)
                with self.assertRaisesRegex(ValueError, 'already exists'):
                    repair.observe(args)
                self.assertEqual(3, evaluate.call_count)
            selection = repair.load(root / 'final-dev/frozen-selection.json')
            self.assertFalse(selection['devThresholdsMet'])
            self.assertEqual('bm25', selection['strategy'])
            self.assertEqual(selection['strategy'], selection['profile']['selectedStrategy'])
            self.assertFalse((args.corpus_root / 'corpus/retrieval-profile.json').exists())
