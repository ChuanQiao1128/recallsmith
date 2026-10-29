"""SYNTHETIC fixtures only: no model call, source review, or release authority."""
import unittest

from holdout_gate_replay_v4 import PRIVATE_INSTRUCTIONS, private_schedule
from private_source_policy_v1 import (POLICY, admit_private_projection, fits_legacy,
                                      fits_versioned, private_prompt)


def _source(text, source_id='synthetic-source'):
    return {'sourceId': source_id, 'sourceVersion': 'v1', 'text': text}


def _projection(role, sources, quote=None):
    base = {'version': 'private-label-input-v1', 'role': role, 'batchOrdinal': 0, 'sources': sources}
    if role == 'author':
        base['slots'] = [{'id': 'v4-cloud-p1', 'module': 'cloud', 'answerable': True}]
    else:
        group = {'id': 'g', 'requiredFacts': [{'id': 'fact', 'text': 'synthetic fact'}],
                 'mandatoryScope': [], 'optionalFacts': [], 'anchorSets': []}
        if quote is not None:
            group['anchorSets'] = [{'id': 'a', 'coverage': [{'atomId': 'fact', 'quotes': [quote], 'reason': 'synthetic'}]}]
        base['cases'] = [{'id': 'v4-cloud-p1', 'module': 'cloud', 'queryEn': 'synthetic question',
                          'answerable': True, 'groups': [group], 'negativeReason': None,
                          'principalFactDeploymentTuples': [{'fact': 'synthetic', 'deployment': 'fixture'}]}]
    return base


class PrivateSourcePolicyTests(unittest.TestCase):
    def test_small_source_keeps_legacy_policy(self):
        projection = _projection('author', [_source('short synthetic source')])
        stored = admit_private_projection(PRIVATE_INSTRUCTIONS, 'author', projection)
        prompt, policy = private_prompt(PRIVATE_INSTRUCTIONS, 'author', stored)
        self.assertIsNone(policy)
        self.assertTrue(fits_legacy(prompt))
        self.assertEqual(stored, projection)

    def test_one_oversized_source_uses_named_policy_without_truncation(self):
        text = 'S' * 70000
        projection = _projection('author', [_source(text)])
        stored = admit_private_projection(PRIVATE_INSTRUCTIONS, 'author', projection)
        prompt, policy = private_prompt(PRIVATE_INSTRUCTIONS, 'author', stored)
        self.assertEqual(policy, POLICY)
        self.assertIn(text, prompt)
        self.assertTrue(fits_versioned(prompt))
        self.assertFalse(fits_legacy(prompt))

    def test_two_sources_cannot_borrow_the_oversized_bound(self):
        sources = [_source('A' * 40000, 'one'), _source('B' * 40000, 'two')]
        with self.assertRaises(ValueError):
            admit_private_projection(PRIVATE_INSTRUCTIONS, 'author', _projection('author', sources))

    def test_exact_quote_slice_is_not_repeated_when_needed_to_fit(self):
        text = 'Q' * 120000
        quote = {'sourceId': 'synthetic-source', 'sourceVersion': 'v1', 'chunkId': 'c', 'evidenceId': 'e',
                 'sourceStart': 0, 'sourceEnd': len(text), 'quote': text}
        projection = _projection('checker', [_source(text)], quote)
        stored = admit_private_projection(PRIVATE_INSTRUCTIONS, 'checker', projection)
        prompt, policy = private_prompt(PRIVATE_INSTRUCTIONS, 'checker', stored)
        self.assertEqual(policy, POLICY)
        self.assertEqual(prompt.count(text), 1)
        self.assertIn('embedded-source-slice', prompt)
        self.assertLess(len(prompt), 200000)

    def test_mismatched_quote_is_not_stripped(self):
        from private_source_policy_v1 import dedupe_embedded_quotes
        text = 'Q' * 180000
        quote = {'sourceId': 'synthetic-source', 'sourceVersion': 'v1', 'chunkId': 'c', 'evidenceId': 'e',
                 'sourceStart': 0, 'sourceEnd': 3, 'quote': 'NO' * 15000}
        projection = _projection('checker', [_source(text)], quote)
        self.assertEqual(dedupe_embedded_quotes(projection)['cases'][0]['groups'][0]['anchorSets'][0]['coverage'][0]['quotes'][0]['quote'], 'NO' * 15000)
        with self.assertRaises(ValueError):
            admit_private_projection(PRIVATE_INSTRUCTIONS, 'checker', projection)

    def test_schedule_admits_one_large_source_and_keeps_novelty_bound(self):
        text = 'N' * 65000
        source = _source(text)
        case = {'id': 'v4-cloud-p1', 'module': 'cloud', 'queryEn': 'synthetic', 'answerable': True,
                'groups': [], 'negativeReason': 'synthetic absence',
                'principalFactDeploymentTuples': [{'fact': 'synthetic', 'deployment': 'fixture'}]}
        plan = {'batches': [{'batchOrdinal': 0, 'slots': [{'id': 'v4-cloud-p1', 'module': 'cloud', 'answerable': False}],
                             'sourceIds': ['synthetic-source']}]}
        calls = private_schedule(plan, [case], {'queries': [{'id': 'old-1'}]}, {'synthetic-source': source})
        author = next(call for call in calls if call[0] == 'author')
        _, policy = private_prompt(PRIVATE_INSTRUCTIONS, 'author', author[2])
        self.assertEqual(policy, POLICY)
        novelty = [call for call in calls if call[0] == 'novelty']
        self.assertEqual(len(novelty), 1)


if __name__ == '__main__':
    unittest.main()
