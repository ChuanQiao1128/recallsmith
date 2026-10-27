from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import evaluate
from evaluate import score
from pipeline import digest, save


class RetrievalMetricTests(unittest.TestCase):
    def test_interrupted_holdout_cannot_change_strategy_or_repeat_saved_observation(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            folder = root / 'evaluation/results'
            save(folder / 'dev.json', {})
            selection = {'referenceHash': 'ref', 'corpusVersion': 'corpus', 'strategy': 'bm25',
                         'devHash': digest((folder / 'dev.json').read_bytes())}
            save(folder / 'strategy-selection.json', selection)
            query = {'id': 'cloud-p5', 'module': 'cloud', 'split': 'holdout', 'answerable': True,
                     'queryEn': 'Neutral query', 'requiredEvidenceGroups': [{'alternatives': [{'chunkId': 'c'}]}]}
            labels = {'corpusVersion': 'corpus', 'queries': [query, {**query, 'id': 'cloud-p6'}]}
            args = SimpleNamespace(root=root, split='holdout', corpus_root=root / 'corpus',
                                   model_cache=root / 'cache', container='not-used')
            with patch.object(evaluate, 'references', return_value=(labels, 'ref')), patch.object(evaluate, 'EvidenceIndex') as index:
                index.return_value.retrieve.side_effect = [{'evidence': [{'chunkId': 'c'}]}, RuntimeError('injected crash')]
                with self.assertRaisesRegex(RuntimeError, 'injected'):
                    evaluate.run(args)
                first = folder / 'holdout/bm25/cloud-p5.json'
                self.assertTrue(first.exists())
                first_hash = digest(first.read_bytes())
                selection['strategy'] = 'vector'
                save(folder / 'strategy-selection.json', selection)
                index.reset_mock()
                with self.assertRaisesRegex(ValueError, 'already started'):
                    evaluate.run(args)
                index.assert_not_called()
                self.assertEqual(first_hash, digest(first.read_bytes()))

    def test_equivalent_overlapping_chunks_count_as_one_required_group(self):
        query = {'answerable': True, 'requiredEvidenceGroups': [
            {'alternatives': [{'chunkId': 'a'}, {'chunkId': 'b'}]},
            {'alternatives': [{'chunkId': 'c'}]}]}
        self.assertEqual(1, score(query, {'evidence': [{'chunkId': 'b'}, {'chunkId': 'c'}]})['recallAt8'])
        partial = score(query, {'evidence': [{'chunkId': 'wrong'}, {'chunkId': 'a'}, {'chunkId': 'b'}]})
        self.assertEqual(.5, partial['recallAt8'])
        self.assertEqual(.5, partial['mrrAt8'])

    def test_negative_is_not_a_zero_recall_positive(self):
        result = score({'answerable': False}, {'evidence': []})
        self.assertIsNone(result['recallAt8'])
        self.assertIsNone(result['mrrAt8'])
        self.assertTrue(result['requiresEvidenceReadinessDecision'])

    def test_main_claim_without_necessary_deployment_scope_is_not_recalled(self):
        query = {'answerable': True, 'requiredEvidenceGroups': [
            {'alternatives': [{'chunkId': 'main'}], 'mandatoryScopeEvidenceGroups': [
                {'alternatives': [{'chunkId': 'scope'}, {'chunkId': 'equivalent-scope'}]}]}]}
        self.assertEqual(0, score(query, {'evidence': [{'chunkId': 'main'}]})['recallAt8'])
        self.assertEqual(1, score(query, {'evidence': [{'chunkId': 'main'},
                                                     {'chunkId': 'equivalent-scope'}]})['recallAt8'])

    def test_missing_positive_support_cannot_pass_as_empty_denominator(self):
        with self.assertRaises(ValueError):
            score({'answerable': True, 'requiredEvidenceGroups': []}, {'evidence': []})


if __name__ == '__main__':
    unittest.main()
