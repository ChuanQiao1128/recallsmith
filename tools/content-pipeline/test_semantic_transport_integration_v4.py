"""Synthetic transport/content integration, never real execution or release evidence."""
import copy
import unittest

import test_semantic_proof_v4 as fixtures
from proof_transport_v4 import compact_schedule, expand_response
from proof_schedule_v4 import canonical
from semantic_proof_v4 import inspect_group


class SemanticTransportIntegrationTests(unittest.TestCase):
    def flow(self, count=8, per_call=255, corrupt_quote=False):
        helper = fixtures.SemanticProofDiagnosticsTests()
        data = helper.fixture(count, per_batch=per_call)
        planned = compact_schedule(data['case_id'], 'Which synthetic facts apply?',
                                   data['group'], data['evidence'], data['originals'], per_call=per_call)
        data['bindings']['batches'] = [
            {'projectionHash': c['projectionHash'], 'subsets': [list(s) for s in c['expectedSubsets']]}
            for c in planned['calls'] if c['checkerId'] == 'one']
        target = data['evidence'][1]['chunkId']
        checks = {'one': [], 'two': []}
        for call in planned['calls']:
            ids = call['chunkIds']
            rows, quotes = [], []
            for member in call['expectedSubsets']:
                passed = member == (target,)
                coverage = []
                if passed:
                    quote = helper.quote(data, target)
                    if corrupt_quote:
                        quote['quote'] = 'x' * len(quote['quote'])
                    quotes.append(quote)
                    coverage = [{'atomId': atom, 'quoteIndices': [len(quotes) - 1],
                                 'reason': 'Synthetic support.'} for atom in call['atomIds']]
                mask = sum(1 << ids.index(cid) for cid in member)
                rows.append({'mask': mask, 'verdict': 'PASS' if passed else 'UNKNOWN',
                             'coverage': coverage, 'deploymentConsistent': 'YES' if passed else 'UNKNOWN',
                             'reason': 'Synthetic decision.'})
            raw = canonical({'quotes': quotes, 'subsets': rows}).encode('utf-8')
            decoded = expand_response(raw, ids, call['expectedSubsets'], atom_ids=call['atomIds'])
            self.assertFalse(decoded['releaseAuthorized'])
            role = call['checkerId']
            record = copy.deepcopy(data['checks_' + role][len(checks[role])])
            record.update(projectionHash=call['projectionHash'], subsets=decoded['subsets'])
            checks[role].append(record)
        data.update(checks_one=checks['one'], checks_two=checks['two'])
        return data, planned

    def test_full255_compact_response_to_diagnostic_completion(self):
        data, planned = self.flow()
        result = inspect_group(**data)
        self.assertEqual(2, planned['callCount'])
        self.assertEqual(255, result['subsetCount'])
        self.assertEqual(2, result['completionRank'])
        self.assertEqual(1, result['creditedSubsetCount'])
        self.assertFalse(result['releaseAuthorized'])
        self.assertFalse(result['rawExecutionVerified'])
        self.assertEqual('UNVERIFIED', result['semanticTruth'])

    def test_split_batches_keep_exact_assignment_and_unknown_disagreement(self):
        data, planned = self.flow(per_call=32)
        self.assertEqual(16, planned['callCount'])
        self.assertEqual(2, inspect_group(**data)['completionRank'])
        target = [data['evidence'][1]['chunkId']]
        for check in data['checks_two']:
            for decision in check['subsets']:
                if decision['chunkIds'] == target:
                    decision.update(verdict='UNKNOWN', deploymentConsistent='UNKNOWN', coverage=[])
        self.assertIsNone(inspect_group(**data)['completionRank'])
        data['checks_one'][0]['projectionHash'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'binding'):
            inspect_group(**data)

    def test_transport_structure_does_not_replace_original_source_check(self):
        data, _ = self.flow(corrupt_quote=True)
        with self.assertRaisesRegex(ValueError, 'exact source'):
            inspect_group(**data)


if __name__ == '__main__':
    unittest.main()
