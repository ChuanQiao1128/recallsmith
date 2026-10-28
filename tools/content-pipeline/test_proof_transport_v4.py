import copy
import json
import unittest

from proof_schedule_v4 import canonical, subsets
from proof_transport_v4 import INSTRUCTIONS, compact_schedule, expand_response


class CompactTransportTests(unittest.TestCase):
    def fixture(self, count=8):
        evidence = [{'chunkId': f'{i:032x}', 'evidenceId': f'ev-{i:032x}',
                     'text': 'Original evidence.'} for i in range(count)]
        originals = {chunk['chunkId']: copy.deepcopy(chunk) for chunk in evidence}
        group = {'id': 'group-one',
                 'requiredFacts': [{'id': 'fact', 'text': 'Required fact.'}],
                 'mandatoryScope': [{'id': 'scope', 'text': 'Required deployment.'}],
                 'anchorSets': ['SECRET_ANCHOR'], 'optionalFacts': ['SECRET_OPTIONAL'],
                 'rank': 'SECRET_RANK', 'peerOutputs': 'SECRET_PEER'}
        return evidence, originals, group

    def planned(self, count=2, **kwargs):
        evidence, originals, group = self.fixture(count)
        return compact_schedule('case-one', 'Which facts apply?', group,
                                evidence, originals, **kwargs)

    def response(self, call, *, verdict='UNKNOWN'):
        projection = json.loads(call['prompt'][len(INSTRUCTIONS):])
        quotes = [{'sourceId': 'a' * 64, 'sourceVersion': 'b' * 64,
                   'chunkId': cid, 'evidenceId': 'ev-' + cid,
                   'sourceStart': 9, 'sourceEnd': 10, 'quote': '文'}
                  for cid in call['chunkIds']]
        rows = []
        for mask in projection['subsetMasks']:
            first = next(index for index in range(len(quotes)) if mask & (1 << index))
            coverage = [{'atomId': atom, 'quoteIndices': [first], 'reason': 'Exact quote.'}
                        for atom in call['atomIds']] if verdict == 'PASS' else []
            rows.append({'mask': mask, 'verdict': verdict, 'coverage': coverage,
                         'deploymentConsistent': 'YES' if verdict == 'PASS' else 'UNKNOWN',
                         'reason': 'Explicit decision.'})
        # Only requested members belong in this batch's quote registry.
        used = {cid for member in call['expectedSubsets'] for cid in member}
        if verdict != 'PASS':
            quotes = [quote for quote in quotes if quote['chunkId'] in used]
        return {'quotes': quotes, 'subsets': rows}

    def expand(self, obj, call, **kwargs):
        raw = canonical(obj).encode('utf-8') if not isinstance(obj, bytes) else obj
        return expand_response(raw, call['chunkIds'], call['expectedSubsets'],
                               atom_ids=call['atomIds'], **kwargs)

    def test_full_255_schedule_and_blind_rank_invariance(self):
        evidence, originals, group = self.fixture()
        before = copy.deepcopy((evidence, originals, group))
        report = compact_schedule('case-one', 'Which facts apply?', group, evidence, originals)
        self.assertEqual(report, compact_schedule('case-one', 'Which facts apply?', group,
                                                 list(reversed(evidence)), originals))
        self.assertEqual(before, (evidence, originals, group))
        self.assertEqual((255, 510, 2), tuple(report[k] for k in ('subsetCount', 'decisionCount', 'callCount')))
        one, two = report['calls']
        self.assertEqual(one['prompt'].encode('utf-8'), two['prompt'].encode('utf-8'))
        self.assertEqual(one['promptSha256'], two['promptSha256'])
        projection = json.loads(one['prompt'][len(INSTRUCTIONS):])
        self.assertEqual({'encoding', 'caseId', 'query', 'group', 'evidence', 'subsetMasks'}, set(projection))
        self.assertEqual('subset-mask-v1', projection['encoding'])
        self.assertEqual({'requiredFacts': group['requiredFacts'], 'mandatoryScope': group['mandatoryScope']},
                         projection['group'])
        self.assertEqual(evidence, projection['evidence'])
        self.assertEqual(subsets(originals), one['expectedSubsets'])
        self.assertEqual(set(range(1, 256)), set(projection['subsetMasks']))
        self.assertNotIn('SECRET', one['prompt'])
        self.assertNotIn('checkerId', one['prompt'])
        self.assertLess(one['promptCharacters'], 60000)
        expanded = self.expand(self.response(one), one)
        self.assertEqual(255, len(expanded['subsets']))
        self.assertEqual('UNKNOWN', expanded['semanticVerdict'])
        self.assertFalse(expanded['releaseAuthorized'])
        self.assertEqual({'promptScalarsExclusive': 60000, 'rawOutputBytes': 48000,
                          'chunks': 8, 'evidenceScalars': 12000}, report['limits'])

    def test_roundtrip_every_subset_zero_through_eight(self):
        for count in range(9):
            report = self.planned(count, per_call=32)
            seen = []
            with self.subTest(count=count):
                for call in report['calls'][::2]:
                    response = self.response(call, verdict='PASS')
                    # Registry includes only chunks actually requested by this batch.
                    # These batches cover every chunk except tiny terminal batches.
                    used = {cid for member in call['expectedSubsets'] for cid in member}
                    mapping = {index: sum(q['chunkId'] in used for q in response['quotes'][:index])
                               for index, q in enumerate(response['quotes']) if q['chunkId'] in used}
                    response['quotes'] = [q for q in response['quotes'] if q['chunkId'] in used]
                    for row in response['subsets']:
                        for coverage in row['coverage']:
                            coverage['quoteIndices'] = [mapping[index] for index in coverage['quoteIndices']]
                    result = self.expand(response, call)
                    seen.extend(tuple(row['chunkIds']) for row in result['subsets'])
                    for row in result['subsets']:
                        self.assertEqual('PASS', row['verdict'])
                        self.assertEqual({'fact', 'scope'}, {atom['atomId'] for atom in row['coverage']})
                        for coverage in row['coverage']:
                            self.assertEqual('文', coverage['quotes'][0]['quote'])
                            self.assertIn(coverage['quotes'][0]['chunkId'], row['chunkIds'])
                    self.assertEqual('UNKNOWN', result['semanticVerdict'])
                    self.assertFalse(result['releaseAuthorized'])
                self.assertEqual(subsets(f'{i:032x}' for i in range(count)), seen)
                self.assertEqual('planned_not_executed', report['status'])
                self.assertEqual('UNKNOWN', report['semanticVerdict'])
                self.assertFalse(report['releaseAuthorized'])
                if not count:
                    self.assertEqual([], report['calls'])
                    self.assertEqual([], expand_response(b'{"quotes":[],"subsets":[]}', [], [],
                                                         atom_ids=['fact'])['subsets'])

    def test_rank_two_singleton_pass_leaves_prefixes_unknown(self):
        call = self.planned()['calls'][0]
        response = self.response(call)
        response['subsets'][-1] = self.response(call, verdict='PASS')['subsets'][-1]
        self.assertEqual(2, response['subsets'][-1]['mask'])
        expanded = self.expand(response, call)
        self.assertEqual(['UNKNOWN', 'UNKNOWN', 'PASS'], [row['verdict'] for row in expanded['subsets']])
        self.assertEqual('UNKNOWN', expanded['semanticVerdict'])
        self.assertFalse(expanded['releaseAuthorized'])

    def test_freeze_batch_sizes_and_reject_invalid_inputs(self):
        for per_call in (1, 4, 254, 255):
            report = self.planned(per_call=per_call)
            self.assertEqual(per_call, report['perCallSubsetLimit'])
            self.assertTrue(all(call['subsetEnd'] - call['subsetStart'] <= per_call for call in report['calls']))
        for value in (True, 0, 256, 1.0, '255'):
            with self.subTest(per_call=value), self.assertRaises(ValueError):
                self.planned(per_call=value)
        evidence, originals, group = self.fixture(1)
        for value in ('x' * 801, '\ud800', ''):
            with self.subTest(query=value), self.assertRaises(ValueError):
                compact_schedule('case-one', value, group, evidence, originals)
        for field, value in (('text', 'tamper'), ('rank', 2), ('text', '\ud800')):
            changed = copy.deepcopy(evidence)
            changed[0][field] = value
            original = {c['chunkId']: copy.deepcopy(c) for c in changed} if field != 'text' or value != 'tamper' else originals
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                compact_schedule('case-one', 'Question?', group, changed, original)
        for packet in (evidence * 2, evidence * 9):
            with self.assertRaises(ValueError):
                compact_schedule('case-one', 'Question?', group, packet, originals)
        group['mandatoryScope'][0]['id'] = 'fact'
        with self.assertRaises(ValueError):
            compact_schedule('case-one', 'Question?', group, evidence, originals)

    def test_exact_prompt_scalar_and_evidence_caps(self):
        evidence, originals, group = self.fixture(1)
        baseline = compact_schedule('case-one', 'Question?', group, evidence, originals)
        length = baseline['calls'][0]['promptCharacters']
        group['requiredFacts'][0]['text'] += '文' * (59999 - length)
        report = compact_schedule('case-one', 'Question?', group, evidence, originals)
        self.assertEqual(59999, report['calls'][0]['promptCharacters'])
        self.assertGreater(len(report['calls'][0]['prompt'].encode('utf-8')), 60000)
        group['requiredFacts'][0]['text'] += 'x'
        with self.assertRaisesRegex(ValueError, 'Complete schedule'):
            compact_schedule('case-one', 'Question?', group, evidence, originals)
        evidence, originals, group = self.fixture()
        for chunk in evidence:
            chunk['text'] = '文' * 1500
        originals = {c['chunkId']: copy.deepcopy(c) for c in evidence}
        self.assertEqual(2, compact_schedule('case-one', 'Question?', group, evidence, originals)['callCount'])
        evidence[0]['text'] += 'x'
        originals[evidence[0]['chunkId']]['text'] += 'x'
        with self.assertRaisesRegex(ValueError, '12000'):
            compact_schedule('case-one', 'Question?', group, evidence, originals)

    def test_exact_raw_output_byte_cap_and_frozen_custom_cap(self):
        call = self.planned(1)['calls'][0]
        response = self.response(call)
        response['subsets'][0]['reason'] = '文'
        size = len(canonical(response).encode('utf-8'))
        self.assertEqual(size, self.expand(response, call, max_output_bytes=size)['rawOutputBytes'])
        with self.assertRaises(ValueError):
            self.expand(response, call, max_output_bytes=size - 1)
        response['subsets'][0]['reason'] += 'x' * (48000 - size)
        result = self.expand(response, call)
        self.assertEqual((48000, 48000), (result['rawOutputBytes'], result['maxOutputBytes']))
        response['subsets'][0]['reason'] += 'x'
        with self.assertRaises(ValueError):
            self.expand(response, call)
        for cap in (True, 0, 48001, 1.0):
            with self.subTest(cap=cap), self.assertRaises(ValueError):
                self.expand(b'{}', call, max_output_bytes=cap)

    def test_strict_json_duplicate_keys_nonfinite_utf8_and_surrogates(self):
        call = self.planned(1)['calls'][0]
        for raw in (b'{"quotes":[],"quotes":[],"subsets":[]}',
                    b'{"quotes":[],"subsets":[{"mask":1,"mask":1}]}',
                    b'{"quotes":NaN,"subsets":[]}', b'{"quotes":Infinity,"subsets":[]}',
                    b'{"quotes":-Infinity,"subsets":[]}', b'{"quotes":1e999,"subsets":[]}',
                    b'{"quotes":[],"subsets":[],"x":"\\ud800"}', b'\xff',
                    b'{} trailing', b'[]', b'null', b'true'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                self.expand(raw, call)
        with self.assertRaises(ValueError):
            expand_response('{}', call['chunkIds'], call['expectedSubsets'], atom_ids=call['atomIds'])

    def test_reject_response_shape_types_and_missing_extra_decisions(self):
        call = self.planned()['calls'][0]
        valid = self.response(call)
        changes = [lambda x: x.update(extra=True), lambda x: x.update(quotes={}),
                   lambda x: x.update(subsets={}), lambda x: x['subsets'].pop(),
                   lambda x: x['subsets'].append(copy.deepcopy(x['subsets'][0])),
                   lambda x: x['subsets'][0].update(mask=4),
                   lambda x: x['subsets'][0].update(mask=True),
                   lambda x: x['subsets'][0].update(mask=1.0),
                   lambda x: x['subsets'][0].update(mask='1'),
                   lambda x: x['subsets'][0].update(verdict=True),
                   lambda x: x['subsets'][0].update(deploymentConsistent=True),
                   lambda x: x['subsets'][0].update(reason=''),
                   lambda x: x['subsets'][0].update(coverage={}),
                   lambda x: x['subsets'][0].update(extra='no')]
        for change in changes:
            response = copy.deepcopy(valid)
            change(response)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.expand(response, call)

    def test_reject_quote_ids_offsets_membership_and_unknown_keys(self):
        call = self.planned()['calls'][0]
        valid = self.response(call, verdict='PASS')
        for key, value in (('sourceId', 'a' * 63), ('sourceVersion', True),
                           ('chunkId', 'g' * 32), ('chunkId', 'f' * 32),
                           ('evidenceId', 'ev-' + 'f' * 32), ('sourceStart', True),
                           ('sourceEnd', 10.0), ('sourceStart', -1), ('sourceEnd', 9),
                           ('sourceEnd', 11), ('quote', ''), ('extra', 'no')):
            response = copy.deepcopy(valid)
            response['quotes'][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.expand(response, call)
        response = copy.deepcopy(valid)
        response['subsets'][0]['coverage'][0]['quoteIndices'] = [1]
        with self.assertRaisesRegex(ValueError, 'outside subset'):
            self.expand(response, call)
        # Source identity/content beyond syntactic validity must be checked downstream.
        response = copy.deepcopy(valid)
        response['quotes'][0]['sourceId'] = 'f' * 64
        self.assertEqual('UNKNOWN', self.expand(response, call)['semanticVerdict'])

    def test_reject_coverage_atoms_indices_and_nonempty_partial_unknown_coverage(self):
        call = self.planned()['calls'][0]
        valid = self.response(call, verdict='PASS')
        changes = [lambda row: row.update(coverage=[]), lambda row: row['coverage'].pop(),
                   lambda row: row['coverage'].append(copy.deepcopy(row['coverage'][0])),
                   lambda row: row['coverage'][0].update(atomId='extra'),
                   lambda row: row['coverage'][0].update(atomId=True),
                   lambda row: row['coverage'][0].update(reason=''),
                   lambda row: row['coverage'][0].update(extra=True)]
        changes += [lambda row, value=value: row['coverage'][0].update(quoteIndices=value)
                    for value in ([], [True], [0.0], [-1], [2], [0, 0], {}, ['0'])]
        for change in changes:
            response = copy.deepcopy(valid)
            change(response['subsets'][0])
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.expand(response, call)
        for verdict in ('FAIL', 'UNKNOWN'):
            response = copy.deepcopy(valid)
            response['subsets'][0]['verdict'] = verdict
            response['subsets'][0]['coverage'].pop()
            with self.assertRaisesRegex(ValueError, 'Missing coverage'):
                self.expand(response, call)
            response['subsets'][0]['coverage'] = []
            self.assertEqual(verdict, self.expand(response, call)['subsets'][0]['verdict'])

    def test_reject_invalid_host_expectations(self):
        call = self.planned()['calls'][0]
        raw = canonical(self.response(call)).encode('utf-8')
        for ids, expected, atoms in ((list(reversed(call['chunkIds'])), call['expectedSubsets'], ['fact']),
                                     (call['chunkIds'] * 2, call['expectedSubsets'], ['fact']),
                                     (call['chunkIds'], [list(call['expectedSubsets'][0])], ['fact']),
                                     (call['chunkIds'], call['expectedSubsets'] * 2, ['fact']),
                                     (call['chunkIds'], [(call['chunkIds'][1], call['chunkIds'][0])], ['fact']),
                                     (call['chunkIds'], call['expectedSubsets'], []),
                                     (call['chunkIds'], call['expectedSubsets'], ['fact', 'fact']),
                                     (call['chunkIds'], call['expectedSubsets'], [True])):
            with self.subTest(ids=ids, expected=expected, atoms=atoms), self.assertRaises(ValueError):
                expand_response(raw, ids, expected, atom_ids=atoms)


if __name__ == '__main__':
    unittest.main()
