import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pipeline', Path(__file__).with_name('pipeline.py'))
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


class PipelineTests(unittest.TestCase):
    def test_private_coverage_exports_only_public_ids_and_counts(self):
        class Page:
            def __init__(self, text):
                self.text = text

            def extract_text(self):
                return self.text

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pdf = root / 'input.pdf'
            pdf.write_bytes(b'synthetic fixture')
            taxonomy = root / 'taxonomy.json'
            pipeline.save(taxonomy, {'concepts': [{'conceptId': 's3', 'terms': ['S3']}]})
            args = SimpleNamespace(root=root / 'control', pdf=pdf, private_root=root / 'private', taxonomy=taxonomy)
            marker = 'SYNTHETIC_PRIVATE_EXAM_MARKER'
            pages = [Page('S3 ' + marker), Page(''), Page('S3X is not the service name')]
            with patch('pypdf.PdfReader', return_value=SimpleNamespace(pages=pages)):
                pipeline.private_coverage(args)
            public = (args.root / 'curriculum/pdf-coverage.json').read_text()
            self.assertNotIn(marker, public)
            self.assertNotIn(str(args.private_root), public)
            data = pipeline.load(args.root / 'curriculum/pdf-coverage.json')
            self.assertEqual({'s3': 1}, data['conceptPageHits'])
            self.assertEqual(1, data['emptyTextPages'])
            self.assertEqual(2, data['unmappedPages'])
            self.assertIn(marker, (args.private_root / 'pages/0001.txt').read_text())
            self.assertEqual(0o600, (args.private_root / 'pages/0001.txt').stat().st_mode & 0o777)
            self.assertEqual(0o700, args.private_root.stat().st_mode & 0o777)

    def test_official_url_rejects_credentials_host_confusion_and_non_https(self):
        for url in ['http://docs.aws.amazon.com/x', 'https://docs.aws.amazon.com.evil/x',
                    'https://user:secret@docs.aws.amazon.com/x', 'https://aws.amazon.com:444/x']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                pipeline.official_url(url)
        self.assertEqual('https://docs.aws.amazon.com/x', pipeline.official_url('https://docs.aws.amazon.com/x'))

    def test_deck_preserves_bilingual_fields_and_refuses_missing_translation(self):
        text = '# deck: aws-saa-fundamentals\n\n## u-one | d1\nTOPIC: Compute\nQ:\nQuestion?\nQ_ZH:\n问题？\nA:\nAnswer.\nA_ZH:\n答案。\nSOURCE: https://docs.aws.amazon.com/x\nQuote.\n'
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'deck.md'
            p.write_text(text)
            card = pipeline.parse_deck(p)[0]
            self.assertEqual('问题？', card['questionZh'])
            self.assertEqual('Quote.', card['sourceQuote'])
            p.write_text(text.replace('A_ZH:\n答案。\n', ''))
            with self.assertRaises(ValueError):
                pipeline.parse_deck(p)

    def test_corpus_detects_tampered_chunks_and_wrong_embedding_space(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            manifest = {'model': pipeline.MODEL, 'dimension': 384, 'chunkCount': 1,
                        'sources': [{'sourceId': 's', 'sourceVersion': 'v'}]}
            chunk = {'chunkId': 'c', 'sourceId': 's', 'sourceVersion': 'v', 'text': 'official',
                     'textSha256': pipeline.digest('official'), 'url': 'https://docs.aws.amazon.com/x'}
            pipeline.save(root / 'corpus/manifest.json', manifest)
            pipeline.save(root / 'corpus/chunks.json', [chunk])
            pipeline.verified_corpus(root)
            chunk['text'] = 'injected replacement'
            pipeline.save(root / 'corpus/chunks.json', [chunk])
            with self.assertRaises(ValueError):
                pipeline.verified_corpus(root)
            manifest['dimension'] = 768
            pipeline.save(root / 'corpus/manifest.json', manifest)
            with self.assertRaises(ValueError):
                pipeline.verified_corpus(root)


class ProfileRetrievalTests(unittest.TestCase):
    def profile_fixture(self, root):
        directory = root / 'models--Xenova--ms-marco-MiniLM-L-6-v2' / 'snapshots' / pipeline.RERANK_REVISION
        files = {}
        for name in pipeline.RERANK_FILES:
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(('synthetic-' + name).encode())
            files[name] = pipeline.digest(path.read_bytes())
        profile = {'retrievalConfigVersion': 2, 'corpusVersion': 'version', 'candidatePoolSize': 100,
                   'reranker': {'model': pipeline.RERANK_MODEL, 'revision': pipeline.RERANK_REVISION,
                                'license': 'apache-2.0', 'files': files}}
        return profile, directory

    def test_profile_requires_exact_local_artifacts_and_rejects_labels_or_unbounded_pools(self):
        import copy
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            profile, directory = self.profile_fixture(root)
            self.assertEqual(directory, pipeline.checked_profile(profile, root, 'version')[1])
            for field, value in [('candidatePoolSize', 101), ('candidatePoolSize', True),
                                 ('corpusVersion', 'other'), ('expectedAnswer', 'hidden label')]:
                changed = {**profile, field: value}
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    pipeline.checked_profile(changed, root, 'version')
            (directory / 'onnx/model.onnx').write_bytes(b'changed')
            with self.assertRaises(ValueError):
                pipeline.checked_profile(profile, root, 'version')
            (directory / 'onnx/model.onnx').unlink()
            with self.assertRaises(ValueError):
                pipeline.checked_profile(profile, root, 'version')

    def test_default_constructor_uses_fixed_profile_for_all_callers_and_only_local_models(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            profile, directory = self.profile_fixture(root)
            pipeline.save(root / 'corpus/retrieval-profile.json', profile)
            pipeline.save(root / 'corpus/index.json', {'corpusVersion': 'version', 'model': pipeline.MODEL,
                'dimension': pipeline.DIMENSION, 'chunkCount': 1})
            manifest = {'corpusVersion': 'version'}
            chunks = [{'chunkId': 'one', 'title': 'IPv6 egress', 'text': 'Outbound only IPv6 traffic'}]
            with patch.object(pipeline, 'verified_corpus', return_value=(manifest, chunks)), \
                    patch('fastembed.TextEmbedding') as embedding, \
                    patch('fastembed.rerank.cross_encoder.TextCrossEncoder') as reranker:
                index = pipeline.EvidenceIndex(root, root, 'local-test')
            self.assertEqual(profile, index.profile)
            profile['candidatePoolSize'] = 80
            self.assertEqual(100, index.profile['candidatePoolSize'])
            self.assertTrue(embedding.call_args.kwargs['local_files_only'])
            self.assertEqual(['CPUExecutionProvider'], reranker.call_args.kwargs['providers'])
            self.assertTrue(reranker.call_args.kwargs['local_files_only'])
            self.assertEqual(str(directory), reranker.call_args.kwargs['specific_model_path'])

    def fake_index(self, profile):
        from unittest.mock import Mock
        index = pipeline.EvidenceIndex.__new__(pipeline.EvidenceIndex)
        index.manifest = {'corpusVersion': 'version'}
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        index.root = Path(directory.name)
        index.container = 'local-test'
        index.profile = profile
        index.ids = {i: str(i) for i in range(12)}
        # The mixed scope fixture contains both IPv4 and IPv6 evidence; only query/title/text enter rerank.
        index.by_id = {str(i): {'chunkId': str(i), 'title': 'IPv4 NAT' if i else 'IPv6 egress',
                               'text': ('IPv4 translation' if i else 'IPv6 outbound egress') + 'x' * 1400,
                               'url': 'https://docs.aws.amazon.com/vpc/'} for i in range(12)}
        for key, chunk in index.by_id.items():
            chunk['url'] += key
            chunk.update(sourceId=pipeline.digest(chunk['url']), sourceVersion=pipeline.digest(chunk['text']),
                         charStart=0, charEnd=len(chunk['text']), textSha256=pipeline.digest(chunk['text']))
            pipeline.save(index.root / 'corpus/sources' / (chunk['sourceId'] + '.json'), {
                'sourceId': chunk['sourceId'], 'sourceVersion': chunk['sourceVersion'], 'url': chunk['url'],
                'finalUrl': chunk['url'], 'title': chunk['title'], 'text': chunk['text'], 'chunks': [chunk]})
        index.model = Mock()
        index.model.embed.return_value = iter([[0.1] * 384])
        index.bm = Mock()
        index.bm.scores.return_value = {i: 12 - i for i in range(12)}
        index.reranker = Mock()
        index.reranker.rerank.return_value = [100.0] + [float(i) for i in range(1, 12)]
        return index

    def test_profile_reranks_same_original_chunks_and_hashes_the_profile(self):
        profile = {'candidatePoolSize': 100, 'retrievalConfigVersion': 2, 'reranker': {'files': {'model': 'sha'}}}
        index = self.fake_index(profile)
        query = 'Compare IPv4 NAT and IPv6 outbound egress.'
        with patch.object(pipeline, 'sql', return_value='\n'.join(f'{i}|{12 - i}' for i in range(12))) as sql:
            packet = index.retrieve(query, 'vector')
        self.assertIn('LIMIT 100;', sql.call_args.args[1])
        args, kwargs = index.reranker.rerank.call_args
        self.assertEqual(query, args[0])
        self.assertTrue(all(doc.startswith(('IPv4 NAT\n', 'IPv6 egress\n')) for doc in args[1]))
        self.assertEqual(['0', '11', '10', '9', '8', '7', '6', '5'], [c['chunkId'] for c in packet['evidence']])
        from evaluate import score
        reference = {'answerable': True, 'requiredEvidenceGroups': [{'alternatives': [{'chunkId': '11'}],
            'mandatoryScopeEvidenceGroups': [{'alternatives': [{'chunkId': '0'}]}]}]}
        self.assertEqual(1, score(reference, packet)['recallAt8'])
        missing_scope = {**packet, 'evidence': [c for c in packet['evidence'] if c['chunkId'] != '0']}
        self.assertEqual(0, score(reference, missing_scope)['recallAt8'])
        self.assertTrue(all(c is index.by_id[c['chunkId']] for c in packet['evidence']))
        self.assertLessEqual(sum(len(c['text']) for c in packet['evidence']), 12000)
        self.assertEqual(2, packet['retrievalConfigVersion'])
        self.assertEqual(pipeline.digest(pipeline.canonical(profile)), packet['retrievalProfileHash'])
        without_hash = {k: v for k, v in packet.items() if k != 'evidenceHash'}
        self.assertEqual(pipeline.digest(pipeline.canonical(without_hash)), packet['evidenceHash'])

    def test_baseline_keeps_original_rank_order_and_config(self):
        index = self.fake_index(None)
        with patch.object(pipeline, 'sql', return_value='\n'.join(f'{i}|{12 - i}' for i in range(12))) as sql:
            packet = index.retrieve('IPv6 egress', 'vector')
        self.assertIn('LIMIT 40;', sql.call_args.args[1])
        index.reranker.rerank.assert_not_called()
        self.assertEqual([str(i) for i in range(8)], [c['chunkId'] for c in packet['evidence']])
        self.assertEqual(1, packet['retrievalConfigVersion'])
        self.assertNotIn('retrievalProfileHash', packet)

    def test_reranker_failure_or_nonfinite_scores_never_fall_back(self):
        index = self.fake_index({'candidatePoolSize': 100})
        for result in [[float('nan')] * 12, [0.0], RuntimeError('local inference failure')]:
            index.model.embed.return_value = iter([[0.1] * 384])
            index.reranker.rerank.side_effect = result if isinstance(result, Exception) else None
            index.reranker.rerank.return_value = result
            with self.subTest(result=type(result)), patch.object(pipeline, 'sql', return_value='\n'.join(
                    f'{i}|{12 - i}' for i in range(12))), self.assertRaises((ValueError, RuntimeError)):
                index.retrieve('IPv6 egress', 'vector')

    def test_changed_source_or_offsets_fail_closed(self):
        index = self.fake_index({'candidatePoolSize': 100})
        chunk = index.by_id['0']
        pipeline.verify_source_chunk(index.root, chunk)
        chunk['charStart'] = 1
        with self.assertRaises(ValueError):
            pipeline.verify_source_chunk(index.root, chunk)
        chunk['charStart'] = 0
        source_path = index.root / 'corpus/sources' / (chunk['sourceId'] + '.json')
        source = pipeline.load(source_path)
        source['finalUrl'] = 'https://evil.example/page'
        pipeline.save(source_path, source)
        with self.assertRaises(ValueError):
            pipeline.verify_source_chunk(index.root, chunk)


class FinalRepairTests(unittest.TestCase):
    fake_index = ProfileRetrievalTests.fake_index
    def test_global_eligibility_keeps_facts_tables_and_exam_prose(self):
        base = {'url': 'https://docs.aws.amazon.com/aws-certification/latest/exam/domain.html',
                'heading': 'Task 2.1: Design reliable systems'}
        for text, reason in [('## Review\n\n### Consider', 'heading_only'),
                             ('## Task 2.1: Design reliable systems\n\nKnowledge of:\n- Queues',
                              'certification_competency_outline'),
                             ('- Selecting the appropriate bandwidth allocation',
                              'certification_competency_outline'),
                             ('SQS retains a message for four days by default.', None),
                             ('| Knowledge of: | Duration |\n| SQS | 4 days |', None),
                             ('## Duration\n\n4 days.', None)]:
            with self.subTest(text=text):
                self.assertEqual(reason, pipeline.eligibility_reason({**base, 'text': text}))
        self.assertIsNone(pipeline.eligibility_reason({**base, 'url': 'https://docs.aws.amazon.com/sqs/guide',
            'text': 'Skills in:\n- Selecting a queue'}))

    def test_purpose_normalization_preserves_identity_contexts(self):
        for query in ['IAM role in EC2', 'credentials and role in applications', 'permissions role in EC2',
                      'execution-role in Lambda', 'service role in applications', 'instance-profile role in EC2',
                      'trust policy role in EC2', 'assume role in application', 'STS role in EC2']:
            with self.subTest(query=query):
                self.assertEqual(query, pipeline.normalize_purpose_query(query))
        self.assertEqual('A cache purpose for serving requests',
                         pipeline.normalize_purpose_query('A cache role in serving requests'))
        self.assertEqual('EC2 instance purpose for running applications',
                         pipeline.normalize_purpose_query('EC2 instance role in running applications'))

    def test_final_profile_rejects_strategy_and_rule_tampering(self):
        profile = pipeline.final_profile('version', 'vector')
        self.assertEqual((profile, None), pipeline.checked_profile(profile, Path('/unused'), 'version'))
        for field, value in [('candidatePoolSize', 80), ('selectedStrategy', 'answer'),
                             ('eligibilityVersion', True), ('purposeNormalizationVersion', 2),
                             ('goldUrl', 'https://docs.aws.amazon.com/x')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                pipeline.checked_profile({**profile, field: value}, Path('/unused'), 'version')
        index = self.fake_index(profile)
        with self.assertRaisesRegex(ValueError, 'Strategy differs'):
            index.retrieve('cache purpose', 'rrf')

    def test_final_repair_filters_before_limits_and_preserves_all_candidates(self):
        from unittest.mock import Mock
        profile = pipeline.final_profile('version', 'vector')
        index = self.fake_index(profile)
        index.excluded = {'0': 'heading_only'}
        index.model.embed = Mock(return_value=iter([[.1] * 384]))
        query = 'A cache role in serving requests'
        with patch.object(pipeline, 'sql', return_value='\n'.join(f'{i}|{12-i}' for i in range(1, 12))) as sql:
            packet = index.retrieve(query)
        self.assertIn("chunk_id NOT IN ('0') ORDER BY", sql.call_args.args[1])
        self.assertEqual(query, packet['query'])
        self.assertEqual('A cache purpose for serving requests', packet['normalizedQuery'])
        self.assertEqual([pipeline.QUERY_PREFIX + packet['normalizedQuery']], index.model.embed.call_args.args[0])
        index.reranker.rerank.assert_not_called()
        self.assertEqual(11, len(packet['initialCandidateRanks']))
        self.assertEqual(11, len(packet['candidateRanks']))
        self.assertEqual(11, len(packet['componentCandidateRanks']['bm25']))
        self.assertNotIn('0', [c['chunkId'] for c in packet['evidence']])
        self.assertEqual(8, len(packet['evidence']))
        self.assertEqual(profile['selectedStrategy'], packet['strategy'])

    def test_reranked_pool_is_complete_past_twenty(self):
        index = self.fake_index({'candidatePoolSize': 40, 'retrievalConfigVersion': 2, 'reranker': {}})
        index.ids = {i: str(i) for i in range(30)}
        for i in range(12, 30):
            index.by_id[str(i)] = {**index.by_id['1'], 'chunkId': str(i)}
        index.bm.scores.return_value = {i: 30-i for i in range(30)}
        index.reranker.rerank.return_value = list(range(30))
        with patch.object(pipeline, 'sql', return_value='\n'.join(f'{i}|{30-i}' for i in range(30))), \
                patch.object(pipeline, 'verify_source_chunk'):
            packet = index.retrieve('cache purpose', 'vector')
        self.assertEqual(30, len(packet['candidateRanks']))
        self.assertEqual(30, len(packet['initialCandidateRanks']))
        self.assertEqual(30, len(packet['componentCandidateRanks']['vector']))


if __name__ == '__main__':
    unittest.main()
