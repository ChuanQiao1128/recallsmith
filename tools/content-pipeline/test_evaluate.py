import unittest

from evaluate import score


class RetrievalMetricTests(unittest.TestCase):
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
