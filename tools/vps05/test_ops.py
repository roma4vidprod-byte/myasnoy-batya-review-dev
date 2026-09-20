"""Offline operational regressions only; no SSH, DB, providers or credentials."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('vps05_ops', Path(__file__).with_name('ops.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


def sample():
    ports = (5432, 19999, 13001, 13000)
    return {'disk_free': 10*1024**3, 'ram_available': 1024**3, 'load1': 0.1, 'cpus': 2,
            'failed_units': 0, 'services': {s: 'active' for s in ops.SERVICES},
            'health': {'healthz': 200, 'readyz': 200}, 'backup_bytes': 1024, 'backup_age_seconds': 2,
            'listeners': [f'LISTEN 0 100 127.0.0.1:{p} 0.0.0.0:*' for p in ports]
                         + ['LISTEN 0 100 0.0.0.0:22 0.0.0.0:*', 'LISTEN 0 100 [::]:22 [::]:*']}


def snapshot():
    counts = {'auth.users': 3, 'public.review_companies': 2, 'public.review_locations': 2,
              'public.review_admins': 2, 'public.review_external_reviews': 2,
              'public.review_provider_connections': 0, 'public.review_sync_runs': 0,
              'review_private.yandex_sessions': 0, 'cron.job': 0}
    return {'schema_sha256': 'synthetic-schema', 'catalog': {'schemas': ops.SCHEMAS,
            'version': 'vps04-auth-api-v1', 'synthetic_users_only': True, 'synthetic_reviews_only': True},
            'tables': [{'schema': 'public', 'owner': 'postgres', 'rls': True, 'force': False},
                       {'schema': 'review_private', 'owner': 'postgres', 'rls': True, 'force': True},
                       {'schema': 'auth', 'owner': 'supabase_auth_admin', 'rls': True, 'force': False}],
            'rows': {k: {'count': v, 'sha256': 'synthetic'} for k, v in counts.items()}}


class Monitoring(unittest.TestCase):
    def test_healthy(self):
        self.assertEqual(ops.evaluate_monitor(sample())['status'], 'PASS')

    def check_failure(self, change, code):
        s = sample()
        change(s)
        self.assertIn(code, ops.evaluate_monitor(s)['codes'])

    def test_health_failure(self):
        self.check_failure(lambda s: s['health'].update(healthz=503), 'HEALTHZ_FAILED')

    def test_ready_failure(self):
        self.check_failure(lambda s: s['health'].update(readyz=503), 'READYZ_FAILED')

    def test_health_unknown_not_zero(self):
        self.check_failure(lambda s: s['health'].update(healthz=None), 'HEALTHZ_FAILED')

    def test_redirect_is_failure(self):
        self.check_failure(lambda s: s['health'].update(readyz=302), 'READYZ_FAILED')

    def test_public_listener(self):
        self.check_failure(lambda s: s['listeners'].append('LISTEN 0 100 0.0.0.0:5432 0.0.0.0:*'), 'LISTENER_MISMATCH')

    def test_ipv6_public_listener(self):
        self.check_failure(lambda s: s['listeners'].append('LISTEN 0 100 [::]:8080 [::]:*'), 'LISTENER_MISMATCH')

    def test_missing_internal_listener(self):
        self.check_failure(lambda s: s['listeners'].pop(0), 'LISTENER_MISMATCH')

    def test_ss_proc_fallback_ssh_wildcard(self):
        s = sample()
        s['listeners'][-1] = 'LISTEN 0 0 *:22 *:*'
        self.assertEqual(ops.evaluate_monitor(s)['status'], 'PASS')

    def test_ss_proc_fallback_nonssh_wildcard_denied(self):
        self.check_failure(lambda s: s['listeners'].append('LISTEN 0 0 *:5432 *:*'), 'LISTENER_MISMATCH')

    def test_kernel_listener_query_allowed_in_units(self):
        for name in ('monitor', 'backup'):
            text = Path(__file__).with_name(f'review-activator-{name}.service').read_text()
            family = next(x for x in text.splitlines() if x.startswith('RestrictAddressFamilies='))
            self.assertIn('AF_NETLINK', family)
            self.assertIn('IPAddressDeny=any', text)

    def test_local_resolver(self):
        s = sample()
        s['listeners'].append('LISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:*')
        self.assertEqual(ops.evaluate_monitor(s)['status'], 'PASS')

    def test_low_disk(self):
        self.check_failure(lambda s: s.update(disk_free=ops.MIN_FREE-1), 'DISK_LOW')

    def test_failed_service_fixture(self):
        self.check_failure(lambda s: s.update(failed_units=1), 'FAILED_UNITS')

    def test_required_service_down(self):
        self.check_failure(lambda s: s['services'].update({'review-lab-api.service': 'inactive'}), 'SERVICE_DOWN')

    def test_ram(self):
        self.check_failure(lambda s: s.update(ram_available=0), 'RAM_LOW')

    def test_load(self):
        self.check_failure(lambda s: s.update(load1=5), 'LOAD_HIGH')

    def test_backup_growth(self):
        self.check_failure(lambda s: s.update(backup_bytes=6*1024**3), 'BACKUP_GROWTH')

    def test_stale_backup(self):
        self.check_failure(lambda s: s.update(backup_age_seconds=37*3600), 'BACKUP_STALE')

    def test_missing_backup(self):
        self.check_failure(lambda s: s.update(backup_age_seconds=None), 'BACKUP_STALE')

    def test_evaluation_no_mutation(self):
        s = sample()
        old = copy.deepcopy(s)
        ops.evaluate_monitor(s)
        self.assertEqual(s, old)


class BackupRestore(unittest.TestCase):
    def test_backup_peer_auth_bounded_capabilities(self):
        text = Path(__file__).with_name('review-activator-backup.service').read_text()
        self.assertIn('User=root', text)
        self.assertIn('Environment=RA_EXPECTED_HOSTNAME=v3248121.hosted-by-vdsina.ru', text)
        self.assertIn('NoNewPrivileges=yes', text)
        self.assertIn('CapabilityBoundingSet=CAP_SETUID CAP_SETGID\n', text)
        self.assertIn('AmbientCapabilities=CAP_SETUID CAP_SETGID\n', text)

    def test_backup_host_guard_is_explicit_env_not_legacy_hostname(self):
        source = Path(__file__).with_name('ops.py').read_text()
        self.assertIn("EXPECTED_HOSTNAME = 'v3248121.hosted-by-vdsina.ru'", source)
        self.assertIn("os.environ.get('RA_EXPECTED_HOSTNAME', EXPECTED_HOSTNAME)", source)
        self.assertIn("socket.gethostname() == EXPECTED_HOSTNAME", source)
        self.assertNotIn("hiplet-120706", source)
        monitor_unit = Path(__file__).with_name('review-activator-monitor.service').read_text()
        self.assertIn('Environment=RA_EXPECTED_HOSTNAME=v3248121.hosted-by-vdsina.ru', monitor_unit)

    def test_disk_guard_pass(self):
        ops.disk_guard(20*1024**3, 1024**3)

    def test_disk_guard_refuses_before_dump(self):
        with self.assertRaisesRegex(ops.SafeFailure, 'BACKUP_DISK_GUARD'):
            ops.disk_guard(ops.MIN_FREE, 1)

    def test_disk_guard_reserves_dump_space(self):
        with self.assertRaises(ops.SafeFailure):
            ops.disk_guard(6*1024**3, 2*1024**3)

    def test_same_snapshot(self):
        s = snapshot()
        self.assertTrue(ops.compare(s, copy.deepcopy(s))['schema_equal'])

    def test_schema_difference_denied(self):
        a, b = snapshot(), snapshot()
        b['schema_sha256'] = 'different'
        with self.assertRaisesRegex(ops.SafeFailure, 'RESTORE_SNAPSHOT_MISMATCH'):
            ops.compare(a, b)

    def test_data_difference_denied(self):
        a, b = snapshot(), snapshot()
        b['rows']['auth.users']['sha256'] = 'changed'
        with self.assertRaises(ops.SafeFailure):
            ops.compare(a, b)

    def test_rogue_auth_user_denied(self):
        s = snapshot()
        s['catalog']['synthetic_users_only'] = False
        s['catalog']['auth_users_valid'] = False
        with self.assertRaisesRegex(ops.SafeFailure, 'AUTH_SCOPE_FAILED'):
            ops.validate_snapshot(s)

    def test_approved_operator_allowed(self):
        s = snapshot()
        s['catalog'].update({
            'synthetic_users_only': False,
            'auth_users_valid': True,
            'operator_enabled': True,
            'operator_scope_valid': True,
        })
        s['rows']['auth.users']['count'] = 4
        s['rows']['public.review_admins']['count'] = 3
        ops.validate_snapshot(s)

    def test_operator_scope_mismatch_denied(self):
        s = snapshot()
        s['catalog'].update({
            'synthetic_users_only': False,
            'auth_users_valid': True,
            'operator_enabled': True,
            'operator_scope_valid': False,
        })
        s['rows']['auth.users']['count'] = 4
        s['rows']['public.review_admins']['count'] = 3
        with self.assertRaisesRegex(ops.SafeFailure, 'AUTH_SCOPE_FAILED'):
            ops.validate_snapshot(s)

    def test_scoped_cancelled_reply_action_allowed(self):
        s = snapshot()
        s['rows']['public.review_reply_actions'] = {'count': 1, 'sha256': 'synthetic-reply'}
        s['catalog']['reply_actions_scope'] = {
            'count': 1, 'scope_valid': True, 'status_valid': True, 'active_count': 0}
        ops.validate_snapshot(s)

    def test_scoped_active_reply_action_allowed_for_backup(self):
        s = snapshot()
        s['rows']['public.review_reply_actions'] = {'count': 1, 'sha256': 'synthetic-reply'}
        s['catalog']['reply_actions_scope'] = {
            'count': 1, 'scope_valid': True, 'status_valid': True, 'active_count': 1}
        ops.validate_snapshot(s)

    def test_reply_action_scope_or_status_mismatch_denied(self):
        for field in ('scope_valid', 'status_valid'):
            s = snapshot()
            s['rows']['public.review_reply_actions'] = {'count': 1, 'sha256': 'synthetic-reply'}
            scope = {'count': 1, 'scope_valid': True, 'status_valid': True, 'active_count': 0}
            scope[field] = False
            s['catalog']['reply_actions_scope'] = scope
            with self.subTest(field=field), self.assertRaisesRegex(ops.SafeFailure, 'REPLY_ACTION_SCOPE_FAILED'):
                ops.validate_snapshot(s)

    def test_reply_action_count_mismatch_denied(self):
        s = snapshot()
        s['rows']['public.review_reply_actions'] = {'count': 1, 'sha256': 'synthetic-reply'}
        s['catalog']['reply_actions_scope'] = {
            'count': 2, 'scope_valid': True, 'status_valid': True, 'active_count': 0}
        with self.assertRaisesRegex(ops.SafeFailure, 'REPLY_ACTION_SCOPE_FAILED'):
            ops.validate_snapshot(s)

    def test_legacy_nonempty_reply_action_without_scope_evidence_denied(self):
        s = snapshot()
        s['rows']['public.review_reply_actions'] = {'count': 1, 'sha256': 'synthetic-reply'}
        normalized = ops.normalize_snapshot_contract(s)
        with self.assertRaisesRegex(ops.SafeFailure, 'REPLY_ACTION_SCOPE_FAILED'):
            ops.validate_snapshot(normalized)

    def test_old_snapshot_contract_still_compares(self):
        old = snapshot()
        current = copy.deepcopy(old)
        current['catalog'].update({
            'auth_users_valid': True,
            'operator_enabled': False,
            'operator_scope_valid': True,
        })
        self.assertTrue(ops.compare(old, current)['schema_equal'])

    def test_wrong_count_denied(self):
        s = snapshot()
        s['rows']['public.review_external_reviews']['count'] = 67
        with self.assertRaises(ops.SafeFailure):
            ops.validate_snapshot(s)

    def test_rls_disabled_denied(self):
        s = snapshot()
        s['tables'][0]['rls'] = False
        with self.assertRaises(ops.SafeFailure):
            ops.validate_snapshot(s)

    def test_force_rls_disabled_denied(self):
        s = snapshot()
        s['tables'][1]['force'] = False
        with self.assertRaises(ops.SafeFailure):
            ops.validate_snapshot(s)

    def test_auth_owner_changed_denied(self):
        s = snapshot()
        s['tables'][2]['owner'] = 'postgres'
        with self.assertRaises(ops.SafeFailure):
            ops.validate_snapshot(s)

    def test_restriction_token_only_normalized(self):
        a = b'\\restrict abc\nCREATE TABLE x(a int);\n\\unrestrict abc\n'
        b = a.replace(b'abc', b'def')
        self.assertEqual(ops.normalize_schema(a), ops.normalize_schema(b))
        self.assertNotEqual(ops.normalize_schema(a), ops.normalize_schema(b.replace(b'int', b'text')))

    def test_arbitrary_db_rejected(self):
        with patch.object(ops, 'pg') as external:
            with self.assertRaises(ops.SafeFailure):
                ops.sql('production', 'select 1')
            external.assert_not_called()

    def test_http_external_destination_not_supported(self):
        with patch.object(ops.http.client, 'HTTPConnection') as external:
            with self.assertRaises(ops.SafeFailure):
                ops.http_status('https://example.invalid/')
            external.assert_not_called()

    def test_sql_readonly_wrapper(self):
        with patch.object(ops, 'pg', return_value=b'0') as external:
            ops.sql(ops.DB, 'select 0;')
            self.assertEqual(external.call_args.kwargs['data'], b'begin read only;\nselect 0;\nrollback;')

    def test_child_exception_redacted(self):
        with patch.object(ops.subprocess, 'run', side_effect=OSError('synthetic-sensitive-marker')):
            with self.assertRaises(ops.SafeFailure) as e:
                ops.run(['false'])
        self.assertNotIn('synthetic-sensitive-marker', str(e.exception))

    def test_existing_restore_target_refused(self):
        with patch.object(ops, 'checked_manifest', return_value=({}, Path('/not-opened'))), \
             patch.object(ops, 'sql', return_value='1'), patch.object(ops, 'pg') as external:
            with self.assertRaisesRegex(ops.SafeFailure, 'RESTORE_TARGET_EXISTS'):
                ops.restore('/not-opened')
            external.assert_not_called()

    def test_restore_failure_cleanup_and_original_preserved(self):
        s = snapshot()
        fake = {'source_snapshot': s, 'database_size': 1, 'dump': {'sha256': 'synthetic'}}
        with patch.object(ops, 'checked_manifest', return_value=(fake, Path('/not-opened'))), \
             patch.object(ops, 'snapshot', return_value=s), patch.object(ops, 'sql', return_value='0'), \
             patch.object(ops.shutil, 'disk_usage', return_value=type('D', (), {'free': 20*1024**3})()), \
             patch.object(ops, 'pg') as external, patch('builtins.open', return_value=io.BytesIO(b'synthetic')), \
             patch.object(ops.subprocess, 'run', return_value=type('P', (), {'returncode': 1})()), \
             patch.object(ops, 'app_health', return_value={'healthz': 200, 'readyz': 200}), \
             patch.object(ops, 'write_json') as evidence:
            with self.assertRaises(ops.SafeFailure):
                ops.restore('/not-opened')
            self.assertEqual(external.call_args.args, ('dropdb', ['--no-password', ops.RESTORE]))
            report = evidence.call_args.args[1]
            self.assertEqual(report['cleanup'], 'PASS')
            self.assertTrue(report['source_unchanged'])
            self.assertEqual(report['status'], 'FAIL')


if __name__ == '__main__':
    unittest.main(verbosity=2)
