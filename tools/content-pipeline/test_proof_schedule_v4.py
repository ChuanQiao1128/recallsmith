import copy
import json
import unittest

from proof_schedule_v4 import INSTRUCTIONS, schedule, subsets, workload


class ProofScheduleTests(unittest.TestCase):
    def fixture(self, count=8):
        chunks = [{'chunkId': f'{i:032x}', 'evidenceId': f'ev-{i:032x}',
                   'text': 'Original factual evidence.'} for i in range(count)]
        originals = {c['chunkId']: copy.deepcopy(c) for c in chunks}
        group = {'id': 'g-one', 'requiredFacts': [{'id': 'fact-one', 'text': 'Required fact.'}],
                 'mandatoryScope': [{'id': 'scope-one', 'text': 'Required deployment.'}],
                 'anchorSets': ['MUST_NOT_LEAK'], 'optionalFacts': ['MUST_NOT_LEAK']}
        return chunks, originals, group

    def test_all_255_subsets_twice_with_independent_checker_batches(self):
        evidence, originals, group = self.fixture()
        before = copy.deepcopy((evidence, originals, group))
        report = schedule('case-one', 'Which facts apply?', group, evidence, originals)
        self.assertEqual(255, report['subsetCount'])
        self.assertEqual(510, report['decisionCount'])
        self.assertEqual(128, report['callCount'])
        expected = subsets(originals)
        for checker in ('one', 'two'):
            seen = []
            for call in report['calls']:
                if call['checkerId'] != checker:
                    continue
                projection = json.loads(call['prompt'][len(INSTRUCTIONS):])
                self.assertNotIn('rank', projection)
                self.assertNotIn('MUST_NOT_LEAK', call['prompt'])
                seen.extend(tuple(ids) for ids in projection['subsets'])
                self.assertLess(call['promptCharacters'], 60000)
            self.assertEqual(expected, seen)
        self.assertEqual(before, (evidence, originals, group))
        self.assertEqual('UNKNOWN', report['semanticVerdict'])
        self.assertFalse(report['releaseAuthorized'])

    def test_blind_projection_is_identical_for_each_checker_and_rank_independent(self):
        evidence, originals, group = self.fixture()
        first = schedule('case-one', 'Original question?', group, evidence, originals)
        second = schedule('case-one', 'Original question?', group, list(reversed(evidence)), originals)
        self.assertEqual(first, second)
        for a, b in zip(first['calls'][::2], first['calls'][1::2]):
            self.assertNotEqual(a['checkerId'], b['checkerId'])
            self.assertEqual(a['prompt'], b['prompt'])

    def test_no_prefix_shortcut_or_early_stopping_even_for_rank_two_witness(self):
        evidence, originals, group = self.fixture()
        report = schedule('case-one', 'Original question?', group, evidence, originals)
        requested = [json.loads(c['prompt'][len(INSTRUCTIONS):])['subsets']
                     for c in report['calls'] if c['checkerId'] == 'one']
        all_ids = [tuple(ids) for batch in requested for ids in batch]
        self.assertIn((evidence[1]['chunkId'],), all_ids)
        self.assertEqual(255, len(set(all_ids)))

    def test_oversized_projection_fails_before_returning_any_calls(self):
        evidence, originals, group = self.fixture()
        group['requiredFacts'][0]['text'] = 'x' * 60000
        with self.assertRaisesRegex(ValueError, 'prompt limit'):
            schedule('case-one', 'Original question?', group, evidence, originals)

    def test_empty_packet_has_no_requests_and_never_semantic_credit(self):
        _, _, group = self.fixture()
        report = schedule('case-one', 'Original question?', group, [], {})
        self.assertEqual([], report['calls'])
        self.assertEqual(0, report['decisionCount'])
        self.assertEqual('UNKNOWN', report['semanticVerdict'])

    def test_packet_tamper_duplicate_ids_budget_and_non_scalar_fail(self):
        evidence, originals, group = self.fixture()
        tampered = copy.deepcopy(evidence)
        tampered[0]['text'] = 'changed'
        for packet in (tampered, evidence + [evidence[0]], [evidence[0], evidence[0]]):
            with self.subTest(packet=packet), self.assertRaises(ValueError):
                schedule('case-one', 'Original question?', group, packet, originals)
        for i in range(8):
            evidence[i]['text'] = 'x' * 1501
        originals = {c['chunkId']: copy.deepcopy(c) for c in evidence}
        with self.assertRaises(ValueError):
            schedule('case-one', 'Original question?', group, evidence, originals)
        evidence[0]['text'] = '\ud800'
        originals[evidence[0]['chunkId']] = copy.deepcopy(evidence[0])
        with self.assertRaises(UnicodeError):
            schedule('case-one', 'Original question?', group, evidence[:1], originals)

    def test_scope_atom_identity_and_required_fields(self):
        evidence, originals, group = self.fixture()
        group['mandatoryScope'][0]['id'] = 'fact-one'
        with self.assertRaises(ValueError):
            schedule('case-one', 'Original question?', group, evidence, originals)

    def test_effective_and_historical_counts_stay_separate(self):
        observed = workload(148)
        historical = workload(65)
        self.assertEqual(75480, observed['decisions'])
        self.assertEqual(18944, observed['calls'])
        self.assertEqual(33150, historical['decisions'])
        self.assertEqual(8320, historical['calls'])
        for args in [(True,), (-1,), (1, 9), (1, 8, True), (1, 8, 0)]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                workload(*args)


if __name__ == '__main__':
    unittest.main()
