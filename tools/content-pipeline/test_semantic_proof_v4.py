"""Synthetic metadata/content fixtures only: no real receipts, labels or authority."""
import copy
import hashlib
import unittest

from proof_schedule_v4 import subsets
from semantic_proof_v4 import inspect_group


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


class SemanticProofDiagnosticsTests(unittest.TestCase):
    def fixture(self, count=2, per_batch=4):
        group = {'id': 'group-one', 'requiredFacts': [{'id': 'fact', 'text': 'Synthetic fact'}],
                 'mandatoryScope': [{'id': 'scope', 'text': 'Synthetic scope'}],
                 'optionalFacts': ['unused'], 'anchorSets': ['unused']}
        evidence, sources = [], {}
        for rank in range(count):
            text = f'😀 Synthetic evidence {rank}. Deployment scope.'
            sid, cid = digest(f'synthetic-source-{rank}'), f'{count - rank:032x}'
            source = {'sourceId': sid, 'sourceVersion': digest(text), 'text': text}
            sources[sid] = source
            evidence.append({'id': f'synthetic-{rank}', 'index': rank, 'heading': None, 'page': None,
                             'chunkId': cid, 'evidenceId': 'ev-' + cid, 'sourceId': sid,
                             'sourceVersion': digest(text), 'text': text, 'charStart': 0,
                             'charEnd': len(text), 'textSha256': digest(text),
                             'url': 'https://example.invalid/synthetic', 'title': 'Synthetic'})
        originals = {chunk['chunkId']: copy.deepcopy(chunk) for chunk in evidence}
        members = subsets(originals)
        bindings = {key: digest(key) for key in ('packetHash', 'referenceHash', 'protocolHash')}
        bindings['batches'] = [{'projectionHash': digest(f'synthetic-projection-{start}'),
                                'subsets': [list(ids) for ids in members[start:start + per_batch]]}
                               for start in range(0, len(members), per_batch)]
        roles = []
        for role in ('one', 'two'):
            checks = []
            for index, batch in enumerate(bindings['batches']):
                artifact = {'path': 'SYNTHETIC-NONEXISTENT', 'sha256': digest('synthetic-artifact')}
                execution = {'kind': 'workbench', 'workspaceId': f'synthetic-workspace-{role}-{index}',
                             'callId': f'synthetic-call-{role}-{index}', 'model': 'gpt-6-sol',
                             'effort': 'high', 'auth': 'codex-subscription', 'completed': True, 'toolEvents': 0,
                             'requestHash': digest('synthetic-request'), 'responseHash': digest('synthetic-response'),
                             **{key: copy.deepcopy(artifact) for key in ('rawEvents', 'sourceReview', 'denialReceipt')}}
                checks.append({'schemaVersion': 4, 'cycleId': 'aws-basics-v4-1', 'caseId': 'case-one',
                               'groupId': group['id'], 'checkerId': role, 'execution': execution,
                               **{key: value for key, value in bindings.items() if key != 'batches'},
                               'projectionHash': batch['projectionHash'],
                               'subsets': [{'chunkIds': ids.copy(), 'verdict': 'UNKNOWN', 'coverage': [],
                                            'deploymentConsistent': 'UNKNOWN', 'reason': 'Synthetic unknown'}
                                           for ids in batch['subsets']]})
            roles.append(checks)
        return {'case_id': 'case-one', 'group': group, 'evidence': evidence, 'originals': originals,
                'sources': sources, 'checks_one': roles[0], 'checks_two': roles[1], 'bindings': bindings}

    def decision(self, data, role, ids):
        return next(item for check in data['checks_' + role] for item in check['subsets']
                    if item['chunkIds'] == sorted(ids))

    def quote(self, data, cid):
        chunk = data['originals'][cid]
        return {key: chunk[key] for key in ('sourceId', 'sourceVersion', 'chunkId', 'evidenceId')} | {
            'sourceStart': chunk['charStart'], 'sourceEnd': chunk['charEnd'], 'quote': chunk['text']}

    def pass_subset(self, data, ids, roles=('one', 'two'), scope_cid=None):
        for role in roles:
            decision = self.decision(data, role, ids)
            decision.update(verdict='PASS', deploymentConsistent='YES', reason='Synthetic claim')
            decision['coverage'] = [{'atomId': atom, 'quotes': [self.quote(data, cid)], 'reason': 'Synthetic support'}
                                    for atom, cid in (('fact', ids[0]), ('scope', scope_cid or ids[0]))]

    def test_rank_two_singleton_pass_with_unknown_prefixes(self):
        data = self.fixture(3)
        cid = data['evidence'][1]['chunkId']
        self.pass_subset(data, [cid])
        before = copy.deepcopy(data)
        report = inspect_group(**data)
        self.assertEqual((2, [cid], 7), (report['completionRank'], report['witness'], report['subsetCount']))
        self.assertEqual(1, report['creditedSubsetCount'])
        self.assertEqual(before, data)
        self.assertFalse(report['releaseAuthorized'])
        self.assertFalse(report['rawExecutionVerified'])
        self.assertEqual('UNVERIFIED', report['semanticTruth'])
        self.assertNotIn('semanticTrue', report)

    def test_required_scope_only_at_original_rank_eight(self):
        data = self.fixture(8)
        first, last = data['evidence'][0]['chunkId'], data['evidence'][7]['chunkId']
        self.pass_subset(data, [first, last], scope_cid=last)
        report = inspect_group(**data)
        self.assertEqual(8, report['completionRank'])
        self.assertEqual(sorted([first, last]), report['witness'])
        self.assertEqual(255, report['subsetCount'])

    def test_tie_uses_lexicographic_membership_not_shortest_subset(self):
        data = self.fixture(2)
        first, second = (chunk['chunkId'] for chunk in data['evidence'])
        self.pass_subset(data, [second])
        self.pass_subset(data, [first, second])
        self.assertEqual(min([second], sorted([first, second])), inspect_group(**data)['witness'])

    def test_both_checker_disagreement_no_credit(self):
        for verdict in ('UNKNOWN', 'FAIL'):
            data = self.fixture()
            cid = data['evidence'][1]['chunkId']
            self.pass_subset(data, [cid], roles=('one',))
            self.decision(data, 'two', [cid])['verdict'] = verdict
            report = inspect_group(**data)
            self.assertIsNone(report['completionRank'])
            self.assertTrue(any(item['disagreement'] for item in report['subsets']))

    def test_different_memberships_never_union_across_checkers(self):
        data = self.fixture()
        self.pass_subset(data, [data['evidence'][0]['chunkId']], roles=('one',))
        self.pass_subset(data, [data['evidence'][1]['chunkId']], roles=('two',))
        self.assertFalse(inspect_group(**data)['diagnosticCredit'])

    def test_missing_duplicate_or_extra_subset_rejected(self):
        for change in ('missing', 'duplicate', 'unknown'):
            data = self.fixture()
            decisions = data['checks_one'][0]['subsets']
            if change == 'missing':
                decisions.pop()
            elif change == 'duplicate':
                decisions.append(copy.deepcopy(decisions[0]))
            else:
                decisions[0]['chunkIds'] = ['f' * 32]
            with self.subTest(change=change), self.assertRaises(ValueError):
                inspect_group(**data)

    def test_wrong_occurrence_of_repeated_text_rejected(self):
        data = self.fixture(1)
        chunk = data['evidence'][0]
        text = 'repeat! gap repeat!'
        source = data['sources'][chunk['sourceId']]
        source.update(text=text, sourceVersion=digest(text))
        chunk.update(text='repeat!', charStart=12, charEnd=19, textSha256=digest('repeat!'), sourceVersion=digest(text))
        # The actual repeated occurrence starts at 12 and ends at 19.
        self.assertEqual('repeat!', text[12:19])
        data['originals'][chunk['chunkId']] = copy.deepcopy(chunk)
        self.pass_subset(data, [chunk['chunkId']])
        quote = data['checks_one'][0]['subsets'][0]['coverage'][0]['quotes'][0]
        quote.update(sourceStart=0, sourceEnd=7)
        with self.assertRaisesRegex(ValueError, 'outside original chunk'):
            inspect_group(**data)

    def test_quote_offset_identity_text_and_membership_tampering(self):
        mutations = {'sourceStart': 1, 'sourceEnd': True, 'sourceId': 'f' * 64,
                     'sourceVersion': 'f' * 64, 'evidenceId': 'ev-' + 'f' * 32,
                     'chunkId': 'f' * 32, 'quote': 'fabricated'}
        for field, value in mutations.items():
            data = self.fixture(1)
            self.pass_subset(data, [data['evidence'][0]['chunkId']])
            data['checks_one'][0]['subsets'][0]['coverage'][0]['quotes'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                inspect_group(**data)
        data = self.fixture(2)
        first, second = [c['chunkId'] for c in data['evidence']]
        self.pass_subset(data, [first])
        self.decision(data, 'one', [first])['coverage'][0]['quotes'][0] = self.quote(data, second)
        with self.assertRaises(ValueError):
            inspect_group(**data)

    def test_unicode_scalar_offsets_and_no_surrogates(self):
        data = self.fixture(1)
        cid = data['evidence'][0]['chunkId']
        self.pass_subset(data, [cid])
        for role in ('one', 'two'):
            for coverage in self.decision(data, role, [cid])['coverage']:
                coverage['quotes'][0].update(sourceStart=0, sourceEnd=1, quote='😀')
        self.assertEqual(1, inspect_group(**data)['completionRank'])
        data['sources'][data['evidence'][0]['sourceId']]['text'] = '\ud800'
        with self.assertRaises(UnicodeError):
            inspect_group(**data)

    def test_source_chunk_hash_offsets_full_object_and_budget_tampering(self):
        for field, value in (('sourceVersion', 'f' * 64), ('textSha256', 'f' * 64),
                             ('charStart', True), ('charEnd', 1), ('text', 'changed'), ('title', 'changed')):
            data = self.fixture(1)
            data['evidence'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                inspect_group(**data)
        for field, value in (('text', 'changed'), ('sourceVersion', 'f' * 64), ('sourceId', 'f' * 64)):
            data = self.fixture(1)
            data['sources'][data['evidence'][0]['sourceId']][field] = value
            with self.subTest(source=field), self.assertRaises(ValueError):
                inspect_group(**data)
        data = self.fixture(1)
        chunk = data['evidence'][0]
        text = 'x' * 12001
        chunk.update(text=text, charEnd=len(text), textSha256=digest(text), sourceVersion=digest(text))
        data['originals'][chunk['chunkId']] = copy.deepcopy(chunk)
        data['sources'][chunk['sourceId']].update(text=text, sourceVersion=digest(text))
        with self.assertRaisesRegex(ValueError, '12000'):
            inspect_group(**data)
        with self.assertRaises(ValueError):
            inspect_group(**self.fixture(9))

    def test_distinct_call_and_workspace_ids_within_and_across_roles(self):
        for field in ('callId', 'workspaceId'):
            for across_roles in (True, False):
                data = self.fixture(3, per_batch=2)
                target = data['checks_two'][0] if across_roles else data['checks_one'][1]
                target['execution'][field] = data['checks_one'][0]['execution'][field]
                with self.subTest(field=field, across_roles=across_roles), self.assertRaises(ValueError):
                    inspect_group(**data)
            data = self.fixture(1)
            data['checks_two'][0]['execution'][field] = ' '
            with self.assertRaises(ValueError):
                inspect_group(**data)

    def test_wrong_constants_execution_shapes_and_binding_identity(self):
        for field, value in (('kind', 'cli'), ('model', 'other'), ('effort', 'low'),
                             ('auth', 'api-key'), ('completed', 1), ('toolEvents', False), ('toolEvents', 1)):
            data = self.fixture(1)
            data['checks_one'][0]['execution'][field] = value
            with self.subTest(execution=field), self.assertRaises(ValueError):
                inspect_group(**data)
        for field, value in (('schemaVersion', True), ('schemaVersion', 3), ('cycleId', 'wrong'),
                             ('caseId', 'other'), ('groupId', 'other'), ('checkerId', 'two'),
                             ('packetHash', 'f' * 64), ('referenceHash', 'f' * 64),
                             ('protocolHash', 'f' * 64), ('projectionHash', 'f' * 64)):
            data = self.fixture(1)
            data['checks_one'][0][field] = value
            with self.subTest(check=field), self.assertRaises(ValueError):
                inspect_group(**data)
        for target in ('execution', 'check', 'coverage', 'quote'):
            data = self.fixture(1)
            self.pass_subset(data, [data['evidence'][0]['chunkId']])
            record = data['checks_one'][0]
            objects = {'execution': record['execution'], 'check': record,
                       'coverage': record['subsets'][0]['coverage'][0],
                       'quote': record['subsets'][0]['coverage'][0]['quotes'][0]}
            objects[target]['unexpected'] = True
            with self.subTest(shape=target), self.assertRaises(ValueError):
                inspect_group(**data)

    def test_all_required_atoms_conjoined_and_no_deployment_credit(self):
        for alteration in ('scope-missing', 'fact-missing', 'duplicate', 'extra', 'no-quotes', 'deployment'):
            data = self.fixture(1)
            self.pass_subset(data, [data['evidence'][0]['chunkId']])
            decision = data['checks_one'][0]['subsets'][0]
            if alteration == 'deployment':
                decision['deploymentConsistent'] = 'NO'
                self.assertIsNone(inspect_group(**data)['completionRank'])
                continue
            if alteration.endswith('missing'):
                decision['coverage'].pop(1 if alteration == 'scope-missing' else 0)
            elif alteration == 'duplicate':
                decision['coverage'].append(copy.deepcopy(decision['coverage'][0]))
            elif alteration == 'extra':
                decision['coverage'][0]['atomId'] = 'optional'
            else:
                decision['coverage'][0]['quotes'] = []
            with self.subTest(alteration=alteration), self.assertRaises(ValueError):
                inspect_group(**data)

    def test_host_batch_plan_projection_and_assignment_are_exact(self):
        for alteration in ('reordered', 'changed-plan', 'missing-plan', 'duplicate-plan', 'extra-hash'):
            data = self.fixture(3, per_batch=2)
            if alteration == 'reordered':
                data['checks_one'].reverse()
            elif alteration == 'changed-plan':
                data['bindings']['batches'][0]['subsets'].reverse()
            elif alteration == 'missing-plan':
                data['bindings']['batches'].pop()
            elif alteration == 'duplicate-plan':
                data['bindings']['batches'][0]['subsets'].append(data['bindings']['batches'][0]['subsets'][0])
            else:
                data['bindings']['projectionHash'] = digest('extra')
            with self.subTest(alteration=alteration), self.assertRaises(ValueError):
                inspect_group(**data)

    def test_single_batch_binding_shorthand(self):
        data = self.fixture(3, per_batch=255)
        batches = data['bindings'].pop('batches')
        data['bindings']['projectionHash'] = batches[0]['projectionHash']
        self.pass_subset(data, [data['evidence'][1]['chunkId']])
        self.assertEqual(2, inspect_group(**data)['completionRank'])

    def test_group_and_packet_identity_shape(self):
        for alteration in ('duplicate-atom', 'bad-case', 'bad-group', 'empty-facts', 'duplicate-chunk', 'missing-source'):
            data = self.fixture(1)
            if alteration == 'duplicate-atom':
                data['group']['mandatoryScope'][0]['id'] = 'fact'
            elif alteration == 'bad-case':
                data['case_id'] = 'Invalid'
            elif alteration == 'bad-group':
                data['group']['id'] = 'Invalid'
            elif alteration == 'empty-facts':
                data['group']['requiredFacts'] = []
            elif alteration == 'duplicate-chunk':
                data['evidence'].append(copy.deepcopy(data['evidence'][0]))
            else:
                data['sources'].clear()
            with self.subTest(alteration=alteration), self.assertRaises(ValueError):
                inspect_group(**data)

    def test_zero_evidence_has_no_completion_credit_or_calls(self):
        data = self.fixture(0)
        report = inspect_group(**data)
        self.assertEqual((None, [], 0, False), (report['completionRank'], report['witness'],
                                              report['subsetCount'], report['diagnosticCredit']))
        self.assertFalse(report['releaseAuthorized'])
        data['bindings']['projectionHash'] = digest('extra')
        with self.assertRaises(ValueError):
            inspect_group(**data)

    def test_no_caller_authority_override_parameter(self):
        data = self.fixture(1)
        with self.assertRaises(TypeError):
            inspect_group(**data, releaseAuthorized=True)


if __name__ == '__main__':
    unittest.main()
