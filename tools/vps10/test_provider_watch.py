import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

P = Path(__file__).with_name('provider_watch.py')
SPEC = importlib.util.spec_from_file_location('provider_watch', P)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)

NOW = datetime(2026, 9, 20, 8, 0, tzinfo=timezone.utc)


def receipt(stamp='2026-09-20T07:30:00+00:00'):
    return {
        'last_sync_result': 'PASS',
        'real_review_count': 72,
        'sync_failure': None,
        'last_successful_provider_read': stamp,
        'last_successful_persistence': stamp,
    }


class WatchTests(unittest.TestCase):
    def test_valid_receipt(self):
        result = M.validate_receipt(receipt(), NOW)
        self.assertEqual(result['real_review_count'], 72)
        self.assertEqual(result['read_age_seconds'], 1800)

    def test_rejects_stale_receipt(self):
        with self.assertRaises(M.SafeFailure):
            M.validate_receipt(receipt('2026-09-20T04:00:00+00:00'), NOW)

    def test_rejects_failed_sync(self):
        value = receipt()
        value['last_sync_result'] = 'FAIL'
        value['sync_failure'] = 'SYNC_NOT_CONFIRMED'
        with self.assertRaises(M.SafeFailure):
            M.validate_receipt(value, NOW)


if __name__ == '__main__':
    unittest.main()
