"""SYNTHETIC offline composition only; no model, retrieval or semantic acceptance."""
import copy
from fractions import Fraction
import json
import unittest
from unittest.mock import patch

import test_execution_receipt_v4 as host_fixtures
import test_semantic_proof_v4 as content_fixtures
from execution_receipt_v4 import verify_execution_v4
from proof_transport_v4 import compact_schedule, expand_response
from semantic_runtime_v4 import (CYCLE_ID, THEMES, aggregate_groups_generic_v4,
                                 aggregate_groups_v4, replay_group_v4)


def freeze_synthetic_inputs(args):
    """Explicit SYNTHETIC bytes/pins; these are not production authority."""
    raw = {'packetBytes': json.dumps({'query': args['query'], 'evidence': args['evidence']},
                                    ensure_ascii=False, indent=1).encode() + b'\n',
           'referenceBytes': json.dumps({'queries': [{'id': args['case_id'], 'queryEn': args['query'],
                                                       'groups': [args['group']]}]},
                                       ensure_ascii=False, indent=1).encode() + b'\n',
           'protocolBytes': b'SYNTHETIC protocol file; no semantic/release authority.\n'}
    args['frozen_inputs'] = raw
    args['bindings'].update({kind + 'Hash': host_fixtures.digest(raw[kind + 'Bytes'])
                             for kind in ('packet', 'reference', 'protocol')})
    return args


class SyntheticRuntimeTests(unittest.TestCase):
    def fixture(self, count=2, per_call=1, mutate=None, disagree=False):
        content = content_fixtures.SemanticProofDiagnosticsTests()
        data = content.fixture(count)
        query = 'Which SYNTHETIC fact and scope apply?'
        plan = compact_schedule(data['case_id'], query, data['group'], data['evidence'],
                                data['originals'], per_call=per_call)
        bindings = copy.deepcopy(data['bindings'])
        bindings['batches'] = [{'projectionHash': c['projectionHash'],
                                'subsets': [list(s) for s in c['expectedSubsets']]}
                               for c in plan['calls'] if c['checkerId'] == 'one']
        schema = b' {"type":"object"}\n'
        entries, hosts, ordinals = [], [], {'one': 0, 'two': 0}
        target = data['evidence'][-1]['chunkId'] if count else None
        for index, call in enumerate(plan['calls']):
            rows, quotes = [], []
            for member in call['expectedSubsets']:
                passed = member == (target,) and not (disagree and call['checkerId'] == 'two')
                coverage = []
                if passed:
                    quotes.append(content.quote(data, target))
                    coverage = [{'atomId': a, 'quoteIndices': [len(quotes) - 1],
                                 'reason': 'SYNTHETIC quote.'} for a in call['atomIds']]
                rows.append({'mask': sum(1 << call['chunkIds'].index(cid) for cid in member),
                             'verdict': 'PASS' if passed else 'UNKNOWN', 'coverage': coverage,
                             'deploymentConsistent': 'YES' if passed else 'UNKNOWN',
                             'reason': 'SYNTHETIC decision.'})
            response = {'quotes': quotes, 'subsets': rows}
            if mutate:
                mutate(response)
            host = host_fixtures.SyntheticReceiptTests()
            host.setUp()
            self.addCleanup(host.doCleanups)
            host.prompt, host.schema = call['prompt'], schema
            host.result = b' \n' + json.dumps(response, ensure_ascii=False, indent=1).encode() + b'\n '
            host.invocation.update(inputHash=host_fixtures.digest(host.prompt.encode()),
                                   schemaHash=host_fixtures.digest(schema))
            host.execution.update(inputHash=host_fixtures.digest(host.prompt.encode()),
                                  schemaHash=host_fixtures.digest(schema),
                                  outputHash=host_fixtures.digest(host.result), outputBytes=len(host.result))
            host.events[0]['thread_id'] = f'synthetic-call-{index}'
            host.events[3]['item']['text'] = host.result.decode()
            host.write_fixture()
            role = call['checkerId']
            entries.append({'checkerId': role, 'batchOrdinal': ordinals[role],
                            'outputDirectory': str(host.output), 'trustedPins': host.pins})
            ordinals[role] += 1
            hosts.append(host)
        args = {'case_id': data['case_id'], 'query': query, 'group': data['group'],
                'evidence': data['evidence'], 'originals': data['originals'], 'sources': data['sources'],
                'bindings': bindings, 'frozen_schema_bytes': schema, 'execution_pins': entries,
                'per_call': per_call}
        return freeze_synthetic_inputs(args), hosts

    def test_all_batches_both_roles_original_bytes_and_honest_flags(self):
        args, hosts = self.fixture()
        received = []
        def observe(raw, *rest, **kwargs):
            received.append(raw)
            return expand_response(raw, *rest, **kwargs)
        with patch('semantic_runtime_v4.expand_response', side_effect=observe):
            result = replay_group_v4(**args)
        self.assertEqual(received, [h.result for h in hosts])
        self.assertTrue(all(raw.startswith(b' \n') and raw.endswith(b'\n ') for raw in received))
        self.assertEqual((result['completionRank'], result['subsetCount']), (2, 3))
        self.assertEqual(len(result['executionProvenance']), 6)
        self.assertEqual(result['executionAuthenticity'], 'HOST_RECORDS_ONLY')
        self.assertTrue(result['rawReceiptIntegrityVerified'])
        for flag in ('rawExecutionVerified', 'releaseAuthorized'):
            self.assertIs(result[flag], False)
        self.assertEqual(result['semanticTruth'], 'UNVERIFIED')
        self.assertNotIn('sourceReview', result)
        self.assertNotIn('denialReceipt', result)
        self.assertEqual({k: result['verifiedInputIdentities'][k] for k in
                          ('packetHash', 'referenceHash', 'protocolHash')},
                         {k: args['bindings'][k] for k in
                          ('packetHash', 'referenceHash', 'protocolHash')})

    def test_altered_prompt_schema_and_raw_bytes_reject(self):
        args, hosts = self.fixture(1)
        changed = dict(args, query=args['query'] + ' changed')
        call = compact_schedule(changed['case_id'], changed['query'], changed['group'],
                                changed['evidence'], changed['originals'], per_call=1)['calls'][0]
        changed['bindings'] = copy.deepcopy(args['bindings'])
        changed['bindings']['batches'][0]['projectionHash'] = call['projectionHash']
        freeze_synthetic_inputs(changed)
        with self.assertRaisesRegex(ValueError, 'binding changed'):
            replay_group_v4(**changed)
        with self.assertRaisesRegex(ValueError, 'schema bytes changed'):
            replay_group_v4(**dict(args, frozen_schema_bytes=args['frozen_schema_bytes'] + b' '))
        (hosts[0].output / 'result.json').write_bytes(hosts[0].result + b' ')
        with self.assertRaisesRegex(ValueError, 'raw hash mismatch'):
            replay_group_v4(**args)

    def test_registration_missing_duplicate_extra_and_reused_output_reject(self):
        args, _ = self.fixture()
        entries = args['execution_pins']
        variants = [entries[:-1], entries + [copy.deepcopy(entries[0])],
                    [{**entries[0], 'checkerId': 'three'}, *entries[1:]],
                    [{**entries[0], 'batchOrdinal': True}, *entries[1:]],
                    [{**entries[0], 'batchOrdinal': 99}, *entries[1:]],
                    [entries[0], {**entries[1], 'outputDirectory': entries[0]['outputDirectory']}, *entries[2:]]]
        for variant in variants:
            with self.subTest(role=variant[0]['checkerId']), self.assertRaises(ValueError):
                replay_group_v4(**dict(args, execution_pins=variant))

    def test_actual_raw_thread_reuse_rejects(self):
        args, hosts = self.fixture(1)
        hosts[1].events[0]['thread_id'] = hosts[0].events[0]['thread_id']
        hosts[1].write_fixture()
        args['execution_pins'][1]['trustedPins'] = hosts[1].pins
        with self.assertRaisesRegex(ValueError, 'Reused actual call/workspace'):
            replay_group_v4(**args)

    def test_derived_workspace_reuse_rejects(self):
        args, hosts = self.fixture(1)
        receipts = [verify_execution_v4(h.output, frozen_prompt=h.prompt,
                    frozen_schema_bytes=h.schema, trusted_pins=h.pins) for h in hosts]
        receipts[1]['workspaceId'] = receipts[0]['workspaceId']
        # Isolate wrapper identity checking; raw-verifier restrictions have their own suite.
        with patch('semantic_runtime_v4.verify_execution_v4', side_effect=receipts):
            with self.assertRaisesRegex(ValueError, 'Reused actual call/workspace'):
                replay_group_v4(**args)

    def test_partial_duplicate_and_bad_source_quote_reject(self):
        def missing(response):
            response['subsets'].pop()
        def duplicate(response):
            response['subsets'].append(copy.deepcopy(response['subsets'][0]))
        def quote(response):
            if response['quotes']:
                response['quotes'][0]['quote'] = 'x' * len(response['quotes'][0]['quote'])
        for mutation in (missing, duplicate, quote):
            args, _ = self.fixture(1, mutate=mutation)
            with self.subTest(mutation=mutation.__name__), self.assertRaises(ValueError):
                replay_group_v4(**args)

    def test_packet_source_tampering_rejects(self):
        args, _ = self.fixture(1)
        args['sources'][args['evidence'][0]['sourceId']]['text'] += 'changed'
        with self.assertRaisesRegex(ValueError, 'Stale or changed source'):
            replay_group_v4(**args)

    def test_unchanged_frozen_packet_rejects_rank_reorder(self):
        args, _ = self.fixture()
        self.assertEqual(replay_group_v4(**args)['completionRank'], 2)
        args['evidence'].reverse()
        with self.assertRaises(ValueError):
            replay_group_v4(**args)

    def test_common_binding_hash_mutations_reject(self):
        for field in ('packetHash', 'referenceHash', 'protocolHash'):
            args, _ = self.fixture()
            args['bindings'][field] = 'e' * 64
            with self.subTest(field=field), self.assertRaises(ValueError):
                replay_group_v4(**args)

    def test_frozen_input_bytes_and_argument_mutations_reject_before_reader(self):
        for field in ('packetBytes', 'referenceBytes', 'protocolBytes'):
            args, _ = self.fixture(1)
            args['frozen_inputs'][field] += b' '
            with self.subTest(field=field), patch('semantic_runtime_v4.verify_execution_v4',
                    side_effect=AssertionError('input mismatch must precede execution reads')):
                with self.assertRaisesRegex(ValueError, 'Frozen input hash mismatch'):
                    replay_group_v4(**args)
        for change in ('query', 'chunk-text', 'group-atom', 'case', 'group'):
            args, _ = self.fixture(1)
            if change == 'query':
                args['query'] += ' changed'
            elif change == 'chunk-text':
                args['evidence'][0]['text'] += ' changed'
            elif change == 'group-atom':
                args['group']['requiredFacts'][0]['text'] += ' changed'
            elif change == 'case':
                args['case_id'] = 'other-case'
            else:
                args['group']['id'] = 'other-group'
            with self.subTest(change=change), patch('semantic_runtime_v4.verify_execution_v4',
                    side_effect=AssertionError('input mismatch must precede execution reads')):
                with self.assertRaises(ValueError):
                    replay_group_v4(**args)

    def test_frozen_input_shape_duplicate_reference_ids_and_types_reject(self):
        for change in ('missing', 'extra', 'not-bytes', 'duplicate-case', 'duplicate-group'):
            args, _ = self.fixture(1)
            if change == 'missing':
                args['frozen_inputs'].pop('protocolBytes')
            elif change == 'extra':
                args['frozen_inputs']['extra'] = b'no'
            elif change == 'not-bytes':
                args['frozen_inputs']['protocolBytes'] = 'text'
            else:
                refs = json.loads(args['frozen_inputs']['referenceBytes'])
                if change == 'duplicate-case':
                    refs['queries'].append(copy.deepcopy(refs['queries'][0]))
                else:
                    refs['queries'][0]['groups'].append(copy.deepcopy(refs['queries'][0]['groups'][0]))
                raw = json.dumps(refs).encode()
                args['frozen_inputs']['referenceBytes'] = raw
                args['bindings']['referenceHash'] = host_fixtures.digest(raw)
            with self.subTest(change=change), self.assertRaises(ValueError):
                replay_group_v4(**args)
        args, _ = self.fixture(0)
        args.pop('frozen_inputs')
        with self.assertRaises(TypeError):
            replay_group_v4(**args)

    def test_checker_disagreement(self):
        args, _ = self.fixture(disagree=True)
        self.assertIsNone(replay_group_v4(**args)['completionRank'])

    def test_empty_packet_requires_zero_calls_and_has_no_credit(self):
        args, _ = self.fixture(0)
        with patch('semantic_runtime_v4.verify_execution_v4', side_effect=AssertionError('no calls')):
            result = replay_group_v4(**args)
        self.assertIsNone(result['completionRank'])
        self.assertEqual(result['executionProvenance'], [])
        self.assertFalse(result['diagnosticCredit'])
        self.assertFalse(result['rawReceiptIntegrityVerified'])
        args['execution_pins'] = [{'checkerId': 'one', 'batchOrdinal': 0,
                                   'outputDirectory': '/synthetic', 'trustedPins': {}}]
        with self.assertRaisesRegex(ValueError, 'Missing or extra'):
            replay_group_v4(**args)

    def test_schedule_binding_change_rejects_before_reader(self):
        args, _ = self.fixture()
        args['bindings']['batches'][0]['projectionHash'] = 'f' * 64
        with patch('semantic_runtime_v4.verify_execution_v4', side_effect=AssertionError('must not read')):
            with self.assertRaisesRegex(ValueError, 'rebuilt exact compact schedule'):
                replay_group_v4(**args)


def synthetic_group(case_id, group_id, rank=None, serial=0):
    """Minimal explicit SYNTHETIC metric row, never an execution assertion."""
    return {'caseId': case_id, 'groupId': group_id, 'cycleId': CYCLE_ID,
            'completionRank': rank, 'diagnosticCredit': rank is not None,
            'subsetCount': 255, 'perCallSubsetLimit': 255,
            'executionProvenance': [{'checkerId': role, 'batchOrdinal': 0,
                                    'callId': f'SYNTHETIC-call-{serial}-{role}',
                                    'workspaceId': f'/SYNTHETIC/workspace-{serial}-{role}',
                                    'outputDirectory': f'/SYNTHETIC/output-{serial}-{role}'}
                                   for role in ('one', 'two')],
            'releaseAuthorized': False, 'rawExecutionVerified': False,
            'semanticTruth': 'UNVERIFIED', 'executionAuthenticity': 'HOST_RECORDS_ONLY'}


class SyntheticAggregateTests(unittest.TestCase):
    def fixture(self):
        refs = {'queries': [{'id': 'alpha', 'module': 'cloud', 'answerable': True,
                             'requiredEvidenceGroups': [{'groupId': 'a'}, {'groupId': 'b'}]},
                            {'id': 'beta', 'module': 'cloud', 'answerable': True,
                             'requiredEvidenceGroups': [{'groupId': 'c'}]},
                            {'id': 'gamma', 'module': 'storage', 'answerable': True,
                             'requiredEvidenceGroups': [{'groupId': 'd'}]},
                            {'id': 'negative', 'module': 'storage', 'answerable': False,
                             'requiredEvidenceGroups': []}]}
        results = [{'caseId': 'alpha', 'groups': [synthetic_group('alpha', 'a', 8, 1),
                                                 synthetic_group('alpha', 'b', 3, 2)],
                    'legacyMetrics': {'anchorRecall': 1}},
                   {'caseId': 'beta', 'groups': [synthetic_group('beta', 'c', None, 3)]},
                   {'caseId': 'gamma', 'groups': [synthetic_group('gamma', 'd', 2, 4)]},
                   {'caseId': 'negative', 'groups': []}]
        return refs, results

    def test_exact_denominators_zeroes_negatives_themes_and_earliest_complete(self):
        refs, results = self.fixture()
        before = copy.deepcopy((refs, results))
        report = aggregate_groups_generic_v4(refs, results)
        self.assertEqual((refs, results), before)
        self.assertEqual(report['semanticRecallAt8'], Fraction(2, 3))
        self.assertEqual(report['queryMRR'], Fraction(5, 18))
        self.assertEqual(report['perTheme']['cloud']['semanticRecallAt8'], Fraction(1, 2))
        self.assertEqual(report['themeMacro']['semanticRecallAt8'], Fraction(3, 4))
        self.assertEqual(report['themeMacro']['queryMRR'], Fraction(1, 3))
        self.assertEqual((report['positiveCount'], report['negativeCount'], report['requiredGroups']), (3, 1, 4))
        self.assertEqual(report['cases'][0]['queryMRR'], Fraction(1, 3))
        self.assertLess(report['semanticRecallAt8'], Fraction(7, 10))
        self.assertEqual(report['legacyDiagnosticMetrics'], {'alpha': {'anchorRecall': 1}})
        self.assertFalse(report['releaseAuthorized'])

    def test_partial_completion_recall_is_per_query_macro(self):
        refs, results = self.fixture()
        results[0]['groups'][0].update(completionRank=None, diagnosticCredit=False)
        report = aggregate_groups_generic_v4(refs, results)
        self.assertEqual(report['semanticRecallAt8'], Fraction(1, 2))
        self.assertEqual(report['completedGroups'], 2)

    def test_duplicate_missing_extra_cases_or_groups_reject(self):
        changes = ('missing-case', 'duplicate-case', 'extra-case', 'missing-group', 'duplicate-group',
                   'extra-group', 'negative-group', 'reference-case', 'reference-group', 'missing-group-id')
        for change in changes:
            refs, results = self.fixture()
            if change == 'missing-case':
                results.pop()
            elif change == 'duplicate-case':
                results.append(copy.deepcopy(results[0]))
            elif change == 'extra-case':
                results.append({'caseId': 'extra', 'groups': []})
            elif change == 'missing-group':
                results[0]['groups'].pop()
            elif change == 'duplicate-group':
                results[0]['groups'].append(copy.deepcopy(results[0]['groups'][0]))
            elif change == 'extra-group':
                results[0]['groups'].append(synthetic_group('alpha', 'extra', 1, 8))
            elif change == 'negative-group':
                results[-1]['groups'] = [synthetic_group('negative', 'a', 1, 8)]
            elif change == 'reference-case':
                refs['queries'].append(copy.deepcopy(refs['queries'][0]))
            elif change == 'reference-group':
                refs['queries'][0]['requiredEvidenceGroups'].append({'groupId': 'a'})
            else:
                refs['queries'][0]['requiredEvidenceGroups'][0].pop('groupId')
            with self.subTest(change=change), self.assertRaises(ValueError):
                aggregate_groups_generic_v4(refs, results)

    def test_reused_call_workspace_output_across_cases_and_groups_reject(self):
        for field in ('callId', 'workspaceId', 'outputDirectory'):
            for case_index, group_index in ((0, 1), (1, 0)):
                refs, results = self.fixture()
                source = results[0]['groups'][0]['executionProvenance'][0]
                results[case_index]['groups'][group_index]['executionProvenance'][0][field] = source[field]
                with self.subTest(field=field, case=case_index), self.assertRaisesRegex(ValueError, 'Reused'):
                    aggregate_groups_generic_v4(refs, results)

    def test_missing_provenance_bad_rank_and_authority_upgrade_reject(self):
        for change in ('provenance', 'duplicate-provenance', 'bool-rank', 'rank9', 'credit', 'authority', 'cycle'):
            refs, results = self.fixture()
            group = results[0]['groups'][0]
            if change == 'provenance':
                group['executionProvenance'].pop()
            elif change == 'duplicate-provenance':
                group['executionProvenance'].append(copy.deepcopy(group['executionProvenance'][0]))
            elif change == 'bool-rank':
                group['completionRank'] = True
            elif change == 'rank9':
                group['completionRank'] = 9
            elif change == 'credit':
                group['diagnosticCredit'] = False
            elif change == 'authority':
                group['releaseAuthorized'] = True
            else:
                group['cycleId'] = 'other'
            with self.subTest(change=change), self.assertRaises(ValueError):
                aggregate_groups_generic_v4(refs, results)

    def test_strict_wrapper_actual_counts_themes_and_legacy_split_is_history(self):
        refs, results, serial = {'queries': []}, [], 0
        for theme_index, theme in enumerate(sorted(THEMES)):
            for index in range(10):
                positive = index < 8
                cid = f'{theme}-p{index + 1}' if positive else f'{theme}-n{index - 7}'
                # 64 positives: 20*3 + 44*2 = 148 groups.
                count = (3 if theme_index * 8 + index < 20 else 2) if positive else 0
                groups = [{'groupId': f'group-{i + 1}'} for i in range(count)]
                refs['queries'].append({'id': cid, 'module': theme, 'answerable': positive,
                                        'split': 'holdout', 'requiredEvidenceGroups': groups})
                output = []
                for group in groups:
                    serial += 1
                    output.append(synthetic_group(cid, group['groupId'], None, serial))
                results.append({'caseId': cid, 'groups': output})
        raw = json.dumps(refs, indent=1).encode() + b'\n'
        with self.assertRaisesRegex(ValueError, 'frozen original reference file digest'):
            aggregate_groups_v4(refs, results, raw_reference_bytes=raw)
        # Patch the fixed expected pin only inside an explicitly synthetic test.
        # Production callers cannot override it through function arguments.
        with patch('semantic_runtime_v4.FROZEN_REFERENCE_FILE_SHA256', host_fixtures.digest(raw)):
            report = aggregate_groups_v4(refs, results, raw_reference_bytes=raw)
            self.assertEqual((report['caseCount'], report['positiveCount'], report['negativeCount'], report['requiredGroups']),
                             (80, 64, 16, 148))
            self.assertEqual(report['semanticRecallAt8'], Fraction(0))
            self.assertEqual(report['originalReferenceFileSha256'], host_fixtures.digest(raw))
            self.assertFalse(report['releaseAuthorized'])
            for change in ('group-count', 'theme', 'case-rename', 'group-rename', 'group-reassign'):
                changed = copy.deepcopy(refs)
                if change == 'group-count':
                    changed['queries'][0]['requiredEvidenceGroups'].pop()
                elif change == 'theme':
                    changed['queries'][0]['module'] = 'invented-theme'
                elif change == 'case-rename':
                    changed['queries'][0]['id'] = 'invented-case'
                elif change == 'group-rename':
                    changed['queries'][0]['requiredEvidenceGroups'][0]['groupId'] = 'invented-group'
                else:
                    changed['queries'][0]['requiredEvidenceGroups'][0]['groupId'] = 'reassigned-group'
                    changed['queries'][1]['requiredEvidenceGroups'][0]['groupId'] = 'group-1'
                with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'differ from frozen'):
                    aggregate_groups_v4(changed, results, raw_reference_bytes=raw)
                with self.subTest(bytes=change), self.assertRaisesRegex(ValueError, 'file digest'):
                    aggregate_groups_v4(changed, results, raw_reference_bytes=json.dumps(changed).encode())
            with self.assertRaisesRegex(ValueError, 'file digest'):
                aggregate_groups_v4(refs, results, raw_reference_bytes=raw + b' ')
            # Even under the synthetic pin, matching invented count summaries
            # cannot substitute for exact case/group membership.
            renamed = copy.deepcopy(results)
            renamed[0]['caseId'] = 'invented-case'
            with self.assertRaises(ValueError):
                aggregate_groups_v4(refs, renamed, raw_reference_bytes=raw)
        with self.assertRaises(TypeError):
            aggregate_groups_v4(refs, results)

    def test_zero_packet_group_remains_in_positive_denominator(self):
        refs, results = self.fixture()
        results[1]['groups'][0].update(subsetCount=0, executionProvenance=[],
                                      completionRank=None, diagnosticCredit=False)
        self.assertEqual(aggregate_groups_generic_v4(refs, results)['semanticRecallAt8'], Fraction(2, 3))


if __name__ == '__main__':
    unittest.main()
