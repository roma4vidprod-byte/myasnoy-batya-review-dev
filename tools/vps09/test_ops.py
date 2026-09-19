import copy,importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('base',Path(__file__).parents[1]/'vps08a/test_backup_scope.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
ops=base.ops
def snapshot(n=71):
 s=base.expanded();s['catalog']['synthetic_reviews_only']=n==0
 s['catalog']['vps09_persistence']={'synthetic_count':2,'real_count':n,'unexpected_count':0,'ratings_valid':True}
 s['rows']['public.review_external_reviews']['count']=n+2
 return s
class VPS09(unittest.TestCase):
 def test_pre_persistence(self):ops.validate_snapshot(snapshot(0))
 def test_real_plus_synthetic(self):ops.validate_snapshot(snapshot())
 def test_no_hardcoded_71(self):ops.validate_snapshot(snapshot(73))
 def test_synthetic_not_replaced(self):
  s=snapshot();s['catalog']['vps09_persistence']['synthetic_count']=1
  with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)
 def test_unknown_scope(self):
  s=snapshot();s['catalog']['vps09_persistence']['unexpected_count']=1
  with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)
 def test_bad_ratings(self):
  s=snapshot();s['catalog']['vps09_persistence']['ratings_valid']=False
  with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)
 def test_old_guard_not_weakened(self):
  s=base.expanded();s['rows']['public.review_external_reviews']['count']=73
  with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)
 def test_queue_still_denied(self):
  s=snapshot();s['rows']['public.review_sync_runs']['count']=1
  with self.assertRaises(ops.SafeFailure):ops.validate_snapshot(s)
 def test_backup_roundtrip(self):self.assertTrue(ops.compare(snapshot(),copy.deepcopy(snapshot()))['all_table_counts_hashes_equal'])
 def test_monitor_safe_receipt(self):
  s=base.previous.sample();s['provider']={'configured':True,'receipt_valid':True,'last_sync_result':'PASS','sync_failure':None}
  self.assertEqual(ops.evaluate_monitor(s)['status'],'PASS')
 def test_monitor_failure(self):
  s=base.previous.sample();s['provider']={'configured':True,'receipt_valid':True,'last_sync_result':'FAIL','sync_failure':'SYNC_NOT_CONFIRMED'}
  self.assertIn('PROVIDER_SYNC_FAILED',ops.evaluate_monitor(s)['codes'])
 def test_monitor_unknown(self):
  s=base.previous.sample();s['provider']={'configured':True,'receipt_valid':False}
  self.assertIn('PROVIDER_SYNC_RECEIPT',ops.evaluate_monitor(s)['codes'])
if __name__=='__main__':unittest.main(verbosity=2)
