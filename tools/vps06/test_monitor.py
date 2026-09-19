"""Offline regressions for optional worker observations in the existing monitor."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('vps05_tests', Path(__file__).parents[1] / 'vps05/test_ops.py')
previous = importlib.util.module_from_spec(spec)
spec.loader.exec_module(previous)


class WorkerMonitorTests(unittest.TestCase):
    def worker(self, **kw):
        data = previous.sample()
        data['worker'] = dict(installed=True, service_result='success', last_ok=True, timer_state='inactive', **kw)
        return data

    def test_disabled_timer_is_safe(self):
        self.assertEqual(previous.ops.evaluate_monitor(self.worker())['status'], 'PASS')

    def test_missing_worker_keeps_vps05(self):
        self.assertEqual(previous.ops.evaluate_monitor(previous.sample())['status'], 'PASS')

    def test_worker_nonzero_visible(self):
        data = self.worker()
        data['worker']['service_result'] = 'exit-code'
        self.assertIn('WORKER_FAILED', previous.ops.evaluate_monitor(data)['codes'])

    def test_guard_failure_visible(self):
        data = self.worker()
        data['worker']['last_ok'] = False
        self.assertIn('WORKER_FAILED', previous.ops.evaluate_monitor(data)['codes'])

    def test_bad_timer_visible(self):
        data = self.worker()
        data['worker']['timer_state'] = 'failed'
        self.assertIn('WORKER_TIMER_STATE', previous.ops.evaluate_monitor(data)['codes'])

    def test_busy_lock_not_error(self):
        data = self.worker(lock_refused=True)
        self.assertEqual(previous.ops.evaluate_monitor(data)['status'], 'PASS')


if __name__ == '__main__':
    unittest.main()
