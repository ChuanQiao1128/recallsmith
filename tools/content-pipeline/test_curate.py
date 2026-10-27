import copy
import json
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest

from curate import (GOAL_SCHEMA, REVIEW_SCHEMA, build_review_prompt, completed_attempt, execute,
                    prepare_repair, require_reconciled_revisions, validate_goals,
                    validate_repair_authorization, validate_repaired_goals, verified_goals, run,
                    adjudicated_goals, normalized_metadata)
from pipeline import canonical
from pipeline import digest, save


class RevisionTests(unittest.TestCase):
    def rejected(self, batch):
        prior = batch / 'generate-attempt-1'
        prior.mkdir()
        error = {'status': 400, 'error': {'code': 'invalid_json_schema'}}
        raw = '\n'.join(json.dumps(e) for e in [
            {'type': 'thread.started'}, {'type': 'turn.started'},
            {'type': 'error', 'message': json.dumps(error)}, {'type': 'turn.failed'}])
        (prior / 'events.jsonl').write_text(raw)
        (prior / 'stderr.log').write_text('')
        save(prior / 'execution.json', {'success': False, 'exitCode': 1, 'outputHash': None,
                                      'eventsHash': digest(raw), 'stderrHash': digest('')})
        save(prior / 'supervisor-reconciliation.json', {
            'resolution': 'known_request_rejected_before_generation',
            'eventsHash': digest(raw), 'nextInputRevision': 2})
        return prior

    def test_known_schema_rejection_allows_only_bound_next_revision(self):
        with tempfile.TemporaryDirectory() as td:
            batch = Path(td)
            self.rejected(batch)
            require_reconciled_revisions(batch, 'generate', 2, batch / 'generate-r2-attempt-1')
            with self.assertRaises(ValueError):
                require_reconciled_revisions(batch, 'generate', 3, batch / 'generate-r3-attempt-1')

    def test_unknown_second_revision_cannot_be_bypassed_by_third(self):
        with tempfile.TemporaryDirectory() as td:
            batch = Path(td)
            (batch / 'generate-r2-attempt-1').mkdir()
            with self.assertRaises(ValueError):
                require_reconciled_revisions(batch, 'generate', 3, batch / 'generate-r3-attempt-1')

    def test_tampered_or_completed_evidence_does_not_prove_rejection(self):
        for suffix in ['tampered', 'completed']:
            with self.subTest(suffix=suffix), tempfile.TemporaryDirectory() as td:
                batch = Path(td)
                prior = self.rejected(batch)
                with (prior / 'events.jsonl').open('a') as f:
                    f.write('\n' + json.dumps({'type': 'turn.completed' if suffix == 'completed' else 'item.completed'}))
                with self.assertRaises(ValueError):
                    require_reconciled_revisions(batch, 'generate', 2, batch / 'generate-r2-attempt-1')

    def test_attempt_budget_is_shared_across_revisions(self):
        with tempfile.TemporaryDirectory() as td:
            batch = Path(td)
            for name in ['generate-attempt-1', 'generate-r1-attempt-1', 'generate-r2-attempt-1']:
                (batch / name).mkdir()
            with self.assertRaisesRegex(ValueError, 'budget'):
                require_reconciled_revisions(batch, 'generate', 3, batch / 'generate-r3-attempt-1')



class RepairTests(unittest.TestCase):
    def fixture(self, batch):
        packet = {'cards': [{'stableUid': 'a'}, {'stableUid': 'b'}],
                  'publicReferences': {'serviceConceptIds': ['ec2'], 'tasks': [{'id': '1.1'}]}}
        goals = {'cards': [{'stableUid': uid, 'goalEn': 'Understand EC2', 'goalZh': '理解 EC2',
                           'retrievalQueryEn': 'EC2 scope', 'layer': 1, 'serviceConceptIds': ['ec2'],
                           'publicTaskId': None, 'examRelation': 'prerequisite', 'difficultyConcern': None}
                          for uid in ['a', 'b']]}
        review = {'verdict': 'FAIL', 'cards': [{'stableUid': uid, 'verdict': verdict, 'findings': []}
                                              for uid, verdict in [('a', 'PASS'), ('b', 'FAIL')]]}
        save(batch / 'input.json', packet)
        (batch / 'generate.prompt.txt').write_text('initial goal prompt')
        save(batch / 'generate.schema.json', GOAL_SCHEMA)
        save(batch / 'review.schema.json', REVIEW_SCHEMA)
        (batch / 'review.prompt.txt').write_text(build_review_prompt(packet, goals))
        self.complete(batch, 'generate-r2-attempt-1', goals, batch / 'generate.prompt.txt')
        self.complete(batch, 'review-r2-attempt-1', review, batch / 'review.prompt.txt')
        return packet, goals, review

    def complete(self, batch, name, result, prompt):
        output = batch / name
        output.mkdir(exist_ok=True)
        stage = name.split('-')[0]
        schema = (batch / f'{stage}.schema.json').read_text()
        (output / 'schema.json').write_text(schema)
        save(output / 'result.json', result)
        raw = canonical({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': canonical(result)}})
        raw += '\n' + canonical({'type': 'turn.completed'}) + '\n'
        (output / 'events.jsonl').write_text(raw)
        (output / 'stderr.log').write_text('')
        hashes = {'inputHash': digest(prompt.read_text()), 'schemaHash': digest(schema.strip())}
        save(output / 'invocation.json', hashes)
        save(output / 'execution.json', {**hashes, 'success': True, 'exitCode': 0,
              'outputHash': digest((output / 'result.json').read_bytes()),
              'eventsHash': digest(raw), 'stderrHash': digest('')})

    def test_completed_failure_authorizes_one_repair_and_transitive_400(self):
        with tempfile.TemporaryDirectory() as td:
            batch = Path(td)
            _, goals, _ = self.fixture(batch)
            RevisionTests().rejected(batch)
            prepare_repair(batch)
            original = (batch / 'repair-authorization.json').read_bytes()
            prepare_repair(batch)
            self.assertEqual(original, (batch / 'repair-authorization.json').read_bytes())
            for stage in ['generate', 'review']:
                require_reconciled_revisions(batch, stage, 3, batch / f'{stage}-r3-attempt-1')
            goals['cards'][1]['goalEn'] = 'Understand one narrowed EC2 boundary'
            validate_repaired_goals(batch, goals)
            goals['cards'][0]['goalZh'] = '修改'
            with self.assertRaisesRegex(ValueError, 'previously passing'):
                validate_repaired_goals(batch, goals)

    def test_every_original_uid_exactly_once(self):
        with tempfile.TemporaryDirectory() as td:
            batch = Path(td)
            packet, goals, _ = self.fixture(batch)
            for cards in [goals['cards'][:1], goals['cards'] + [goals['cards'][0]],
                          [goals['cards'][0], {**goals['cards'][1], 'stableUid': 'replacement'}]]:
                with self.subTest(cards=cards), self.assertRaises(ValueError):
                    validate_goals(packet, {'cards': cards})

    def test_authorization_detects_each_frozen_artifact_tamper(self):
        with tempfile.TemporaryDirectory() as td:
            batch = Path(td)
            self.fixture(batch)
            prepare_repair(batch)
            authorization = validate_repair_authorization(batch)
            for relative in list(authorization['files']) + ['generate-r3.prompt.txt', 'repair-authorization.json']:
                path = batch / relative
                original = path.read_bytes()
                path.write_bytes(original + b' ')
                # JSON whitespace is semantic no-op but frozen evidence must still fail.
                if relative == 'repair-authorization.json':
                    changed = json.loads(original)
                    changed['passingUids'] = []
                    save(path, changed)
                with self.subTest(relative=relative), self.assertRaises((ValueError, OSError)):
                    validate_repair_authorization(batch)
                path.write_bytes(original)

    def test_review_must_bind_actual_candidate_and_actual_failure(self):
        for variant in ['wrong_candidate', 'pass', 'inconsistent', 'unknown']:
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as td:
                batch = Path(td)
                packet, goals, review = self.fixture(batch)
                if variant == 'wrong_candidate':
                    altered = copy.deepcopy(goals)
                    altered['cards'][0]['goalEn'] = 'different candidate'
                    (batch / 'review.prompt.txt').write_text(build_review_prompt(packet, altered))
                elif variant in {'pass', 'inconsistent'}:
                    review['verdict'] = 'PASS'
                    if variant == 'pass':
                        review['cards'][1]['verdict'] = 'PASS'
                else:
                    (batch / 'review-r2-attempt-1/result.json').unlink()
                if variant != 'unknown':
                    self.complete(batch, 'review-r2-attempt-1', review, batch / 'review.prompt.txt')
                with self.assertRaises((ValueError, OSError)):
                    prepare_repair(batch)

    def test_unknown_r3_blocks_even_another_stage_before_model_call(self):
        with tempfile.TemporaryDirectory() as td:
            batch = Path(td)
            self.fixture(batch)
            prepare_repair(batch)
            (batch / 'review-r3-attempt-1').mkdir()
            args = SimpleNamespace(input_revision=3)
            with patch('curate.subprocess.run') as invoke, self.assertRaisesRegex(ValueError, 'Incomplete'):
                execute(args, batch, 'generate', batch / 'generate-r3.prompt.txt', batch / 'generate.schema.json')
            invoke.assert_not_called()

    def test_completed_resume_never_invokes_model(self):
        with tempfile.TemporaryDirectory() as td:
            batch = Path(td)
            _, goals, _ = self.fixture(batch)
            args = SimpleNamespace(input_revision=2)
            with patch('curate.subprocess.run') as invoke:
                self.assertEqual(execute(args, batch, 'generate', batch / 'generate.prompt.txt',
                                         batch / 'generate.schema.json'), goals)
            invoke.assert_not_called()

    def test_valid_repair_cannot_exceed_three_generation_attempts(self):
        with tempfile.TemporaryDirectory() as td:
            batch = Path(td)
            self.fixture(batch)
            RevisionTests().rejected(batch)
            prepare_repair(batch)
            (batch / 'generate-r1-attempt-1').mkdir()
            with self.assertRaisesRegex(ValueError, 'budget'):
                require_reconciled_revisions(batch, 'generate', 3, batch / 'generate-r3-attempt-1')

    def test_completed_requires_matching_agent_message_and_terminal_event(self):
        for variant in ['wrong_message', 'turn_failed']:
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as td:
                batch = Path(td)
                self.fixture(batch)
                output = batch / 'generate-r2-attempt-1'
                events = [json.loads(line) for line in (output / 'events.jsonl').read_text().splitlines()]
                if variant == 'wrong_message':
                    events[0]['item']['text'] = '{}'
                else:
                    events[-1]['type'] = 'turn.failed'
                raw = '\n'.join(canonical(e) for e in events)
                (output / 'events.jsonl').write_text(raw)
                execution = json.loads((output / 'execution.json').read_text())
                execution['eventsHash'] = digest(raw)
                save(output / 'execution.json', execution)
                with self.assertRaises(ValueError):
                    completed_attempt(batch, output.name, batch / 'generate.prompt.txt', batch / 'generate.schema.json')

    def test_run_repairs_once_then_resumes_and_binds_final_artifacts(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            batch = root / 'curriculum/batches/01'
            batch.mkdir(parents=True)
            _, goals, review = self.fixture(batch)
            stages = []
            actual_execute = execute
            def completed_model(args, batch, stage, prompt, schema):
                stages.append((args.input_revision, stage))
                if args.input_revision == 3 and not (batch / f'{stage}-r3-attempt-1').exists():
                    result = copy.deepcopy(goals if stage == 'generate' else review)
                    if stage == 'generate':
                        result['cards'][1]['goalEn'] = 'Understand a single EC2 boundary'
                    else:
                        result['verdict'] = 'PASS'
                        result['cards'][1]['verdict'] = 'PASS'
                    self.complete(batch, f'{stage}-r3-attempt-1', result, prompt)
                return actual_execute(args, batch, stage, prompt, schema)
            (root / 'curriculum/batches/02').mkdir()
            args = SimpleNamespace(root=root, input_revision=2, batch='01', workbench_review=root / 'unused')
            with patch('curate.require_workbench_review'), patch('curate.execute', side_effect=completed_model), \
                    patch('curate.subprocess.run') as invoke:
                run(args)
                self.assertEqual(stages, [(2, 'generate'), (2, 'review'), (3, 'generate'), (3, 'review')])
                run(args)
            invoke.assert_not_called()
            verified = json.loads((batch / 'verified.json').read_text())
            self.assertEqual(verified['generationAttempt'], 'generate-r3-attempt-1')
            self.assertEqual(verified['reviewAttempt'], 'review-r3-attempt-1')
            self.assertEqual(verified_goals(batch)['cards'][0], goals['cards'][0])
            for field in ['generationAttempt', 'reviewAttempt']:
                tampered = copy.deepcopy(verified)
                tampered[field] = tampered[field].replace('r3', 'r2')
                save(batch / 'verified.json', tampered)
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'pointers'):
                    verified_goals(batch)
            save(batch / 'verified.json', verified)
            path = batch / 'review-r3-attempt-1/execution.json'
            execution = json.loads(path.read_text())
            execution['elapsedMs'] = 999
            save(path, execution)
            with self.assertRaisesRegex(ValueError, 'evidence changed'):
                verified_goals(batch)

    def test_r3_failed_review_stops_without_a_second_repair(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            batch = root / 'curriculum/batches/01'
            batch.mkdir(parents=True)
            packet, goals, review = self.fixture(batch)
            prepare_repair(batch)
            self.complete(batch, 'generate-r3-attempt-1', goals, batch / 'generate-r3.prompt.txt')
            (batch / 'review-r3.prompt.txt').write_text(build_review_prompt(packet, goals))
            self.complete(batch, 'review-r3-attempt-1', review, batch / 'review-r3.prompt.txt')
            args = SimpleNamespace(root=root, input_revision=2, workbench_review=root / 'unused')
            with patch('curate.require_workbench_review'), patch('curate.subprocess.run') as invoke:
                with self.assertRaisesRegex(RuntimeError, 'exhausted'):
                    run(args)
            invoke.assert_not_called()


class AdjudicationTests(unittest.TestCase):
    def fixture(self, root):
        batch = root / 'curriculum/batches/01'
        batch.mkdir(parents=True)
        helper = RepairTests()
        packet, old, review = helper.fixture(batch)
        prepare_repair(batch)
        revised = copy.deepcopy(old)
        revised['cards'][1]['goalEn'] = 'A different service-specific objective'
        helper.complete(batch, 'generate-r3-attempt-1', revised, batch / 'generate-r3.prompt.txt')
        (batch / 'review-r3.prompt.txt').write_text(build_review_prompt(packet, revised))
        helper.complete(batch, 'review-r3-attempt-1', review, batch / 'review-r3.prompt.txt')
        ch = digest((batch / 'generate-r2-attempt-1/result.json').read_bytes())
        oh = digest(canonical(old['cards'][1]))
        paths = {'originalInput': batch / 'input.json',
                 'candidateResult': batch / 'generate-r2-attempt-1/result.json',
                 'generationPrompt': batch / 'generate.prompt.txt',
                 'generationExecution': batch / 'generate-r2-attempt-1/execution.json',
                 'reviewResult': batch / 'review-r2-attempt-1/result.json',
                 'reviewPrompt': batch / 'review.prompt.txt',
                 'reviewExecution': batch / 'review-r2-attempt-1/execution.json'}
        report = {'reviewKind': 'independent_existing_variant_scope_adjudication',
                  'scope': {'batch': '01', 'uids': ['b']}, 'reviewedBy': 'codex',
                  'budget': {'newGenerationAttempts': 0, 'budgetReset': False},
                  'selection': [{'stableUid': 'b', 'selectedVariant': 'r2',
                      'decision': 'SELECT_EXISTING_R2_UNCHANGED', 'candidateHash': ch,
                      'selectedCandidateObjectHash': oh}],
                  'records': [{'stableUid': 'b', 'variant': 'r2', 'verdict': 'PASS',
                      'checks': {'identity': {'verdict': 'PASS'}}, 'candidateHash': ch,
                      'candidateObjectHash': oh,
                      'bindings': {k: {'sha256': digest(p.read_bytes())} for k, p in paths.items()}}]}
        path = root / 'review/adjudication/review.json'
        save(path, report)
        return batch, path, report, old

    def test_selects_only_unchanged_existing_object_with_bound_pass(self):
        with tempfile.TemporaryDirectory() as td:
            batch, path, report, old = self.fixture(Path(td))
            with patch('curate.subprocess.run') as invoke:
                selected, files = adjudicated_goals(batch, path)
            self.assertEqual(old, selected)
            self.assertEqual(digest(path.read_bytes()), files['adjudication:' + str(path.resolve())])
            invoke.assert_not_called()

    def test_cannot_extend_scope_or_accept_failed_tampered_object(self):
        for mutation in ('scope', 'failed_check', 'object', 'budget'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as td:
                batch, path, report, _ = self.fixture(Path(td))
                if mutation == 'scope': report['scope']['uids'].append('a')
                if mutation == 'failed_check': report['records'][0]['checks']['identity']['verdict'] = 'FAIL'
                if mutation == 'object': report['records'][0]['candidateObjectHash'] = '0' * 64
                if mutation == 'budget': report['budget']['budgetReset'] = True
                save(path, report)
                with self.assertRaises(ValueError): adjudicated_goals(batch, path)

    def test_unknown_attempt_blocks_even_valid_existing_selection(self):
        for name in ('review-r1-attempt-1', 'review-r4-attempt-1', 'generate-r4-attempt-1',
                     'generate-r2-attempt-4', 'generate-unrecognized'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as td:
                batch, path, _, _ = self.fixture(Path(td))
                (batch / name).mkdir()
                with self.assertRaises(ValueError): adjudicated_goals(batch, path)

    def select_r3(self, batch, path, report):
        source = json.loads((batch / 'generate-r3-attempt-1/result.json').read_text())['cards'][1]
        record = copy.deepcopy(report['records'][0])
        record.update(variant='r3', candidateHash=digest((batch / 'generate-r3-attempt-1/result.json').read_bytes()),
                      candidateObjectHash=digest(canonical(source)))
        for label, binding in record['bindings'].items():
            original = {'originalInput': 'input.json', 'candidateResult': 'generate-r3-attempt-1/result.json',
                        'generationPrompt': 'generate-r3.prompt.txt',
                        'generationExecution': 'generate-r3-attempt-1/execution.json',
                        'reviewResult': 'review-r3-attempt-1/result.json', 'reviewPrompt': 'review-r3.prompt.txt',
                        'reviewExecution': 'review-r3-attempt-1/execution.json'}[label]
            binding['sha256'] = digest((batch / original).read_bytes())
        report['records'].append(record)
        report['selection'] = [{'stableUid': 'b', 'selectedVariant': 'r3',
                                'decision': 'SELECT_EXISTING_R3_UNCHANGED',
                                'candidateHash': record['candidateHash'],
                                'selectedCandidateObjectHash': record['candidateObjectHash']}]
        save(path, report)
        return record, source

    def test_r3_selection_preserves_already_passing_objects_and_uses_its_own_receipts(self):
        with tempfile.TemporaryDirectory() as td:
            batch, path, report, old = self.fixture(Path(td))
            record, source = self.select_r3(batch, path, report)
            with patch('curate.subprocess.run') as invoke:
                selected, _ = adjudicated_goals(batch, path)
            self.assertEqual(selected['cards'], [old['cards'][0], source])
            invoke.assert_not_called()
            record['bindings']['generationPrompt']['sha256'] = report['records'][0]['bindings']['generationPrompt']['sha256']
            save(path, report)
            with self.assertRaisesRegex(ValueError, 'binding'):
                adjudicated_goals(batch, path)

    def test_r3_cannot_use_a_failed_or_differently_hash_bound_record(self):
        for mutation in ('failed', 'hash', 'object', 'decision'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as td:
                batch, path, report, _ = self.fixture(Path(td))
                record, _ = self.select_r3(batch, path, report)
                if mutation == 'failed': record['verdict'] = 'FAIL'
                if mutation == 'hash': report['selection'][0]['candidateHash'] = '0' * 64
                if mutation == 'object': report['selection'][0]['selectedCandidateObjectHash'] = '0' * 64
                if mutation == 'decision': report['selection'][0]['decision'] = 'SELECT_EXISTING_R2_UNCHANGED'
                save(path, report)
                with self.assertRaises(ValueError): adjudicated_goals(batch, path)

    def test_selection_revalidates_completed_receipts_of_both_revisions(self):
        for revision in (2, 3):
            for stage in ('generate', 'review'):
                with self.subTest(revision=revision, stage=stage), tempfile.TemporaryDirectory() as td:
                    batch, path, _, _ = self.fixture(Path(td))
                    events = batch / f'{stage}-r{revision}-attempt-1/events.jsonl'
                    events.write_bytes(events.read_bytes() + b' ')
                    with self.assertRaisesRegex(ValueError, 'Completed attempt'):
                        adjudicated_goals(batch, path)

    def normalization_fixture(self, root):
        batch, path, report, old = self.fixture(root)
        # Complete the exact numeric layer-2 source before binding its independent classification.
        source_result = json.loads((batch / 'generate-r3-attempt-1/result.json').read_text())
        source_result['cards'][1]['layer'] = 2
        RepairTests().complete(batch, 'generate-r3-attempt-1', source_result, batch / 'generate-r3.prompt.txt')
        packet = json.loads((batch / 'input.json').read_text())
        (batch / 'review-r3.prompt.txt').write_text(build_review_prompt(packet, source_result))
        review = json.loads((batch / 'review-r3-attempt-1/result.json').read_text())
        RepairTests().complete(batch, 'review-r3-attempt-1', review, batch / 'review-r3.prompt.txt')
        record, source = self.select_r3(batch, path, report)
        names = ['retainedUnderlyingConcept', 'singleManageableObjective', 'naturalEquivalentEnglishChinese',
                 'neutralGoalAndRetrievalQuery', 'appropriateLayer', 'honestExamRelation',
                 'validCatalogIdentifiers', 'artifactVersionBindings']
        record['checks'] = {key: {'verdict': 'FAIL' if key == 'appropriateLayer' else 'PASS',
                                  'reason': 'Already independently classified ' + key} for key in names}
        record['verdict'] = 'FAIL'
        report['selection'] = []
        save(path, report)
        prompt = batch / 'generate-r3.prompt.txt'
        frozen_prompt = root / 'review/frozen-generate-r3.prompt.txt'
        frozen_prompt.write_bytes(prompt.read_bytes())
        addendum = {'reviewKind': 'conditional_deterministic_metadata_normalization_addendum',
                    'decision': 'SUPPORTED_CONDITIONALLY_BY_EXISTING_ADJUDICATION', 'reviewedBy': 'codex',
                    'scope': {'batch': '01', 'uids': ['b'], 'sourceVariant': 'r3'},
                    'sourceResultPath': str((batch / 'generate-r3-attempt-1/result.json').resolve()),
                    'sourceResultHash': record['candidateHash'], 'sourceCandidateObjectHash': record['candidateObjectHash'],
                    'sourceReview': {'path': str(path.resolve()), 'sha256': digest(path.read_bytes()),
                                     'originalVerdict': 'FAIL', 'preserved': True},
                    'permittedChange': {'field': 'layer', 'from': 2, 'to': 3},
                    'basis': {'ruleSource': {'path': str(prompt.resolve()), 'frozenPath': str(frozen_prompt),
                                             'sha256': digest(prompt.read_bytes())}},
                    'originalChecks': {key: {'originalVerdict': check['verdict'], 'originalReason': check['reason'],
                        'conditionalConclusion': {'verdict': 'PASS_FOR_ORIGINAL_ONLY' if key == 'artifactVersionBindings'
                                                  else 'PASS_IF'}} for key, check in record['checks'].items()},
                    'correctedLayerCheck': {'verdict': 'PASS_IF'},
                    'conditionalOverallConclusion': {'verdict': 'PASS_IF_ALL_CONDITIONS_VERIFIED',
                                                     'additionalUnresolvedSemanticRules': []}}
        addendum_path = root / 'review/metadata-normalization-addendum.json'
        save(addendum_path, addendum)
        with patch('curate.LAYER_NORMALIZATION_ADDENDUM_HASH', digest(addendum_path.read_bytes())):
            derived, provenance = normalized_metadata(batch, path, addendum_path, record, source)
        derived_dir = batch / 'deterministic-metadata-normalization'
        derived_dir.mkdir()
        (derived_dir / 'result.json').write_text(canonical(derived) + '\n')
        save(derived_dir / 'provenance.json', provenance)
        return batch, path, addendum_path, source, addendum

    def test_only_numeric_layer_is_derived_and_original_failure_remains(self):
        with tempfile.TemporaryDirectory() as td:
            batch, path, addendum, source, _ = self.normalization_fixture(Path(td))
            original_report = path.read_bytes()
            original_result = (batch / 'generate-r3-attempt-1/result.json').read_bytes()
            with patch('curate.LAYER_NORMALIZATION_ADDENDUM_HASH', digest(addendum.read_bytes())), \
                    patch('curate.subprocess.run') as invoke:
                selected, files = adjudicated_goals(batch, path, addendum)
                marker = {'mode': 'adjudicated_existing_variants', 'adjudicationReport': str(path),
                          'metadataNormalizationAddendum': str(addendum), 'files': files,
                          'goalsHash': digest(canonical(selected)),
                          'inputHash': digest(canonical(json.loads((batch / 'input.json').read_text())))}
                save(batch / 'verified.json', marker)
                self.assertEqual(verified_goals(batch), selected)
            self.assertEqual(selected['cards'][1], {**source, 'layer': 3})
            self.assertEqual(original_report, path.read_bytes())
            self.assertEqual(original_result, (batch / 'generate-r3-attempt-1/result.json').read_bytes())
            self.assertIn('deterministic-metadata-normalization/provenance.json', files)
            invoke.assert_not_called()

    def test_verified_resume_detects_each_bound_normalization_artifact(self):
        for artifact in ('result.json', 'provenance.json', 'addendum', 'report'):
            with self.subTest(artifact=artifact), tempfile.TemporaryDirectory() as td:
                batch, path, addendum, _, _ = self.normalization_fixture(Path(td))
                anchor = digest(addendum.read_bytes())
                with patch('curate.LAYER_NORMALIZATION_ADDENDUM_HASH', anchor):
                    selected, files = adjudicated_goals(batch, path, addendum)
                    save(batch / 'verified.json', {'mode': 'adjudicated_existing_variants',
                        'adjudicationReport': str(path), 'metadataNormalizationAddendum': str(addendum),
                        'files': files, 'goalsHash': digest(canonical(selected)),
                        'inputHash': digest(canonical(json.loads((batch / 'input.json').read_text())))})
                    target = {'addendum': addendum, 'report': path}.get(
                        artifact, batch / 'deterministic-metadata-normalization' / artifact)
                    target.write_bytes(target.read_bytes() + b' ')
                    with self.assertRaises(ValueError): verified_goals(batch)

    def test_derived_nonlayer_fields_array_order_and_numeric_type_tamper_are_rejected(self):
        for mutation in ('wording', 'query', 'array', 'extra', 'layer_bool', 'layer_float', 'layer_string', 'provenance'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as td:
                batch, path, addendum, _, _ = self.normalization_fixture(Path(td))
                result_path = batch / 'deterministic-metadata-normalization/result.json'
                derived = json.loads(result_path.read_text())
                goal = derived['cards'][0]
                if mutation == 'wording': goal['goalZh'] += ' changed'
                if mutation == 'query': goal['retrievalQueryEn'] += ' changed'
                if mutation == 'array': goal['serviceConceptIds'] = ['other', 'ec2']
                if mutation == 'extra': goal['arbitrary'] = None
                if mutation.startswith('layer_'): goal['layer'] = {'layer_bool': True, 'layer_float': 3.0,
                                                                 'layer_string': '3'}[mutation]
                if mutation == 'provenance':
                    provenance_path = result_path.with_name('provenance.json')
                    provenance = json.loads(provenance_path.read_text())
                    provenance['modelGenerated'] = True
                    save(provenance_path, provenance)
                else:
                    result_path.write_text(canonical(derived) + '\n')
                with patch('curate.LAYER_NORMALIZATION_ADDENDUM_HASH', digest(addendum.read_bytes())), \
                        self.assertRaisesRegex(ValueError, 'Derived'):
                    adjudicated_goals(batch, path, addendum)

    def test_addendum_cannot_override_semantic_failure_or_change_its_allowed_state(self):
        for mutation in ('unresolved', 'overall', 'layer_check', 'permitted', 'source_hash', 'object_hash',
                         'review_hash', 'prompt_hash', 'original_check'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as td:
                batch, path, addendum_path, _, addendum = self.normalization_fixture(Path(td))
                if mutation == 'unresolved': addendum['conditionalOverallConclusion']['additionalUnresolvedSemanticRules'] = ['scope']
                if mutation == 'overall': addendum['conditionalOverallConclusion']['verdict'] = 'PASS'
                if mutation == 'layer_check': addendum['correctedLayerCheck']['verdict'] = 'PASS'
                if mutation == 'permitted': addendum['permittedChange']['to'] = 1
                if mutation == 'source_hash': addendum['sourceResultHash'] = '0' * 64
                if mutation == 'object_hash': addendum['sourceCandidateObjectHash'] = '0' * 64
                if mutation == 'review_hash': addendum['sourceReview']['sha256'] = '0' * 64
                if mutation == 'prompt_hash': addendum['basis']['ruleSource']['sha256'] = '0' * 64
                if mutation == 'original_check': addendum['originalChecks']['appropriateLayer']['originalVerdict'] = 'PASS'
                save(addendum_path, addendum)
                with patch('curate.LAYER_NORMALIZATION_ADDENDUM_HASH', digest(addendum_path.read_bytes())), \
                        self.assertRaises(ValueError):
                    adjudicated_goals(batch, path, addendum_path)

    def test_unknown_attempt_and_unrecognized_addendum_cannot_be_hidden_by_normalization(self):
        for mutation in ('unknown', 'unrecognized_addendum', 'semantic_failure', 'scope'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as td:
                batch, path, addendum, _, _ = self.normalization_fixture(Path(td))
                anchor = digest(addendum.read_bytes())
                if mutation == 'unknown': (batch / 'generate-unrecognized').mkdir()
                if mutation == 'unrecognized_addendum': addendum.write_bytes(addendum.read_bytes() + b' ')
                if mutation in {'semantic_failure', 'scope'}:
                    report = json.loads(path.read_text())
                    if mutation == 'semantic_failure': report['records'][1]['checks']['neutralGoalAndRetrievalQuery']['verdict'] = 'FAIL'
                    else: report['scope']['uids'].append('a')
                    save(path, report)
                with patch('curate.LAYER_NORMALIZATION_ADDENDUM_HASH', anchor), self.assertRaises(ValueError):
                    adjudicated_goals(batch, path, addendum)


if __name__ == '__main__':
    unittest.main()
