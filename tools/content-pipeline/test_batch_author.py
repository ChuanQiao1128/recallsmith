"""No models: fake only transport, exercise real packet/card/review/receipt validators."""
import copy
import json
import shutil
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import batch_author as b
from pipeline import canonical, digest, load, save
import test_author as fixtures


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.args = SimpleNamespace(root=self.root, corpus_root=self.root / 'corpus', dotnet=Path('/never-run'))
        _, _, packet = fixtures.AuthorTests().prepared(self.root)
        self.uids = [f'uid-{i:03}' for i in range(337)]
        self.catalogue = {'baselineCount': 334, 'finalCount': 337, 'goals': [
            {'stableUid': uid, 'retrievalQueryEn': 'service capability'} for uid in self.uids]}
        self.catalogue['curriculumHash'] = digest(canonical(self.catalogue))
        save(self.root / 'curriculum/catalogue.json', self.catalogue)
        save(self.root / 'curriculum/existing-cards.json', {'cards': [{'stableUid': uid} for uid in self.uids[:334]]})
        self.config = {'starters': self.uids[:5], 'domainCanary': dict(zip(b.DOMAIN_KEYS, self.uids[5:9])),
                       'edgeCanary': dict(zip(b.EDGE_KEYS, self.uids[9:12])), 'legacyUids': self.uids[:334]}
        for goal in self.catalogue['goals']:
            value = copy.deepcopy(packet)
            value.update(goal=goal, curriculumHash=self.catalogue['curriculumHash'])
            value['packetHash'] = digest(canonical({k: v for k, v in value.items() if k != 'packetHash'}))
            save(b.uid_path(self.root, goal['stableUid'], 'packet.json'), value)
        self.plan = b.checked_plan(self.root, self.args.corpus_root, self.catalogue, self.config, create=True)
        self.batch = self.plan['batches'][0]
        self.calls = []
        self.bad_quote = set()
        self.false_check = set()
        self.persistent = set()

    def transport(self, args, folder, stage, attempt, prompt, schema):
        self.calls.append((stage, attempt))
        self.assertEqual(1, attempt)
        rows = json.loads(prompt.split('\n')[-1])['cards']
        cards = []
        for row in rows:
            uid = row['packet']['goal']['stableUid']
            if 'review' in stage:
                card = {'conceptId': uid, 'verdict': 'pass', 'checks': {k: True for k in b.author.CHECKS},
                        'claimChecks': [{'field': field, 'verdict': 'supported', 'reason': 'supported'}
                                        for field in b.author.FIELDS], 'findings': []}
                if (stage == 'review' and uid in self.false_check) or uid in self.persistent:
                    card['checks']['necessaryScope'] = False
                    # A stated pass with a false check is still a failed independent review.
            else:
                _, card = fixtures.fixture()
                card['conceptId'] = uid
                if stage == 'generate' and uid in self.bad_quote:
                    card['claims'][0]['evidence'][0]['quote'] = 'invented quote'
            cards.append(card)
        value = {'cards': cards}
        output = folder / (stage + '-1')
        b.author.freeze(folder / (stage + '-1.prompt.txt'), prompt)
        text = json.dumps(schema, ensure_ascii=False, indent=2)
        b.author.freeze(folder / (stage + '-1.schema.json'), text)
        save(output / 'result.json', value)
        (output / 'events.jsonl').write_text('a fresh completed CLI request\n')
        (output / 'stderr.log').write_text('')
        save(output / 'execution.json', {'success': True, 'exitCode': 0, 'attemptDirectory': str(output),
            'inputHash': digest(prompt), 'schemaHash': digest(text.strip()),
            'outputHash': digest((output / 'result.json').read_bytes()),
            'eventsHash': digest((output / 'events.jsonl').read_bytes()), 'stderrHash': digest(''),
            'requestedModel': 'gpt-6-sol', 'reportedModel': None})
        save(output / 'invocation.json', {'requestedModel': 'gpt-6-sol', 'requestedEffort': 'high',
            'auth': 'chatgpt', 'inputHash': digest(prompt), 'schemaHash': digest(text.strip()),
            'args': ['exec', '--ephemeral', '-C', str(self.root / 'model-workspaces' / (folder.name + '-' + stage))]})
        return value

    def run_batch(self):
        with patch.object(b.author, 'invoke', side_effect=self.transport):
            return b.run_batch(self.args, self.plan, self.batch, self.catalogue)

    def test_first12_fixed_set_unique_full_map_and_old334_coverage(self):
        self.assertEqual(self.uids[:12], [u for group in self.plan['batches'][:3] for u in group['uids']])
        self.assertEqual(337, len({u for batch in self.plan['batches'] for u in batch['uids']}))
        self.assertTrue(all(1 <= len(batch['uids']) <= 5 for batch in self.plan['batches']))
        result = b.summary(self.root, self.args.corpus_root, self.catalogue)
        self.assertEqual(('INCOMPLETE', 337, 334, 0),
                         (result['verdict'], result['total'], result['old334Total'], result['verified']))

    def test_plan_change_cross_batch_duplicate_and_second_namespace_rejected(self):
        changed = copy.deepcopy(self.plan)
        changed['batches'][1]['uids'][0] = self.uids[0]
        save(self.root / b.PLAN, changed)
        with self.assertRaisesRegex(ValueError, 'plan'):
            b.checked_plan(self.root, self.args.corpus_root, self.catalogue)
        save(self.root / b.PLAN, self.plan)
        config = copy.deepcopy(self.config)
        config['starters'][0] = self.uids[20]
        with self.assertRaisesRegex(ValueError, 'plan'):
            b.checked_plan(self.root, self.args.corpus_root, self.catalogue, config)
        (self.root / 'authoring' / self.uids[0] / 'generate-1').mkdir()
        with self.assertRaisesRegex(ValueError, 'namespace'):
            b.checked_plan(self.root, self.args.corpus_root, self.catalogue)
        self.assertEqual([], self.calls)

    def test_unknown_any_stage_blocks_every_new_call_in_batch(self):
        for stage in b.STAGES:
            with self.subTest(stage=stage):
                directory = b.stage_path(self.root, 'b001', stage)
                directory.mkdir(parents=True)
                with patch.object(b.author, 'invoke') as invoke:
                    with self.assertRaisesRegex(ValueError, 'Unknown/incomplete'):
                        b.run_batch(self.args, self.plan, self.batch, self.catalogue)
                    invoke.assert_not_called()
                directory.rmdir()

    def test_transport_failure_is_unknown_and_never_retried(self):
        with patch.object(b.author, 'invoke', side_effect=RuntimeError('quota/auth/unknown')) as invoke:
            with self.assertRaises(RuntimeError):
                b.run_batch(self.args, self.plan, self.batch, self.catalogue)
            self.assertEqual(1, invoke.call_count)
            with self.assertRaisesRegex(ValueError, 'Unknown/incomplete'):
                b.run_batch(self.args, self.plan, self.batch, self.catalogue)
            self.assertEqual(1, invoke.call_count)

    def test_partial_repair_preserves_initial_pass_and_reviews_only_failed_subset(self):
        self.bad_quote = {self.uids[1]}
        self.false_check = {self.uids[2]}
        result = self.run_batch()
        self.assertEqual('PASS', result['verdict'])
        self.assertEqual([('generate', 1), ('review', 1), ('repair-generate', 1), ('repair-review', 1)], self.calls)
        auth = load(self.root / 'authoring-batches/b001/repair-authorization.json')
        self.assertEqual(self.uids[1:3], auth['uids'])
        initial = load(b.stage_path(self.root, 'b001', 'generate') / 'result.json')['cards'][0]
        candidate, review, meta = b.verify_record(self.root, self.args.corpus_root, self.catalogue, self.uids[0])
        self.assertEqual(initial, candidate)
        self.assertEqual({'initial': 1, 'repair': 0, 'limit': 2}, meta['budget'])
        self.assertIsNone(meta['reportedReviewModel'])
        for uid in self.uids[1:3]:
            _, _, meta = b.verify_record(self.root, self.args.corpus_root, self.catalogue, uid)
            self.assertEqual(1, meta['budget']['repair'])
        initial_review = load(b.stage_path(self.root, 'b001', 'review') / 'result.json')['cards']
        repair_review = load(b.stage_path(self.root, 'b001', 'repair-review') / 'result.json')['cards']
        self.assertNotIn(self.uids[1], {x['conceptId'] for x in initial_review})
        self.assertEqual(set(self.uids[1:3]), {x['conceptId'] for x in repair_review})
        before = list(self.calls)
        self.assertEqual('PASS', self.run_batch()['verdict'])
        self.assertEqual(before, self.calls)

    def test_only_one_repair_quarantines_actual_failed_uid_no_third_generation(self):
        self.persistent = {self.uids[0]}
        result = self.run_batch()
        self.assertEqual('INCOMPLETE', result['verdict'])
        self.assertEqual([self.uids[0]], result['failed'])
        self.assertEqual(4, len(self.calls))
        self.assertEqual(result, self.run_batch())
        self.assertEqual(4, len(self.calls))
        quarantine = load(self.root / 'authoring-batches/b001/quarantine.json')
        self.assertEqual([self.uids[0]], quarantine['failedUids'])
        with self.assertRaisesRegex(ValueError, 'quarantined'):
            b.verify_record(self.root, self.args.corpus_root, self.catalogue, self.uids[0])
        self.assertEqual('PASS', b.verify_record(self.root, self.args.corpus_root, self.catalogue, self.uids[1])[2]['verdict'])

    def test_percard_object_and_hash_tamper_does_not_forge_original_common_result(self):
        self.run_batch()
        target = b.uid_path(self.root, self.uids[0], 'candidate.json')
        candidate = load(target)
        candidate['en']['answer'] = 'A changed answer.'
        save(target, candidate)
        verified = b.uid_path(self.root, self.uids[0], 'verified.json')
        record = load(verified)
        record['candidateObjectHash'] = b.object_hash(candidate)
        save(verified, record)
        with self.assertRaisesRegex(ValueError, 'binding changed'):
            b.verify_record(self.root, self.args.corpus_root, self.catalogue, self.uids[0])

    def test_rehashed_review_prompt_tamper_still_rejected_against_packet_and_candidate(self):
        self.run_batch()
        target = b.stage_path(self.root, 'b001', 'review', '-1.prompt.txt')
        target.write_text(target.read_text() + '\nChange the independent judgment')
        new_hash = digest(target.read_text())
        output = b.stage_path(self.root, 'b001', 'review')
        for file in (output / 'execution.json', output / 'invocation.json',
                     b.stage_path(self.root, 'b001', 'review', '.intent.json')):
            value = load(file)
            value['inputHash'] = new_hash
            save(file, value)
        with self.assertRaisesRegex(ValueError, 'intent changed|prompt/schema changed'):
            b.verify_record(self.root, self.args.corpus_root, self.catalogue, self.uids[0])

    def test_repair_authorization_is_immutable_and_binds_actual_original_failures(self):
        self.false_check = {self.uids[0]}
        self.run_batch()
        target = self.root / 'authoring-batches/b001/repair-authorization.json'
        value = load(target)
        value['uids'].append(self.uids[1])
        save(target, value)
        with self.assertRaisesRegex(ValueError, 'authorization changed'):
            b.verify_record(self.root, self.args.corpus_root, self.catalogue, self.uids[0])
        with patch.object(b.author, 'invoke') as invoke:
            with self.assertRaisesRegex(ValueError, 'Frozen input changed'):
                b.run_batch(self.args, self.plan, self.batch, self.catalogue)
            invoke.assert_not_called()

    def test_wrapper_requires_exact_cardinality_uid_order_and_no_crossbatch(self):
        for value in ({'cards': []}, {'cards': [{'conceptId': self.uids[1]}]},
                      {'cards': [{'conceptId': self.uids[0]}], 'verdict': 'pass'}):
            with self.assertRaises(b.ContentFailure):
                b.unpack(value, [self.uids[0]])
        packet = load(b.uid_path(self.root, self.uids[8], 'packet.json'))
        with patch.object(b.author, 'invoke') as invoke:
            with self.assertRaisesRegex(ValueError, 'Cross-batch'):
                b.request(self.args, self.plan, self.batch, 'generate', [packet])
            invoke.assert_not_called()

    def test_full337_and_old334_are_verified_before_deck_pass(self):
        with patch.object(b.author, 'invoke', side_effect=self.transport):
            for batch in self.plan['batches']:
                self.assertEqual('PASS', b.run_batch(self.args, self.plan, batch, self.catalogue)['verdict'])
        report = b.summary(self.root, self.args.corpus_root, self.catalogue)
        self.assertEqual(('PASS', 337, 334, []),
                         (report['verdict'], report['verified'], report['old334Verified'], report['incompleteUids']))
        calls = len(self.calls)
        b.summary(self.root, self.args.corpus_root, self.catalogue)
        self.assertEqual(calls, len(self.calls))
        candidate = b.uid_path(self.root, self.uids[-1], 'candidate.json')
        value = load(candidate)
        value['status'] = 'insufficient_evidence'
        save(candidate, value)
        report = b.summary(self.root, self.args.corpus_root, self.catalogue)
        self.assertEqual('INCOMPLETE', report['verdict'])
        self.assertIn(self.uids[-1], report['incompleteUids'])

    def gate_fixture(self):
        # Full original-shaped SYNTHETIC receipts, not a mock of the verifier.
        from test_readiness import make_fixture
        reference_hash, cv, strategy, _ = make_fixture(self.root)
        retrieval_path = self.root / 'evaluation/results/holdout.json'
        readiness_path = self.root / 'evaluation/results/readiness-holdout.json'
        readiness = load(self.root / 'evaluation/results/readiness-holdout.json')
        save(readiness_path, readiness)
        measured = load(retrieval_path)['summaries'][strategy]
        metrics = {**readiness['metrics'], 'meanRecallAt8': measured['meanRecallAt8'],
                   'meanMrrAt8': measured['meanMrrAt8'], 'perThemeRecallAt8': measured['perTheme']}
        authority = load(self.root / 'run.json')['nodes']['A3-reference-review']
        originals = [('reference_review', self.root / authority['reportPath']),
                     ('holdout_retrieval', retrieval_path), ('holdout_readiness', readiness_path)]
        bindings = [{'kind': kind, 'path': str(file.relative_to(self.root)), 'sha256': digest(file.read_bytes())}
                    for kind, file in originals]
        from evaluate import retrieval_binding
        selection = load(self.root / 'evaluation/results/strategy-selection.json')
        gate = {'schema': 'aws-basics-rag-gate-v1', 'verdict': 'PASS',
                **retrieval_binding(selection),
                'selectionHash': digest((self.root / 'evaluation/results/strategy-selection.json').read_bytes()),
                'curriculumHash': self.catalogue['curriculumHash'], 'corpusVersion': cv,
                'referenceHash': reference_hash, 'metrics': metrics, 'reports': bindings,
                'syntheticUnitFixture': True}
        file = self.root / 'evaluation/full-rag-gate.json'
        save(file, gate)
        return file

    def test_F03_all_consumers_require_claim_before_holdout_content(self):
        import readiness
        from itertools import product
        for consumer, mutation, shape in product(
                ('readiness.run', 'readiness.verify_decisions', 'batch_author.require_rag_gate'),
                ('missing', 'changed', 'valid'),
                ('valid', 'wrong-split', 'missing-rows', 'none-rows', 'list-rows')):
            if mutation == 'valid' and shape == 'valid':
                continue
            with self.subTest(consumer=consumer, mutation=mutation, shape=shape):
                gate_path = self.gate_fixture()
                gate = load(gate_path)
                if shape != 'valid':
                    ranking_path = self.root / 'evaluation/results/holdout.json'
                    ranking = load(ranking_path)
                    if shape == 'wrong-split':
                        ranking['split'] = 'dev'
                    elif shape == 'missing-rows':
                        del ranking['rows']
                    else:
                        ranking['rows'] = None if shape == 'none-rows' else []
                    save(ranking_path, ranking)
                    next(item for item in gate['reports'] if item['kind'] == 'holdout_retrieval')['sha256'] = digest(ranking_path.read_bytes())
                    save(gate_path, gate)
                report = load(self.root / 'evaluation/results/readiness-holdout.json')
                claim_path = self.root / 'evaluation/results/holdout.experiment.json'
                if mutation == 'missing':
                    claim_path.unlink()
                elif mutation == 'changed':
                    claim = load(claim_path)
                    claim['profileHash'] = '0' * 64
                    save(claim_path, claim)
                state = load(self.root / 'run.json')
                reference = self.root / 'evaluation/references.json'
                review = self.root / state['nodes']['A3-reference-review']['reportPath']
                readiness_report = self.root / 'evaluation/results/readiness-holdout.json'
                events = []
                original_bytes, original_text, original_refs = Path.read_bytes, Path.read_text, readiness.references
                def observe_file(source):
                    if source in (reference, review, readiness_report) or self.root / 'evaluation/model-runs' in source.parents:
                        events.append(str(source.relative_to(self.root)))
                def observed_bytes(source):
                    observe_file(source)
                    return original_bytes(source)
                def observed_text(source, *args, **kwargs):
                    observe_file(source)
                    return original_text(source, *args, **kwargs)
                def observed_refs(args):
                    events.append('readiness.references')
                    return original_refs(args)
                args = SimpleNamespace(root=self.root, corpus_root=self.args.corpus_root, split='holdout',
                    references=reference, reference_review=review, workbench_review=self.root / 'unused')
                with patch.object(Path, 'read_bytes', autospec=True, side_effect=observed_bytes), patch.object(
                        Path, 'read_text', autospec=True, side_effect=observed_text), patch.object(
                        readiness, 'references', side_effect=observed_refs), patch.object(
                        readiness, 'require_workbench_review'), patch.object(readiness, 'invoke') as invoke, patch.object(
                        readiness, 'completed_model') as completed:
                    with self.assertRaises(ValueError):
                        if consumer == 'readiness.run':
                            readiness.run(args)
                        elif consumer == 'readiness.verify_decisions':
                            readiness.verify_decisions(self.root, gate['referenceHash'], gate['corpusVersion'],
                                                       gate['strategy'], report['decisions'])
                        else:
                            b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate_path)
                    invoke.assert_not_called()
                    completed.assert_not_called()
                self.assertEqual([], events, 'Holdout content opened before missing/changed claim rejection')


    def test_full_rag_accepts_new_observed_native_pin_and_rejects_binding_substitutions(self):
        gate = self.gate_fixture()
        state = load(self.root / 'run.json')
        state['nodes']['A3-reference-review']['reviewerAgent'] = '/root/observed_reference_revision'
        save(self.root / 'run.json', state)
        b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)
        original = load(gate)
        for field, value in (('strategy', 'vector'), ('retrievalConfigVersion', 1),
                             ('profileHash', '0' * 64), ('retrieverSourceHash', '0' * 64),
                             ('evaluatorSourceHash', '0' * 64), ('modelCacheHash', '0' * 64),
                             ('selectionHash', '0' * 64)):
            with self.subTest(field=field):
                save(gate, {**original, field: value})
                with self.assertRaisesRegex(ValueError, 'binding changed'):
                    b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)
        save(gate, original)
        selection_path = self.root / 'evaluation/results/strategy-selection.json'
        selection = load(selection_path)
        selection['strategy'] = 'vector'
        save(selection_path, selection)
        with self.assertRaisesRegex(ValueError, 'Selection differs'):
            b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)

    def test_full_rag_gate_cross_checks_real_reports_and_actual_40_decisions(self):
        gate = self.gate_fixture()
        b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)
        report_path = self.root / 'evaluation/results/readiness-holdout.json'
        report = load(report_path)
        report['decisions'][-1]['refused'] = False
        report['decisions'][-1]['verdict'] = 'ready'
        report['decisions'][-1]['judgment']['verdict'] = 'supported'
        report['decisions'][-1]['supportingEvidenceIds'] = ['ev-1']
        save(report_path, report)
        with self.assertRaisesRegex(ValueError, 'hash changed'):
            b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)
        data = load(gate)
        next(r for r in data['reports'] if r['kind'] == 'holdout_readiness')['sha256'] = digest(report_path.read_bytes())
        save(gate, data)
        with self.assertRaisesRegex(ValueError, 'counts differ'):
            b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)
        self.assertEqual([], self.calls)

    def test_full_rag_gate_rejects_pass_only_low_metrics_duplicate_and_missing_decisions(self):
        for mutation in ('pass-only', 'low', 'duplicate', 'missing'):
            with self.subTest(mutation=mutation):
                gate = self.gate_fixture()
                data = load(gate)
                if mutation == 'pass-only':
                    data = {'verdict': 'PASS'}
                elif mutation == 'low':
                    data['metrics']['meanRecallAt8'] = .89
                else:
                    file = self.root / 'evaluation/results/readiness-holdout.json'
                    report = load(file)
                    if mutation == 'duplicate':
                        report['decisions'][-1]['id'] = report['decisions'][0]['id']
                    else:
                        report['decisions'].pop()
                    save(file, report)
                    next(r for r in data['reports'] if r['kind'] == 'holdout_readiness')['sha256'] = digest(file.read_bytes())
                save(gate, data)
                with self.assertRaises(ValueError):
                    b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)

    def test_F01_explicit_unsupported_ready_judgment_cannot_hide_behind_zero_counts(self):
        gate = self.gate_fixture()
        file = self.root / 'evaluation/results/readiness-holdout.json'
        report = load(file)
        for row in report['decisions']:
            row['unsupportedAccepted'] = False
            row['judgment'] = {'verdict': 'supported' if not row['refused'] else 'correct_refusal'}
        report['decisions'][0]['unsupportedAccepted'] = True
        report['decisions'][0]['judgment']['verdict'] = 'unsupported'
        save(file, report)
        outer = load(gate)
        next(r for r in outer['reports'] if r['kind'] == 'holdout_readiness')['sha256'] = digest(file.read_bytes())
        save(gate, outer)
        with self.assertRaises(ValueError):
            b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)

    def test_F02_report_only_fixture_without_original_receipts_is_rejected(self):
        gate = self.gate_fixture()
        shutil.rmtree(self.root / 'evaluation/model-runs', ignore_errors=True)
        self.assertEqual([], list(self.root.rglob('execution.json')))
        with self.assertRaises((ValueError, FileNotFoundError)):
            b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)

    def test_F02_gate_reopens_original_receipt_and_rejects_substituted_batch_refs(self):
        for mutation in ('missing-result', 'missing-receipt', 'outside-ref', 'nonexistent-ref', 'stale-reference'):
            with self.subTest(mutation=mutation):
                gate = self.gate_fixture()
                if mutation in ('missing-result', 'missing-receipt'):
                    filename = 'result.json' if mutation == 'missing-result' else 'execution.json'
                    (self.root / 'evaluation/model-runs/holdout-01/reader-1' / filename).unlink()
                elif mutation == 'stale-reference':
                    file = self.root / 'evaluation/references.json'
                    file.write_text(file.read_text() + ' ')
                else:
                    file = self.root / 'evaluation/results/readiness-holdout.json'
                    report = load(file)
                    report['decisions'][0]['modelBatchRef'] = '../outside' if mutation == 'outside-ref' else 'evaluation/model-runs/never/reader-1'
                    save(file, report)
                    outer = load(gate)
                    next(r for r in outer['reports'] if r['kind'] == 'holdout_readiness')['sha256'] = digest(file.read_bytes())
                    save(gate, outer)
                with self.assertRaises((ValueError, FileNotFoundError)):
                    b.require_rag_gate(self.root, self.args.corpus_root, self.catalogue, gate)

    def test_F04_unknown_repair_after_initial_pass_still_blocks_without_replay(self):
        self.false_check = {self.uids[0]}
        original_transport = self.transport
        def transport(args, folder, stage, attempt, prompt, schema):
            if stage == 'repair-generate':
                raise RuntimeError('unknown repair transport outcome')
            return original_transport(args, folder, stage, attempt, prompt, schema)
        with patch.object(b.author, 'invoke', side_effect=transport) as invoke:
            with self.assertRaisesRegex(RuntimeError, 'unknown repair'):
                b.run_batch(self.args, self.plan, self.batch, self.catalogue)
            calls = invoke.call_count
            self.assertEqual(3, calls)
            with self.assertRaisesRegex(ValueError, 'Unknown/incomplete'):
                b.run_batch(self.args, self.plan, self.batch, self.catalogue)
            self.assertEqual(calls, invoke.call_count)
        with self.assertRaisesRegex(ValueError, 'Unknown/incomplete'):
            b.verify_record(self.root, self.args.corpus_root, self.catalogue, self.uids[1])

    def test_F04_malformed_completed_repair_preserves_original_pass_siblings(self):
        original_transport = self.transport
        scenario = 0
        for stage in ('repair-generate', 'repair-review'):
            for malformed in ('uid', 'cardinality', 'order'):
                with self.subTest(stage=stage, malformed=malformed):
                    batch = self.plan['batches'][scenario]
                    scenario += 1
                    failed = batch['uids'][:2]
                    self.false_check = set(failed)
                    def transport(args, folder, actual_stage, attempt, prompt, schema):
                        value = original_transport(args, folder, actual_stage, attempt, prompt, schema)
                        if actual_stage == stage:
                            if malformed == 'uid':
                                value['cards'][0]['conceptId'] = 'foreign-uid'
                            elif malformed == 'cardinality':
                                value['cards'].pop()
                            else:
                                value['cards'].reverse()
                            output = folder / (actual_stage + '-1')
                            save(output / 'result.json', value)
                            receipt = load(output / 'execution.json')
                            receipt['outputHash'] = digest((output / 'result.json').read_bytes())
                            save(output / 'execution.json', receipt)
                        return value
                    with patch.object(b.author, 'invoke', side_effect=transport):
                        result = b.run_batch(self.args, self.plan, batch, self.catalogue)
                        self.assertEqual(set(failed), set(result['failed']))
                        self.assertEqual(set(batch['uids'][2:]), set(result['passed']))
                        before = len(self.calls)
                        self.assertEqual(result, b.run_batch(self.args, self.plan, batch, self.catalogue))
                        self.assertEqual(before, len(self.calls))
                    for uid in batch['uids'][2:]:
                        _, _, meta = b.verify_record(self.root, self.args.corpus_root, self.catalogue, uid)
                        self.assertEqual({'initial': 1, 'repair': 0, 'limit': 2}, meta['budget'])

    def test_symlink_and_outside_reference_rejected(self):
        for ref in ('../outside', '/tmp/outside'):
            with self.assertRaises(ValueError):
                b.path(self.root, ref)
        (self.root / 'linked').symlink_to('/tmp')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            b.path(self.root, 'linked/file')


if __name__ == '__main__':
    unittest.main()
