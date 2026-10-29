from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from pipeline import digest
from retrieval_v4 import StructuralIndex
from retrieval_v4_dev import DevelopmentEvidenceIndexV4


class DevelopmentAdapterTests(unittest.TestCase):
    def index(self):
        text = 'A factual statement.\n'
        source = {'sourceId': digest('source'), 'sourceVersion': digest(text), 'text': text}
        chunk = {'chunkId': 'a' * 32, 'evidenceId': 'ev-' + 'a' * 32,
                 'sourceId': source['sourceId'], 'sourceVersion': source['sourceVersion'],
                 'charStart': 0, 'charEnd': len(text), 'text': text, 'textSha256': digest(text)}
        obj = DevelopmentEvidenceIndexV4.__new__(DevelopmentEvidenceIndexV4)
        obj.structural = StructuralIndex([source], [chunk])
        obj.map_hash = '0' * 64
        obj.base = SimpleNamespace(container='synthetic-pg',
                                   manifest={'corpusVersion': 'synthetic-version'},
                                   model=SimpleNamespace(embed=lambda q: iter([[0.0] * 384])))
        return obj, chunk

    def test_adapter_runs_only_bounded_vector_queries_and_retains_originals(self):
        index, chunk = self.index()
        with patch('retrieval_v4_dev.sql', return_value=chunk['chunkId'] + '|0.5') as query:
            packet = index.retrieve('For Z, what A; how B', 'A')
        self.assertEqual(3, query.call_count)
        for call in query.call_args_list:
            self.assertTrue(call.args[1].startswith('SELECT chunk_id'))
            self.assertTrue(call.args[1].endswith('LIMIT 40;'))
        self.assertIs(chunk, packet['evidence'][0])
        self.assertEqual('development_only_not_semantically_validated', packet['status'])
        self.assertNotIn('meanRecallAt8', packet)
        self.assertFalse(packet['releaseAuthorized'])

    def test_bad_candidates_and_wrong_configuration_fail_before_packing(self):
        index, chunk = self.index()
        for output in ['', 'broken', chunk['chunkId'] + '|nan', 'missing|0.1',
                       (chunk['chunkId'] + '|0.1\n') * 2]:
            with self.subTest(output=output), patch('retrieval_v4_dev.sql', return_value=output), self.assertRaises(ValueError):
                index.retrieve('Original question?', 'A')
        with patch('retrieval_v4_dev.sql') as query, self.assertRaises(ValueError):
            index.retrieve('Original question?', 'C')
        query.assert_not_called()

    def test_loader_pins_local_vector_profile_without_opening_active_profile(self):
        index, chunk = self.index()
        source = index.structural.sources[chunk['sourceId']]
        with patch('retrieval_v4_dev.verified_corpus', return_value=({'corpusVersion': 'v'}, [chunk])), \
                patch('retrieval_v4_dev.EvidenceIndex', return_value=index.base) as loader, \
                patch('retrieval_v4_dev.verify_source_chunk') as verify, \
                patch('retrieval_v4_dev.load', return_value=source) as load:
            DevelopmentEvidenceIndexV4(Path('/synthetic'), Path('/cache'), 'pg')
        self.assertEqual(3, loader.call_args.kwargs['profile']['retrievalConfigVersion'])
        self.assertEqual('vector', loader.call_args.kwargs['profile']['selectedStrategy'])
        verify.assert_called_once_with(Path('/synthetic'), chunk)
        self.assertTrue(all('retrieval-profile' not in str(c.args[0]) for c in load.call_args_list))


if __name__ == '__main__':
    unittest.main()
