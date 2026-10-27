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


if __name__ == '__main__':
    unittest.main()
