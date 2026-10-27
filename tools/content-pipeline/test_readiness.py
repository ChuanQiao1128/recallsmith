import unittest
from readiness import exact_rows, metrics


class ReadinessTests(unittest.TestCase):
    def test_actual_outcome_counts_do_not_turn_refusal_into_positive_recall(self):
        rows = [{'answerable': False, 'refused': True, 'wrongDeploymentAccepted': False, 'unsupportedAccepted': False},
                {'answerable': True, 'refused': True, 'wrongDeploymentAccepted': False, 'unsupportedAccepted': False},
                {'answerable': True, 'refused': False, 'wrongDeploymentAccepted': True, 'unsupportedAccepted': True}]
        self.assertEqual({'negativeCount': 1, 'negativeRefused': 1, 'falseRefusals': 1,
                          'wrongDeploymentAccepted': 1, 'unsupportedAccepted': 1}, metrics(rows))

    def test_missing_or_duplicate_model_case_cannot_count_as_reviewed(self):
        for rows in ([{'id': 'a'}], [{'id': 'a'}, {'id': 'a'}], [{'id': 'a'}, {'id': 'unexpected'}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                exact_rows({'cases': rows}, ['a', 'b'])


if __name__ == '__main__':
    unittest.main()
