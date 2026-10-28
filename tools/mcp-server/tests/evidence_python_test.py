"""Read-only helper boundary tests; no Docker, model or private material needed."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

PIPELINE = Path(__file__).resolve().parents[2] / 'content-pipeline'
sys.path.insert(0, str(PIPELINE))
import mcp_evidence as m


class EvidenceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.corpus = self.root / 'retrieval-v3'
        (self.corpus / 'corpus/sources').mkdir(parents=True)
        self.cache = self.root / 'cache'
        self.cache.mkdir()
        self.config = dict(corpusRoot=str(self.corpus), controlRoot=str(self.root), modelCache=str(self.cache),
                           container=m.CONTAINER, corpusVersion=m.CORPUS_VERSION, localPython=sys.executable, strategy='rrf')
        self.text = 'Amazon S3 stores objects in buckets.'
        self.url = 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html'
        sid, version = m.digest(self.url), m.digest(self.text)
        self.chunk = dict(evidenceId='ev-' + 'a' * 32, chunkId='a' * 32, sourceId=sid, sourceVersion=version,
                          url=self.url, title='S3', charStart=0, charEnd=len(self.text), text=self.text, textSha256=m.digest(self.text))
        self.source = dict(sourceId=sid, sourceVersion=version, url=self.url, finalUrl=self.url, text=self.text, chunks=[self.chunk])
        self.path = self.corpus / 'corpus/sources' / (sid + '.json')
        self.path.write_text(json.dumps(self.source))

    def test_exact_chunk_then_source_and_offset_tamper(self):
        self.assertEqual(m.checked_chunk(self.corpus, self.chunk)['text'], self.text)
        for key, changed in [('text', 'changed'), ('charStart', -1), ('charEnd', 9000), ('url', 'https://evil.example')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.checked_chunk(self.corpus, {**self.chunk, key: changed})
        self.source['text'] = 'altered source'
        self.path.write_text(json.dumps(self.source))
        with self.assertRaises(ValueError): m.checked_chunk(self.corpus, self.chunk)

    def test_no_traversal_or_source_symlink(self):
        self.path.unlink()
        outside = self.root / 'outside.json'
        outside.write_text(json.dumps(self.source))
        self.path.symlink_to(outside)
        with self.assertRaises(ValueError): m.checked_chunk(self.corpus, self.chunk)
        for uid in ['../private', '/tmp/file', 'x' * 129, 'x--y']:
            with self.assertRaises(ValueError): m.review_status(self.root, self.corpus, uid)
        self.assertEqual(m.review_status(self.root, self.corpus, 'unknown-uid')['state'], 'unknown')

    def test_stale_version_and_query_inputs(self):
        for goal in ['https://docs.aws.amazon.com', 'ftp://example.xyz', 'docs.aws.amazon.com', 'Answer: S3', 'Explain ../private', '解释S3', 'a' * 801]:
            with self.assertRaises(ValueError): m.validate_goal(goal)
        m.validate_goal('Explain how S3 bucket versioning supports recovery.')
        with self.assertRaises(ValueError): m.checked_config({**self.config, 'corpusVersion': '0' * 64})
        with self.assertRaises(ValueError): m.dispatch({'config': self.config, 'tool': 'get_evidence',
            'args': {'evidenceId': 'ev-' + 'a' * 32, 'corpusVersion': '0' * 64}})

    def test_completed_review_bindings_and_tamper(self):
        from author import CHECKS, FIELDS, GENERATE, REVIEW
        folder = self.root / 'authoring/aws-01'
        folder.mkdir(parents=True)
        packet = {'goal': {'stableUid': 'aws-01'}, 'evidence': [self.chunk]}
        locale = {'question': 'How are objects stored?', 'answer': 'In buckets.', 'reason': 'S3 stores objects.',
                  'examPurpose': 'Understand object storage.', 'boundary': '', 'frontHelp': []}
        candidate = {'conceptId': 'aws-01', 'status': 'draft', 'en': locale, 'zh': locale,
                     'primaryEvidenceId': self.chunk['evidenceId'], 'warnings': [], 'claims': [
                         {'field': field, 'evidence': [] if field in {'boundary', 'frontHelp'} else
                          [{'evidenceId': self.chunk['evidenceId'], 'quote': 'stores objects'}]} for field in FIELDS]}
        review = {'conceptId': 'aws-01', 'verdict': 'pass', 'checks': dict.fromkeys(CHECKS, True),
                  'claimChecks': [{'field': field, 'verdict': 'supported', 'reason': 'Supported.'} for field in FIELDS],
                  'findings': []}
        (self.root / 'curriculum').mkdir()
        (self.root / 'curriculum/catalogue.json').write_text(json.dumps({'goals': [packet['goal']]}))
        (self.root / 'run.json').write_text('{}')
        (folder / 'packet.json').write_text(json.dumps(packet))
        for attempt, result, prompt in [('generate-1', candidate, GENERATE + m.canonical(packet)),
                ('review-1', review, REVIEW + m.canonical({'packet': packet, 'candidate': candidate}))]:
            output = folder / attempt
            output.mkdir()
            (folder / (attempt + '.prompt.txt')).write_text(prompt)
            (folder / (attempt + '.schema.json')).write_text('{}')
            (output / 'result.json').write_text(json.dumps(result))
            events = '\n'.join(json.dumps(event) for event in [
                {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': json.dumps(result)}},
                {'type': 'turn.completed'}])
            (output / 'events.jsonl').write_text(events)
            (output / 'stderr.log').write_text('')
            (output / 'execution.json').write_text(json.dumps({'success': True, 'exitCode': 0,
                'inputHash': m.digest(prompt), 'schemaHash': m.digest('{}'),
                'outputHash': m.digest((output / 'result.json').read_bytes()),
                'eventsHash': m.digest(events), 'stderrHash': m.digest('')}))
        receipt = {'stableUid': 'aws-01', 'verdict': 'PASS', 'reviewedBy': 'codex', 'humanPerCardReview': False,
                   'generationAttempt': 'generate-1', 'reviewAttempt': 'review-1',
                   'packetHash': m.digest((folder / 'packet.json').read_bytes()),
                   'candidateHash': m.digest((folder / 'generate-1/result.json').read_bytes()),
                   'reviewHash': m.digest((folder / 'review-1/result.json').read_bytes())}
        (folder / 'verified.json').write_text(json.dumps(receipt))
        # Corpus identity and packet policy have separate tests; exercise actual card/review/receipt validators here.
        with patch.object(m, 'corpus_data'), patch('author.validate_packet'):
            status = m.review_status(self.root, self.corpus, 'aws-01')
            self.assertEqual(status['modelReview'], 'PASS')
            self.assertFalse(status['humanPerCardReview'])
            self.assertNotIn(str(self.root), json.dumps(status))
            original_events = (folder / 'review-1/events.jsonl').read_text()
            (folder / 'review-1/events.jsonl').write_text('tampered')
            with self.assertRaises(ValueError): m.review_status(self.root, self.corpus, 'aws-01')
            (folder / 'review-1/events.jsonl').write_text(original_events)
            event_path = folder / 'review-1/events.jsonl'
            execution_path = folder / 'review-1/execution.json'
            execution = json.loads(execution_path.read_text())
            for invalid_events in [json.dumps({'type': 'turn.started'}), json.dumps({'type': 'turn.failed'}),
                    original_events + '\n' + json.dumps({'type': 'item.completed', 'item': {'type': 'mcp_tool_call'}})]:
                event_path.write_text(invalid_events)
                execution['eventsHash'] = m.digest(invalid_events)
                execution_path.write_text(json.dumps(execution))
                with self.assertRaises(ValueError): m.review_status(self.root, self.corpus, 'aws-01')
            event_path.write_text(original_events)
            execution['eventsHash'] = m.digest(original_events)
            execution_path.write_text(json.dumps(execution))
            changed_prompt = 'stale review candidate'
            (folder / 'review-1.prompt.txt').write_text(changed_prompt)
            execution_path = folder / 'review-1/execution.json'
            execution = json.loads(execution_path.read_text())
            execution['inputHash'] = m.digest(changed_prompt)
            execution_path.write_text(json.dumps(execution))
            with self.assertRaises(ValueError): m.review_status(self.root, self.corpus, 'aws-01')

    def test_file_exists_cannot_claim_pass(self):
        folder = self.root / 'authoring/aws-01'
        folder.mkdir(parents=True)
        (folder / 'verified.json').write_text(json.dumps({'verdict': 'PASS', 'stableUid': 'aws-01'}))
        with self.assertRaises(ValueError): m.review_status(self.root, self.corpus, 'aws-01')

    def test_batch_status_reopens_shared_execution_and_rejects_tampering(self):
        # Synthetic transport; use the production batch verifier without dispatching a model.
        from test_batch_author import BatchTests
        import batch_author as b
        case = BatchTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        # Give an unrequested batch sibling its own authentic regular source.
        import copy
        from pipeline import save
        corpus = case.args.corpus_root / 'corpus'
        chunks = m.load(corpus / 'chunks.json')
        sibling_chunk = copy.deepcopy(chunks[0])
        sibling_chunk.update(url='https://docs.aws.amazon.com/sibling', chunkId='sibling')
        sibling_chunk['sourceId'] = m.digest(sibling_chunk['url'])
        source_path = corpus / 'sources' / (sibling_chunk['sourceId'] + '.json')
        source = m.load(corpus / 'sources' / (chunks[0]['sourceId'] + '.json'))
        source.update(url=sibling_chunk['url'], sourceId=sibling_chunk['sourceId'], chunks=[sibling_chunk])
        save(source_path, source)
        manifest = m.load(corpus / 'manifest.json')
        manifest['sources'].append({k: sibling_chunk[k] for k in ('sourceId', 'sourceVersion')})
        manifest['chunkCount'] = 2
        manifest['corpusVersion'] = m.digest(m.canonical({'sources': [(s['sourceId'], s['sourceVersion'])
            for s in manifest['sources']], 'chunking': manifest['chunking'], 'embeddingModel': m.MODEL}))
        save(corpus / 'manifest.json', manifest)
        save(corpus / 'chunks.json', chunks + [sibling_chunk])
        save(case.root / 'run.json', {'nodes': {'A2R-corpus': {'corpusVersion': manifest['corpusVersion']}}})
        sibling = case.batch['uids'][1]
        for goal in case.catalogue['goals']:
            packet_path = b.uid_path(case.root, goal['stableUid'], 'packet.json')
            packet = m.load(packet_path)
            packet['corpusVersion'] = manifest['corpusVersion']
            if goal['stableUid'] == sibling:
                packet['evidence'] = [sibling_chunk]
            packet['evidenceHash'] = m.digest(m.canonical({k: v for k, v in packet.items() if k not in
                {'evidenceHash', 'packetHash', 'goal', 'curriculumHash'}}))
            packet['packetHash'] = m.digest(m.canonical({k: v for k, v in packet.items() if k != 'packetHash'}))
            save(packet_path, packet)
        case.plan = b.make_plan(case.root, case.args.corpus_root, case.catalogue, case.config)
        save(case.root / b.PLAN, case.plan)
        case.batch = case.plan['batches'][0]
        transport = case.transport
        def completed_transport(args, folder, stage, attempt, prompt, schema):
            value = transport(args, folder, stage, attempt, prompt, schema)
            output = b.stage_path(case.root, case.batch['batchId'], stage)
            events = '\n'.join(json.dumps(event) for event in [
                {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': json.dumps(value)}},
                {'type': 'turn.completed'}])
            (output / 'events.jsonl').write_text(events)
            execution = m.load(output / 'execution.json')
            execution['eventsHash'] = m.digest(events)
            (output / 'execution.json').write_text(json.dumps(execution))
            return value
        with patch.object(b.author, 'invoke', side_effect=completed_transport):
            result = b.run_batch(case.args, case.plan, case.batch, case.catalogue)
        self.assertEqual(result['verdict'], 'PASS')
        uid = case.batch['uids'][0]
        with patch.object(m, 'corpus_data'):
            status = m.review_status(case.root, case.args.corpus_root, uid)
            self.assertEqual((status['modelReview'], status['reviewMode']), ('PASS', 'batch-v1'))
            self.assertFalse(status['approvalGranted'])
            self.assertFalse(status['humanPerCardReview'])
            self.assertIn('sharedReviewHash', status['hashes'])
            original_source = source_path.read_bytes()
            outside = case.root / 'outside-source.json'
            outside.write_bytes(original_source)
            source_path.unlink()
            source_path.symlink_to(outside)
            with patch('author.load', wraps=m.load) as source_load:
                with self.assertRaisesRegex(ValueError, 'corpus'):
                    m.review_status(case.root, case.args.corpus_root, uid)
            self.assertNotIn(source_path, [call.args[0] for call in source_load.call_args_list])
            source_path.unlink()
            source_path.write_bytes(original_source)
            events_file = b.stage_path(case.root, case.batch['batchId'], 'review') / 'events.jsonl'
            original_events = events_file.read_text()
            events_file.write_text('incomplete')
            with self.assertRaises(ValueError): m.review_status(case.root, case.args.corpus_root, uid)
            events_file.write_text(original_events)
            review_file = case.root / 'authoring' / uid / 'review.json'
            review_file.write_text('{}')
            with self.assertRaises(ValueError): m.review_status(case.root, case.args.corpus_root, uid)
        self.assertEqual(2, len(case.calls))  # Only the synthetic initial generation and review.


if __name__ == '__main__':
    unittest.main()
