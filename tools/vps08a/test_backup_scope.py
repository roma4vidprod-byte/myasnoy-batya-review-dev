"""Offline backup compatibility, no provider/DB/network operations."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('previous', Path(__file__).parents[1]/'vps05/test_ops.py')
previous = importlib.util.module_from_spec(spec)
spec.loader.exec_module(previous)
ops = previous.ops

def expanded(n=1):
    s = previous.snapshot()
    s['catalog']['schemas'] = ops.SCHEMAS + ['vps_yandex_private']
    s['catalog']['vps08a_scope'] = dict(companies_valid=True, locations_valid=True, session_scope_valid=True, session_count=n)
    for table, count in [('public.review_companies',3),('public.review_locations',3),('review_private.yandex_sessions',n)]:
        s['rows'][table]['count'] = count
    return s

class BackupScope(unittest.TestCase):
    def test_previous_lab_unchanged(self): ops.validate_snapshot(previous.snapshot())
    def test_empty_session_scope(self): ops.validate_snapshot(expanded(0))
    def test_encrypted_session_scope(self): ops.validate_snapshot(expanded())
    def test_unchanged_restore(self): self.assertTrue(ops.compare(expanded(),copy.deepcopy(expanded()))['schema_equal'])
    def test_wrong_scope(self):
        for field in ['companies_valid','locations_valid','session_scope_valid']:
            s=expanded();s['catalog']['vps08a_scope'][field]=False
            with self.subTest(field=field),self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)
    def test_duplicate_session(self):
        with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(expanded(2))
    def test_new_review_denied(self):
        s=expanded();s['rows']['public.review_external_reviews']['count']=3
        with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)
    def test_scope_without_private_schema_denied(self):
        s=expanded();s['catalog']['schemas']=ops.SCHEMAS
        with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)
    def test_unknown_schema_denied(self):
        s=expanded();s['catalog']['schemas'].append('other')
        with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)
    def test_queue_still_denied(self):
        s=expanded();s['rows']['public.review_sync_runs']['count']=1
        with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)

if __name__=='__main__':unittest.main(verbosity=2)
