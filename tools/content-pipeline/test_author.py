import copy
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from author import FIELDS, invoke, validate_card, validate_execution, validate_review
from pipeline import digest, save


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
