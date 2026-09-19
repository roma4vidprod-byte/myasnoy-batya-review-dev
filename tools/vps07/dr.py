"""Fixed synthetic VPS07 adapter reusing VPS05 backup/restore primitives.

Only encrypted bytes leave the host. No provider or scheduler operations.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import sys
from crypto_backup import decrypt, encrypt, pack, unpack, verify_cipher, Refused

spec = importlib.util.spec_from_file_location('ops', Path(__file__).resolve().parent.parent / 'vps05/ops.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
ROOT = Path('/var/backups/review-activator-dr')
KEY = Path('/etc/review-activator-dr/backup.key')
STAGE = 'GUARD'
TARGET = 'review_activator_dr_vps07'


def private_file(path, expected_size=None):
    st = path.lstat()
    ops.need(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and stat.S_IMODE(st.st_mode) == 0o600, 'PRIVATE_FILE_PERMISSIONS')
    ops.need(expected_size is None or st.st_size == expected_size, 'PRIVATE_FILE_SIZE')
    ops.need(st.st_size <= 64*1024**2+256, 'FILE_LIMIT')
    return path.read_bytes()


def guard():
    ops.guard()
    ops.root_dir(ROOT)
    ops.root_dir(KEY.parent)
    ops.need(ops.run(['systemctl', 'show', 'review-activator-worker.timer', '-p', 'UnitFileState', '--value']).strip() == b'disabled', 'BUSINESS_TIMER_MUST_BE_DISABLED')


def build():
    global STAGE
    guard()
    key = private_file(KEY, 32)
    ops.need(not (ops.STATE / 'VPS07_EXPORT.json').exists(), 'EXPORT_ALREADY_EXISTS')
    STAGE = 'LOCAL_BACKUP'
    m = ops.backup()
    dest = ROOT / Path(m['dump']['path']).parent.name
    ops.root_dir(dest)
    files, metadata = {}, []
    for p in sorted(Path(m['dump']['path']).parent.iterdir()):
        ops.need(p.is_file() and not p.is_symlink(), 'BACKUP_MEMBER_INVALID')
        files['backup/' + p.name] = p.read_bytes()
    STAGE = 'CONFIG_BUNDLE'
    configs = [Path('/etc/review-activator-lab') / n for n in
               ('auth.env', 'api.env', 'node.env', 'worker.env', 'bootstrap.json', 'synthetic-users.json')]
    for p in configs:
        files['host' + str(p)] = private_file(p)
        metadata.append(ops.metadata(p))
    for p in sorted(Path('/etc/postgresql/17/main').rglob('*')):
        if p.is_file():
            ops.need(not p.is_symlink(), 'PG_CONFIG_SYMLINK')
            files['host' + str(p)] = p.read_bytes()
            metadata.append(ops.metadata(p))
    units = ops.SERVICES + ['review-activator-backup.service', 'review-activator-backup.timer',
                           'review-activator-monitor.service', 'review-activator-monitor.timer',
                           'review-activator-worker.service', 'review-activator-worker.timer']
    for unit in units:
        for prop in ('FragmentPath', 'DropInPaths'):
            for name in ops.run(['systemctl', 'show', unit, '-p', prop, '--value']).decode().split():
                p = Path(name)
                ops.need(p.is_absolute() and not p.is_symlink() and str(p).startswith(('/etc/systemd/', '/usr/lib/systemd/')), 'UNIT_PATH_INVALID')
                files['host' + str(p)] = p.read_bytes()
                metadata.append(ops.metadata(p))
    # Password verifiers are encrypted only. Never output/execute this role dump.
    files['cluster/roles.sql'] = ops.pg('pg_dumpall', ['--roles-only', '--no-password'])
    for base in (Path('/opt/review-activator-lab/worker/vps06'), Path('/opt/review-activator-lab/ops/vps05'),
                 Path('/opt/review-activator-lab/ops/vps07')):
        for p in sorted(base.rglob('*')):
            if p.is_file() and '__pycache__' not in p.parts:
                ops.need(not p.is_symlink(), 'RUNTIME_SYMLINK')
                files['host' + str(p)] = p.read_bytes()
    files['host-inventory.json'] = json.dumps({'files': metadata, 'operational': m['inventory']}, sort_keys=True).encode()
    STAGE = 'ENCRYPT'
    sealed = encrypt(pack(files), key)
    with open(dest / 'backup.aead', 'xb', opener=lambda p, f: os.open(p, f, 0o600)) as f:
        f.write(sealed)
    ops.need(ops.snapshot(ops.DB) == m['source_snapshot'], 'LAB_CHANGED_DURING_ENCRYPT')
    report = {'status': 'ENCRYPTED_AWAITING_OFFHOST', 'utc': ops.utc(), 'archive': ops.metadata(dest/'backup.aead'),
              'dump_sha256': m['dump']['sha256'], 'source_snapshot': m['source_snapshot'],
              'database_size': m['database_size'], 'sensitive_config_metadata_only': metadata,
              'member_count': len(files), 'algorithm': 'AES-256-GCM', 'key_source': 'NEW_DEDICATED_BACKUP_KEY',
              'source_lab_unchanged': True, 'retention_deletion': False}
    ops.write_json(dest / 'export.json', report)
    ops.write_json(ops.STATE / 'VPS07_EXPORT.json', report)
    return {'status': report['status'], 'directory': str(dest), 'size': len(sealed), 'sha256': report['archive']['sha256']}


def restore_retrieved():
    global STAGE
    guard()
    ops.RESTORE = TARGET
    ops.need(not (ops.STATE / 'VPS07_RESTORE.json').exists(), 'RESTORE_REPORT_ALREADY_EXISTS')
    export = json.loads((ops.STATE / 'VPS07_EXPORT.json').read_text())
    incoming = ROOT / 'retrieved-vps07'
    ops.root_dir(incoming)
    STAGE = 'VERIFY_RETRIEVED'
    receipt = json.loads(private_file(incoming / 'receipt.json'))
    ops.need(receipt.get('destination_type') == 'TEMPORARY_WINDOWS' and receipt.get('independent_readback') is True, 'OFFHOST_RECEIPT_INVALID')
    sealed = private_file(incoming / 'backup.aead')
    verify_cipher(sealed, export['archive']['sha256'], export['archive']['size'])
    ops.need(receipt.get('sha256') == export['archive']['sha256'] and receipt.get('size') == export['archive']['size'], 'OFFHOST_RECEIPT_MISMATCH')
    STAGE = 'DECRYPT_RETRIEVED'
    # Recovery key returned from Windows, not the locally retained original key.
    files = unpack(decrypt(sealed, private_file(incoming / 'recovery.key', 32)))
    manifest = json.loads(files['backup/manifest.json'])
    dump = files['backup/review_activator_lab.dump']
    ops.need(ops.sha(dump) == export['dump_sha256'] == manifest['dump']['sha256'], 'DUMP_HASH_MISMATCH')
    ops.need(ops.sql('postgres', f"select count(*) from pg_database where datname='{TARGET}';") == '0', 'RESTORE_TARGET_EXISTS')
    before = ops.snapshot(ops.DB)
    ops.compare(export['source_snapshot'], before)
    ops.disk_guard(shutil.disk_usage(ROOT).free, export['database_size'])
    result = {'status': 'FAIL', 'utc': ops.utc(), 'target': TARGET, 'source': 'RETRIEVED_WINDOWS_COPY',
              'encrypted_sha256': ops.sha(sealed), 'dump_sha256': ops.sha(dump), 'decrypt': 'PASS',
              'archive_member_hashes': 'PASS', 'config_restore': 'HASH_VERIFIED_NOT_APPLIED',
              'global_role_restore': 'ENCRYPTED_BACKUP_NOT_APPLIED_TO_EXISTING_CLUSTER', 'cleanup': 'NOT_CREATED'}
    created = False
    try:
        STAGE = 'CREATE_ISOLATED_DB'
        ops.pg('createdb', ['--template=template0', '--owner=postgres', TARGET])
        created = True
        ops.sql(TARGET, f'REVOKE ALL ON DATABASE {TARGET} FROM PUBLIC;', readonly=False)
        STAGE = 'RESTORE'
        ops.pg('pg_restore', ['--exit-on-error', '--single-transaction', '--no-password', '-d', TARGET], data=dump, timeout=180, code='RESTORE_FAILED')
        STAGE = 'RESTORE_VERIFY'
        result['comparison'] = ops.compare(before, ops.snapshot(TARGET))
        result['security'] = ops.restored_security()
        result['rows'] = {k: v['count'] for k, v in before['rows'].items()}
        result['status'] = 'PASS'
    except ops.SafeFailure as e:
        result['code'], result['stage'] = e.code, STAGE
    finally:
        if created:
            ops.pg('dropdb', ['--no-password', TARGET], code='RESTORE_CLEANUP_FAILED')
            result['cleanup'] = 'PASS' if ops.sql('postgres', f"select count(*) from pg_database where datname='{TARGET}';") == '0' else 'FAIL'
        result['source_lab_unchanged'] = before == ops.snapshot(ops.DB)
        result['health'] = ops.app_health()
        if result['cleanup'] != 'PASS' or not result['source_lab_unchanged'] or any(v != 200 for v in result['health'].values()):
            result['status'] = 'FAIL'
        ops.write_json(ops.STATE / 'VPS07_RESTORE.json', result)
    ops.need(result['status'] == 'PASS', result.get('code', 'RESTORE_ACCEPTANCE_FAILED'))
    # No extracted plaintext files exist. Remove only the redundant returned key.
    (incoming / 'recovery.key').unlink()
    receipt.update({'status': 'PASS', 'verified_at': ops.utc(), 'restore': 'PASS', 'hash_verified': True,
                    'offhost_automation': 'NOT_CONFIGURED', 'freshness_limit_seconds': 36*3600})
    ops.write_json(ops.STATE / 'VPS07_OFFHOST.json', receipt)
    return {'status': 'PASS', 'decrypt': 'PASS', 'restore': 'PASS', 'cleanup': result['cleanup'], 'source_lab_unchanged': result['source_lab_unchanged']}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('operation', choices=('build', 'restore-retrieved'))
    args = p.parse_args()
    try:
        print(json.dumps(build() if args.operation == 'build' else restore_retrieved()))
        return 0
    except (ops.SafeFailure, Refused) as e:
        print(json.dumps({'status': 'FAIL', 'stage': STAGE, 'code': e.code if isinstance(e, ops.SafeFailure) else str(e)}))
        return 1
    except Exception:
        print(json.dumps({'status': 'FAIL', 'stage': STAGE, 'code': 'DR_INTERNAL_FAILURE'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
