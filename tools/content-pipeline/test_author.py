import copy
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from author import FIELDS, invoke, validate_card, validate_execution, validate_packet, validate_review
from pipeline import CHUNKING, DIMENSION, MODEL, canonical, digest, save


def fixture():
    text = 'A service provides a capability. The deployment has a necessary limitation.'
    packet = {'goal': {'stableUid': 'fixture'}, 'evidence': [{
        'evidenceId': 'ev-1', 'sourceId': 's1', 'sourceVersion': digest(text), 'chunkId': 'c1',
        'url': 'https://docs.aws.amazon.com/fixture', 'text': text, 'charStart': 20}]}
    locale = {'question': 'What capability?', 'answer': 'A capability.', 'reason': 'A reason.',
              'examPurpose': 'Understand its scope.', 'boundary': '', 'frontHelp': []}
    card = {'conceptId': 'fixture', 'status': 'draft', 'en': locale, 'zh': copy.deepcopy(locale),
            'primaryEvidenceId': 'ev-1', 'warnings': [], 'claims': [
                {'field': field, 'evidence': [{'evidenceId': 'ev-1', 'quote': 'provides a capability'}]
                 if field not in ('boundary', 'frontHelp') else []} for field in FIELDS]}
    return packet, card


class AuthorTests(unittest.TestCase):
    def prepared(self, root):
        packet, card = fixture()
        text = packet['evidence'][0]['text']
        url = packet['evidence'][0]['url']
        sid, version = digest(url), digest(text)
        chunk = {**packet['evidence'][0], 'sourceId': sid, 'sourceVersion': version,
                 'charStart': 0, 'charEnd': len(text), 'textSha256': digest(text)}
        sources = [{'sourceId': sid, 'sourceVersion': version}]
        cv = digest(canonical({'sources': [(sid, version)], 'chunking': CHUNKING, 'embeddingModel': MODEL}))
        save(root / 'corpus/corpus/manifest.json', {'model': MODEL, 'dimension': DIMENSION, 'chunkCount': 1,
             'sources': sources, 'chunking': CHUNKING, 'corpusVersion': cv})
        save(root / 'corpus/corpus/chunks.json', [chunk])
        save(root / 'corpus/corpus/sources' / (sid + '.json'), {'url': url, 'sourceId': sid,
             'sourceVersion': version, 'text': text, 'chunks': [chunk]})
        save(root / 'run.json', {'nodes': {'A2R-corpus': {'corpusVersion': cv}}})
        goal = {'stableUid': 'fixture', 'retrievalQueryEn': 'service capability'}
        catalogue = {'goals': [goal]}
        catalogue['curriculumHash'] = digest(canonical(catalogue))
        packet = {'corpusVersion': cv, 'query': goal['retrievalQueryEn'], 'strategy': 'bm25',
                  'evidence': [chunk], 'candidateRanks': [], 'retrievalConfigVersion': 1,
                  'status': 'retrieved_not_semantically_validated'}
        packet['evidenceHash'] = digest(canonical(packet))
        packet.update(goal=goal, curriculumHash=catalogue['curriculumHash'])
        packet['packetHash'] = digest(canonical(packet))
        return catalogue, goal, packet

    def test_packet_is_bound_to_original_source_not_its_own_hashes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            catalogue, goal, packet = self.prepared(root)
            validate_packet(root, root / 'corpus', catalogue, goal, packet)
            for mutation in ('text', 'url', 'corpusVersion', 'curriculumHash'):
                with self.subTest(mutation=mutation):
                    changed = copy.deepcopy(packet)
                    if mutation in ('text', 'url'):
                        changed['evidence'][0][mutation] = 'untrusted replacement'
                    else:
                        changed[mutation] = 'untrusted replacement'
                    base = {k: v for k, v in changed.items() if k not in
                            {'evidenceHash', 'packetHash', 'goal', 'curriculumHash'}}
                    changed['evidenceHash'] = digest(canonical(base))
                    changed['packetHash'] = digest(canonical({k: v for k, v in changed.items() if k != 'packetHash'}))
                    with self.assertRaises(ValueError):
                        validate_packet(root, root / 'corpus', catalogue, goal, changed)

    def test_modified_source_text_is_rejected_against_pinned_version(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            catalogue, goal, packet = self.prepared(root)
            source_path = next((root / 'corpus/corpus/sources').glob('*.json'))
            source = __import__('json').loads(source_path.read_text())
            source['text'] += ' injected fact'
            save(source_path, source)
            with self.assertRaisesRegex(ValueError, 'source text'):
                validate_packet(root, root / 'corpus', catalogue, goal, packet)

    def test_packet_rejects_corpus_symlinks_before_read(self):
        for relative, outside in [('sources/source', True), ('sources/source', False),
                                  ('sources', True), ('manifest.json', True),
                                  ('chunks.json', True), ('.', True)]:
            with self.subTest(relative=relative, outside=outside), tempfile.TemporaryDirectory() as td:
                root = Path(td).resolve()
                catalogue, goal, packet = self.prepared(root)
                corpus = root / 'corpus/corpus'
                source = corpus / 'sources' / (packet['evidence'][0]['sourceId'] + '.json')
                path = source if relative == 'sources/source' else corpus / relative
                target = root / 'outside' if outside else corpus / 'another-source.json'
                path.rename(target)
                path.symlink_to(target, target_is_directory=target.is_dir())
                opened = []
                original_open = Path.open
                def spy_open(path, *args, **kwargs):
                    opened.append(path)
                    return original_open(path, *args, **kwargs)
                with patch.object(Path, 'open', spy_open):
                    with self.assertRaisesRegex(ValueError, 'corpus'):
                        validate_packet(root, root / 'corpus', catalogue, goal, packet)
                self.assertFalse(any(p.resolve().is_relative_to(target) for p in opened), opened)

    def test_packet_rejects_noncanonical_source_id_before_source_read(self):
        from pipeline import load
        for source_id in ['../outside', '/tmp/outside', 'A' * 64, 'a' * 63, 'a' * 65, 'g' * 64]:
            with self.subTest(source_id=source_id), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                catalogue, goal, packet = self.prepared(root)
                chunk = packet['evidence'][0]
                chunk['sourceId'] = source_id
                manifest = load(root / 'corpus/corpus/manifest.json')
                manifest['sources'][0]['sourceId'] = source_id
                cv = digest(canonical({'sources': [(source_id, chunk['sourceVersion'])],
                                      'chunking': CHUNKING, 'embeddingModel': MODEL}))
                manifest['corpusVersion'] = packet['corpusVersion'] = cv
                save(root / 'corpus/corpus/manifest.json', manifest)
                save(root / 'corpus/corpus/chunks.json', [chunk])
                save(root / 'run.json', {'nodes': {'A2R-corpus': {'corpusVersion': cv}}})
                packet['evidenceHash'] = digest(canonical({k: v for k, v in packet.items() if k not in
                    {'evidenceHash', 'packetHash', 'goal', 'curriculumHash'}}))
                packet['packetHash'] = digest(canonical({k: v for k, v in packet.items() if k != 'packetHash'}))
                with patch('author.load', wraps=load) as source_load:
                    with self.assertRaisesRegex(ValueError, 'source identity'):
                        validate_packet(root, root / 'corpus', catalogue, goal, packet)
                self.assertEqual([root / 'run.json'], [call.args[0] for call in source_load.call_args_list])

    def test_regular_corpus_accepts_trusted_base_alias(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            catalogue, goal, packet = self.prepared(root)
            # macOS temporary roots may use /var, whose trusted system ancestor is a symlink.
            if root.is_relative_to('/private/var'):
                root = Path('/var') / root.relative_to('/private/var')
            validate_packet(root, root / 'corpus', catalogue, goal, packet)

    def test_exact_quotes_record_source_offsets_not_semantic_pass(self):
        packet, card = fixture()
        result = validate_card(packet, card)
        self.assertTrue(result['structuralPass'])
        self.assertEqual(30, result['citations'][0]['quoteCharStart'])
        self.assertIn('semantic support requires', result['scope'])

    def test_paraphrased_quote_unknown_identity_or_omitted_claim_is_rejected(self):
        for change in ('quote', 'identity', 'claim'):
            with self.subTest(change=change):
                packet, card = fixture()
                if change == 'quote': card['claims'][0]['evidence'][0]['quote'] = 'invented paraphrase'
                if change == 'identity': card['conceptId'] = 'other'
                if change == 'claim': card['claims'].pop()
                with self.assertRaises(ValueError): validate_card(packet, card)

    def test_help_parity_and_evidence_are_required(self):
        packet, card = fixture()
        card['en']['frontHelp'] = [{'term': 'term', 'definition': 'meaning'}]
        with self.assertRaisesRegex(ValueError, 'help count'):
            validate_card(packet, card)
        card['zh']['frontHelp'] = copy.deepcopy(card['en']['frontHelp'])
        with self.assertRaisesRegex(ValueError, 'needs evidence'):
            validate_card(packet, card)

    def test_insufficient_evidence_never_becomes_publishable(self):
        packet, card = fixture()
        card['status'] = 'insufficient_evidence'
        with self.assertRaises(ValueError): validate_card(packet, card)

    def test_unknown_model_outcome_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td) / 'card'
            (folder / 'generate-1').mkdir(parents=True)
            args = SimpleNamespace(root=Path(td), dotnet=Path('/not-used'))
            with self.assertRaisesRegex(ValueError, 'Unknown/incomplete'):
                invoke(args, folder, 'generate', 1, 'prompt', {'type': 'object'})

    def test_execution_receipt_detects_event_tamper(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for name, value in [('result.json', '{}'), ('events.jsonl', 'completed'), ('stderr.log', '')]:
                (root / name).write_text(value)
            save(root / 'execution.json', {'success': True, 'exitCode': 0, 'inputHash': digest('p'),
                 'schemaHash': digest('{}'), 'outputHash': digest('{}'),
                 'eventsHash': digest('completed'), 'stderrHash': digest('')})
            validate_execution(root, 'p', '{}')
            (root / 'events.jsonl').write_text('changed')
            with self.assertRaisesRegex(ValueError, 'eventsHash'):
                validate_execution(root, 'p', '{}')


if __name__ == '__main__':
    unittest.main()
