import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('retrieval_dev', Path(__file__).with_name('retrieval_dev.py'))
retrieval_dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retrieval_dev)


class DevProbeTests(unittest.TestCase):
    def test_dev_guard_rejects_holdout_or_incomplete_family(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'dev.json'
            queries = [{'split': 'dev'} for _ in range(40)]
            retrieval_dev.save(path, {'queries': queries})
            self.assertEqual(40, len(retrieval_dev.dev_references(path)['queries']))
            queries[0]['split'] = 'holdout'
            retrieval_dev.save(path, {'queries': queries})
            with self.assertRaises(ValueError):
                retrieval_dev.dev_references(path)

    def test_score_cache_preserves_query_document_pairs_without_labels(self):
        encoder = Mock()
        encoder.rerank.side_effect = [[.2, .5], [.7]]
        cache = retrieval_dev.ScoreCache(encoder)
        self.assertEqual([.2, .5, .2], cache.rerank('compare scopes', ['IPv4', 'IPv6', 'IPv4'], 16))
        self.assertEqual([.5, .7], cache.rerank('compare scopes', ['IPv6', 'both'], 16))
        self.assertEqual(3, cache.calls)
        self.assertEqual(('compare scopes', ['both']), encoder.rerank.call_args.args)
