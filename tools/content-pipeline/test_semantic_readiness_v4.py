"""SYNTHETIC raw host records only; no model calls, new labels or acceptance."""
import copy
import hashlib
import json
import unittest
from unittest.mock import patch

import jsonschema

import test_execution_receipt_v4 as host_fixtures
import test_semantic_proof_v4 as content_fixtures
from execution_receipt_v4 import verify_execution_v4
from proof_schedule_v4 import canonical
from readiness import READER, JUDGE, reader_schema, judge_schema
from semantic_readiness_v4 import (THEMES, _cases, replay_readiness_v4,
                                   replay_holdout_readiness_v4)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class SyntheticReadinessTests(unittest.TestCase):
    def fixture(self, count=4, batch_size=3, mutate_answer=None, mutate_judge=None,
                negative_ready=False):
        data = content_fixtures.SemanticProofDiagnosticsTests().fixture(count)
        refs, packets = [], []
        for index in range(count):
            positive = index != count - 1
            group = copy.deepcopy(data['group'])
            group['mandatoryScope'].append({'id': 'nested-scope', 'text': 'SYNTHETIC nested engine/version qualifier.'})
            refs.append({'id': f'query-{index}', 'module': 'cloud',
                         'queryEn': f'Which SYNTHETIC deployment fact applies in case {index}?',
                         'answerable': positive, 'groups': [group] if positive else [],
                         'negativeReason': None if positive else 'SYNTHETIC private account facts missing.',
                         'principalFactDeploymentTuples': [{'fact': 'SYNTHETIC principal label',
                                                            'deployment': 'SYNTHETIC label scope'}]})
            packets.append({'caseId': refs[-1]['id'], 'queryEn': refs[-1]['queryEn'],
                            'evidence': [data['evidence'][index]]})
        reference_hash = 'a' * 64
        cases = _cases(refs, packets, data['originals'], data['sources'], reference_hash)
        hosts, entries = [], []
        for ordinal, start in enumerate(range(0, len(cases), batch_size)):
            subset, labels = cases[start:start + batch_size], refs[start:start + batch_size]
            answers = []
            for case, label in zip(subset, labels):
                ready = label['answerable'] or negative_ready
                answer = {'id': case['id'], 'verdict': 'ready' if ready else 'needs_evidence',
                          'answer': 'SYNTHETIC answer.' if ready else '',
                          'scope': 'SYNTHETIC deployment scope.' if ready else '',
                          'supportingEvidenceIds': [case['evidence'][0]['evidenceId']] if ready else [],
                          'refusalReason': '' if ready else 'SYNTHETIC private account input missing.'}
                if mutate_answer:
                    mutate_answer(answer, case, label)
                answers.append(answer)
            judged = [{**case, 'answer': answer,
                       'referenceRequiredClaims': [
                           {'requiredFacts': [a['text'] for a in group['requiredFacts']],
                            'mandatoryScope': [a['text'] for a in group['mandatoryScope']]}
                           for group in label['groups']]}
                      for case, answer, label in zip(subset, answers, labels)]
            judgments = []
            for case, label, answer in zip(subset, labels, answers):
                judgment = {'id': case['id'], 'verdict': 'supported' if answer['verdict'] == 'ready'
                            else 'correct_refusal', 'reason': 'SYNTHETIC independent judgment.'}
                if mutate_judge:
                    mutate_judge(judgment, answer, label)
                judgments.append(judgment)
            for role, projection, result, schema in (
                    ('reader', subset, {'cases': answers}, reader_schema([c['id'] for c in subset])),
                    ('judge', judged, {'cases': judgments}, judge_schema([c['id'] for c in subset]))):
                host = host_fixtures.SyntheticReceiptTests()
                host.setUp()
                self.addCleanup(host.doCleanups)
                host.prompt = (READER if role == 'reader' else JUDGE) + canonical({'cases': projection})
                host.schema = json.dumps(schema, ensure_ascii=False, indent=2).encode('utf-8')
                host.result = b' \n' + json.dumps(result, ensure_ascii=False, indent=1).encode() + b'\n '
                host.invocation.update(inputHash=sha(host.prompt.encode()), schemaHash=sha(host.schema))
                host.execution.update(inputHash=sha(host.prompt.encode()), schemaHash=sha(host.schema),
                                      outputHash=sha(host.result), outputBytes=len(host.result))
                host.events[0]['thread_id'] = f'SYNTHETIC-readiness-{role}-{ordinal}'
                host.events[3]['item']['text'] = host.result.decode()
                host.write_fixture()
                entries.append({'role': role, 'batchOrdinal': ordinal,
                                'outputDirectory': str(host.output), 'trustedPins': host.pins})
                hosts.append(host)
        return {'references': refs, 'packets': packets, 'originals': data['originals'],
                'sources': data['sources'], 'reference_hash': reference_hash,
                'execution_pins': entries, 'batch_size': batch_size}, hosts

    def rewrite(self, args, host, index, *, result=None, prompt=None, events=None):
        if result is not None:
            host.result = b' \n' + json.dumps(result, ensure_ascii=False, indent=1).encode() + b'\n '
            host.execution.update(outputHash=sha(host.result), outputBytes=len(host.result))
            host.events[3]['item']['text'] = host.result.decode()
        if prompt is not None:
            host.prompt = prompt
            host.invocation['inputHash'] = host.execution['inputHash'] = sha(prompt.encode())
        if events is not None:
            host.events = events
        host.write_fixture()
        args['execution_pins'][index]['trustedPins'] = host.pins

    def reject(self, args, regex=None):
        errors = (ValueError, OSError, jsonschema.ValidationError, jsonschema.SchemaError)
        with self.assertRaisesRegex(errors, regex) if regex else self.assertRaises(errors):
            replay_readiness_v4(**args)

    def test_original_hashes_exact_membership_and_honest_authority(self):
        args, hosts = self.fixture()
        before = copy.deepcopy(args)
        result = replay_readiness_v4(**args)
        self.assertEqual(args, before)
        self.assertEqual((result['caseCount'], result['positiveCount'], result['negativeCount'],
                          result['negativeRefused'], result['falseRefusals'], result['unsupportedAccepted']),
                         (4, 3, 1, 1, 0, 0))
        self.assertEqual([p['rawResultSha256'] for p in result['executionProvenance']],
                         [sha(h.result) for h in hosts])
        self.assertEqual([p['caseIds'] for p in result['executionProvenance']],
                         [[d['opaqueId'] for d in result['decisions'][:3]]] * 2 +
                         [[result['decisions'][3]['opaqueId']]] * 2)
        self.assertEqual(result['executionAuthenticity'], 'HOST_RECORDS_ONLY')
        self.assertEqual(result['semanticTruth'], 'UNVERIFIED')
        for flag in ('rawExecutionVerified', 'sourceReviewVerified', 'capabilityVerified',
                     'freshLabelsVerified', 'releaseAuthorized'):
            self.assertIs(result[flag], False)
        self.assertIs(result['rawReceiptIntegrityVerified'], True)

    def test_reader_whitelist_and_judge_complete_texts_no_anchors_or_optional(self):
        args, hosts = self.fixture()
        readers = [json.loads(h.prompt[len(READER):]) for h in hosts[::2]]
        judges = [json.loads(h.prompt[len(JUDGE):]) for h in hosts[1::2]]
        for batch in readers:
            for case in batch['cases']:
                self.assertEqual(set(case), {'id', 'query', 'queryPlan', 'evidence'})
                self.assertEqual(set(case['queryPlan']), {'queryHash', 'forms', 'droppedFacetCount', 'fallbackReason'})
                self.assertNotIn('SYNTHETIC principal label', canonical(case))
                self.assertNotIn('Synthetic fact', canonical(case))
                self.assertNotIn('unused', canonical(case))
        for case in judges[0]['cases']:
            self.assertEqual(set(case), {'id', 'query', 'queryPlan', 'evidence', 'answer', 'referenceRequiredClaims'})
            self.assertEqual(case['referenceRequiredClaims'][0],
                             {'requiredFacts': ['Synthetic fact'],
                              'mandatoryScope': ['Synthetic scope', 'SYNTHETIC nested engine/version qualifier.']})
            self.assertNotIn('unused', canonical(case))
        # DEV classification/provenance metadata may exist without ever entering a reader prompt.
        for index, row in enumerate(args['references']):
            row['originalCasePointer'] = f'/queries/{index}'
        replay_readiness_v4(**args)

    def test_leaked_rubric_and_missing_mandatory_scope_prompt_reject(self):
        for stage in ('reader', 'judge'):
            args, hosts = self.fixture()
            index = 0 if stage == 'reader' else 1
            host = hosts[index]
            instructions = READER if stage == 'reader' else JUDGE
            projection = json.loads(host.prompt[len(instructions):])
            if stage == 'reader':
                projection['cases'][0]['groups'] = args['references'][0]['groups']
            else:
                projection['cases'][0]['referenceRequiredClaims'][0]['mandatoryScope'].pop()
            self.rewrite(args, host, index, prompt=instructions + canonical(projection))
            with self.subTest(stage=stage):
                self.reject(args, 'binding changed')

    def test_ready_empty_missing_duplicate_cross_case_support_and_blank_scope_reject(self):
        for change in ('empty', 'missing', 'duplicate', 'cross-case', 'blank-answer', 'blank-scope'):
            def mutate(answer, case, _label):
                if answer['verdict'] != 'ready':
                    return
                if change == 'empty':
                    answer['supportingEvidenceIds'] = []
                elif change == 'missing':
                    del answer['supportingEvidenceIds']
                elif change == 'duplicate':
                    answer['supportingEvidenceIds'] *= 2
                elif change == 'cross-case':
                    other_id = int(case['evidence'][0]['chunkId'], 16) % 4 + 1
                    answer['supportingEvidenceIds'] = ['ev-' + f'{other_id:032x}']
                elif change == 'blank-answer':
                    answer['answer'] = ' '
                else:
                    answer['scope'] = ' '
            args, _ = self.fixture(mutate_answer=mutate)
            with self.subTest(change=change):
                self.reject(args)

    def test_nonempty_refusal_reason_and_conflicting_judge_states_reject(self):
        def blank(answer, _case, label):
            if not label['answerable']:
                answer['refusalReason'] = ' '
        args, _ = self.fixture(mutate_answer=blank)
        self.reject(args, 'refusal reason')
        for target in ('ready', 'needs_evidence'):
            def conflicting(judgment, answer, _label):
                if answer['verdict'] == target:
                    judgment['verdict'] = 'correct_refusal' if target == 'ready' else 'supported'
            args, _ = self.fixture(mutate_judge=conflicting)
            self.reject(args, 'states conflict')

    def test_wrong_deployment_is_also_unsupported_and_false_refusals_count(self):
        def refuse(answer, _case, label):
            if label['id'] == 'query-0':
                answer.update(verdict='needs_evidence', answer='', scope='', supportingEvidenceIds=[],
                              refusalReason='SYNTHETIC missing input.')
        def judgment(row, answer, label):
            if label['id'] == 'query-0':
                row['verdict'] = 'unnecessary_refusal'
            elif answer['verdict'] == 'ready':
                row['verdict'] = 'wrong_deployment'
        args, _ = self.fixture(mutate_answer=refuse, mutate_judge=judgment)
        result = replay_readiness_v4(**args)
        self.assertEqual((result['falseRefusals'], result['wrongDeploymentAccepted'],
                          result['unsupportedAccepted'], result['negativeRefused']), (1, 2, 2, 1))

    def test_negative_ready_is_unsupported_even_when_judge_says_supported(self):
        args, _ = self.fixture(negative_ready=True)
        result = replay_readiness_v4(**args)
        self.assertEqual((result['negativeCount'], result['negativeRefused'], result['unsupportedAccepted']), (1, 0, 1))
        self.assertEqual(result['decisions'][-1]['judgment']['verdict'], 'supported')

    def test_negative_refusal_with_unnecessary_judgment_is_not_successful(self):
        def unnecessary(judgment, _answer, label):
            if not label['answerable']:
                judgment['verdict'] = 'unnecessary_refusal'
        args, _ = self.fixture(mutate_judge=unnecessary)
        report = replay_readiness_v4(**args)
        self.assertEqual(report['negativeRefused'], 0)
        self.assertTrue(report['decisions'][-1]['refused'])

    def test_raw_result_edits_partial_events_and_schema_whitespace_reject(self):
        args, hosts = self.fixture()
        (hosts[0].output / 'result.json').write_bytes(hosts[0].result + b' ')
        self.reject(args, 'raw hash mismatch')
        args, hosts = self.fixture()
        self.rewrite(args, hosts[0], 0, events=hosts[0].events[:-1])
        self.reject(args, 'Event lifecycle order')
        args, hosts = self.fixture()
        hosts[0].schema += b' '
        hosts[0].invocation['schemaHash'] = hosts[0].execution['schemaHash'] = sha(hosts[0].schema)
        self.rewrite(args, hosts[0], 0)
        self.reject(args, 'schema bytes changed')

    def test_missing_duplicate_reordered_and_extra_raw_case_results_reject(self):
        for change in ('missing', 'duplicate', 'reordered', 'unknown'):
            args, hosts = self.fixture()
            rows = json.loads(hosts[0].result)
            if change == 'missing':
                rows['cases'].pop()
            elif change == 'duplicate':
                rows['cases'][1] = copy.deepcopy(rows['cases'][0])
            elif change == 'reordered':
                rows['cases'].reverse()
            else:
                rows['cases'][0]['id'] = 'case-unknown'
            self.rewrite(args, hosts[0], 0, result=rows)
            with self.subTest(change=change):
                self.reject(args)

    def test_malformed_raw_records_reject_even_if_repinned(self):
        for malformed in (b'{"cases":', b'{"cases":[],"cases":[]}', b'{"cases":NaN}',
                          b'{"cases":"\\ud800"}'):
            args, hosts = self.fixture()
            hosts[0].result = malformed
            hosts[0].execution.update(outputHash=sha(malformed), outputBytes=len(malformed))
            hosts[0].events[3]['item']['text'] = malformed.decode()
            self.rewrite(args, hosts[0], 0)
            self.reject(args)

    def test_global_raw_call_reuse_across_batches_reject(self):
        args, hosts = self.fixture()
        hosts[2].events[0]['thread_id'] = hosts[0].events[0]['thread_id']
        self.rewrite(args, hosts[2], 2)
        self.reject(args, 'Reused actual call/workspace')

    def test_global_adapter_workspace_reuse_across_roles_and_batches_reject(self):
        for target in (1, 2):
            args, hosts = self.fixture()
            receipts = [verify_execution_v4(h.output, frozen_prompt=h.prompt,
                        frozen_schema_bytes=h.schema, trusted_pins=h.pins) for h in hosts]
            receipts[target]['workspaceId'] = receipts[0]['workspaceId']
            with patch('semantic_readiness_v4.verify_execution_v4', side_effect=receipts):
                self.reject(args, 'Reused actual call/workspace')

    def test_exact_registration_missing_duplicate_unknown_and_reused_outputs(self):
        args, _ = self.fixture()
        entries = args['execution_pins']
        variants = [entries[:-1], entries + [entries[0]],
                    [{**entries[0], 'role': 'other'}, *entries[1:]],
                    [{**entries[0], 'batchOrdinal': True}, *entries[1:]],
                    [{**entries[0], 'batchOrdinal': 99}, *entries[1:]],
                    [entries[0], {**entries[1], 'outputDirectory': entries[0]['outputDirectory']}, *entries[2:]],
                    [{**entries[0], 'PASS': True}, *entries[1:]]]
        for variant in variants:
            self.reject(dict(args, execution_pins=variant))

    def test_packet_missing_duplicate_case_changed_query_and_unexpected_fields(self):
        args, _ = self.fixture()
        packets = args['packets']
        variants = [packets[:-1], packets + [packets[0]],
                    [{**packets[0], 'queryEn': 'Changed original question?'}, *packets[1:]],
                    [{**packets[0], 'ranking': [1]}, *packets[1:]],
                    [{**packets[0], 'caseId': 'unknown'}, *packets[1:]]]
        for variant in variants:
            self.reject(dict(args, packets=variant))
        args['packets'].reverse()
        replay_readiness_v4(**args)

    def test_source_and_original_object_mutation_and_duplicate_chunks_reject(self):
        for change in ('source', 'chunk', 'offset', 'duplicate'):
            args, _ = self.fixture()
            chunk = args['packets'][0]['evidence'][0]
            if change == 'source':
                args['sources'][chunk['sourceId']]['text'] += 'changed'
            elif change == 'chunk':
                chunk['text'] += 'changed'
            elif change == 'offset':
                chunk['charEnd'] -= 1
                args['originals'][chunk['chunkId']] = copy.deepcopy(chunk)
            else:
                args['packets'][0]['evidence'].append(copy.deepcopy(chunk))
            self.reject(args)

    def test_sorted_chunk_projection_and_no_ranking_in_prompt(self):
        args, _ = self.fixture()
        args['packets'][0]['evidence'] += args['packets'][1]['evidence']
        cases = _cases(args['references'], args['packets'], args['originals'], args['sources'], args['reference_hash'])
        ids = [c['chunkId'] for c in cases[0]['evidence']]
        self.assertEqual(ids, sorted(ids))
        args['packets'][0]['evidence'].reverse()
        self.assertEqual(cases, _cases(args['references'], args['packets'], args['originals'],
                                     args['sources'], args['reference_hash']))

    def test_changed_batch_boundary_rejects_and_invalid_batch_sizes(self):
        args, _ = self.fixture(batch_size=2)
        self.assertEqual(len(replay_readiness_v4(**args)['executionProvenance']), 4)
        self.reject(dict(args, batch_size=3), 'binding changed|schema bytes changed')
        for size in (0, 4, True, 1.5):
            self.reject(dict(args, batch_size=size), 'Batch size')

    def test_reference_validation_missing_scopes_unknown_metadata_and_duplicates(self):
        for change in ('scope', 'metadata', 'duplicate-case', 'duplicate-group', 'negative-groups',
                       'positive-empty', 'negative-reason', 'boolean', 'atom-duplicate'):
            args, _ = self.fixture()
            row = args['references'][0]
            if change == 'scope':
                del row['groups'][0]['mandatoryScope']
            elif change == 'metadata':
                row['classification'] = 'hidden'
            elif change == 'duplicate-case':
                args['references'].append(copy.deepcopy(row))
            elif change == 'duplicate-group':
                row['groups'].append(copy.deepcopy(row['groups'][0]))
            elif change == 'negative-groups':
                args['references'][-1]['groups'] = row['groups']
            elif change == 'positive-empty':
                row['groups'] = []
            elif change == 'negative-reason':
                args['references'][-1]['negativeReason'] = ''
            elif change == 'boolean':
                row['answerable'] = 1
            else:
                row['groups'][0]['mandatoryScope'][0]['id'] = row['groups'][0]['requiredFacts'][0]['id']
            self.reject(args)

    def test_empty_packet_can_be_refused_but_never_supports_ready(self):
        args, hosts = self.fixture(count=1)
        args['packets'][0]['evidence'] = []
        case = _cases(args['references'], args['packets'], args['originals'], args['sources'], args['reference_hash'])[0]
        self.rewrite(args, hosts[0], 0, prompt=READER + canonical({'cases': [case]}))
        judged = {**case, 'answer': json.loads(hosts[0].result)['cases'][0], 'referenceRequiredClaims': []}
        self.rewrite(args, hosts[1], 1, prompt=JUDGE + canonical({'cases': [judged]}))
        self.assertEqual(replay_readiness_v4(**args)['negativeRefused'], 1)
        ready = copy.deepcopy(judged['answer'])
        ready.update(verdict='ready', answer='SYNTHETIC unsupported answer.', scope='SYNTHETIC scope.',
                     supportingEvidenceIds=['ev-' + 'f' * 32], refusalReason='')
        self.rewrite(args, hosts[0], 0, result={'cases': [ready]})
        self.reject(args, 'supporting evidence IDs')


class SyntheticHoldoutQuotaTests(unittest.TestCase):
    def references(self):
        group = {'id': 'fact-group', 'requiredFacts': [{'id': 'fact', 'text': 'SYNTHETIC fact.'}],
                 'mandatoryScope': []}
        return [{'id': f'{theme}-{i}', 'module': theme, 'queryEn': 'Which SYNTHETIC fact applies?',
                 'answerable': i < 4, 'groups': [copy.deepcopy(group)] if i < 4 else [],
                 'negativeReason': None if i < 4 else 'SYNTHETIC account input absent.',
                 'principalFactDeploymentTuples': [{'fact': 'SYNTHETIC fact.', 'deployment': 'SYNTHETIC scope.'}]}
                for theme in sorted(THEMES) for i in range(5)]

    def test_forty_thirtytwo_eight_themes_checked_before_replay(self):
        refs = self.references()
        with patch('semantic_readiness_v4.replay_readiness_v4', return_value='SYNTHETIC sentinel') as replay:
            self.assertEqual(replay_holdout_readiness_v4(refs, [], {}, {}, reference_hash='a' * 64,
                                                        execution_pins=[]), 'SYNTHETIC sentinel')
            replay.assert_called_once()
        for change in ('missing', 'theme', 'class', 'adapted', 'principal'):
            refs = self.references()
            if change == 'missing':
                refs.pop()
            elif change == 'theme':
                refs[0]['module'] = 'invented'
            elif change == 'class':
                refs[0].update(answerable=False, groups=[], negativeReason='SYNTHETIC missing.')
            elif change == 'adapted':
                refs[0]['originalCasePointer'] = '/queries/0'
            else:
                del refs[0]['principalFactDeploymentTuples']
            with patch('semantic_readiness_v4.replay_readiness_v4', side_effect=AssertionError('no raw reads')):
                with self.subTest(change=change), self.assertRaises(ValueError):
                    replay_holdout_readiness_v4(refs, [], {}, {}, reference_hash='a' * 64, execution_pins=[])


if __name__ == '__main__':
    unittest.main()
