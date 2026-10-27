import json
from pathlib import Path
import tempfile
import unittest

from curate import require_reconciled_revisions
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


if __name__ == '__main__':
    unittest.main()
