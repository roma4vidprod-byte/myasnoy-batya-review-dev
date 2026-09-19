"""Regression for duplicate-unit measurement; no systemd/DB/network needed."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native', Path(__file__).with_name('native.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class ObservationTests(unittest.TestCase):
    def test_finished_oneshot_may_clear_invocation_id(self):
        active = {'value': True}
        def prop(key):
            if key == 'InvocationID':
                return 'synthetic-invocation' if active['value'] else ''
            return 'activating' if active['value'] else 'inactive'
        def done():
            active['value'] = False
        with patch.object(native, 'fixture'), patch.object(native, 'system') as system, \
             patch.object(native, 'wait_active_lock'), patch.object(native, 'prop', side_effect=prop), \
             patch.object(native, 'wait_done', side_effect=done), \
             patch.object(native, 'counts', return_value={'succeeded':1}):
            self.assertTrue(native.systemd_duplicate()['same_invocation'])
            self.assertEqual(system.call_args_list[1].args, ('start','--no-block',native.UNIT))
            self.assertFalse(active['value'])


if __name__ == '__main__':
    unittest.main()
