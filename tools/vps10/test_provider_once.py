import importlib.util
import sys
import types
import unittest
from pathlib import Path

if sys.platform == 'win32':
    fake = types.ModuleType('fcntl')
    fake.LOCK_EX, fake.LOCK_NB, fake.LOCK_UN = 1, 2, 8
    fake.flock = lambda *args: None
    sys.modules['fcntl'] = fake

P = Path(__file__).with_name('provider_once.py')
SPEC = importlib.util.spec_from_file_location('provider_once', P)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def valid():
    return {
        'ok': True, 'operation': 'manual-replay',
        'state_before': 'READY', 'revision_before': 6, 'revision': 6,
        'session_mutations': 'OFF', 'review_persistence': 'SUCCESS',
        'notifications': 'OFF', 'scope_valid': True, 'contract_valid': True,
        'attempted': 4, 'completed': 4, 'http_statuses': [200] * 4,
        'unique': 72, 'pages': 4,
        'pagination_report': {
            'classification': 'STRICT_STABLE_COMPLETE',
            'duplicates': 0, 'terminal_page_observed': True
        },
        'persistence_result': {
            'seen': 72, 'inserted': 0, 'updated': 0, 'unchanged': 72
        }
    }


class ValidateTests(unittest.TestCase):
    def test_valid_replay(self):
        before = {'real': 72, 'synthetic': 2, 'duplicates': 0}
        after = {'real': 72, 'synthetic': 2, 'duplicates': 0}
        result = M.validate_sync(valid(), before, after, 6)
        self.assertEqual(result['real_review_count'], 72)
        self.assertEqual(result['unchanged'], 72)

    def test_rejects_http_failure(self):
        value = valid()
        value['http_statuses'][2] = 503
        with self.assertRaises(M.SafeFailure):
            M.validate_sync(
                value,
                {'real': 72, 'synthetic': 2, 'duplicates': 0},
                {'real': 72, 'synthetic': 2, 'duplicates': 0},
                6
            )

    def test_rejects_insert_count_mismatch(self):
        value = valid()
        value['persistence_result'] = {
            'seen': 72, 'inserted': 1, 'updated': 0, 'unchanged': 71
        }
        with self.assertRaises(M.SafeFailure):
            M.validate_sync(
                value,
                {'real': 72, 'synthetic': 2, 'duplicates': 0},
                {'real': 72, 'synthetic': 2, 'duplicates': 0},
                6
            )

    def test_rejects_session_mutation(self):
        value = valid()
        value['session_mutations'] = 'HEALTH_CAS_ONLY'
        with self.assertRaises(M.SafeFailure):
            M.validate_sync(
                value,
                {'real': 72, 'synthetic': 2, 'duplicates': 0},
                {'real': 72, 'synthetic': 2, 'duplicates': 0},
                6
            )

    def test_rejects_revision_drift(self):
        value = valid()
        value['revision'] = 7
        with self.assertRaises(M.SafeFailure):
            M.validate_sync(
                value,
                {'real': 72, 'synthetic': 2, 'duplicates': 0},
                {'real': 72, 'synthetic': 2, 'duplicates': 0},
                6
            )


if __name__ == '__main__':
    unittest.main()
