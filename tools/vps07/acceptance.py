"""Post-transfer evidence; no business mutations or service restarts."""
import json
from pathlib import Path
import sys
import dr
from crypto_backup import AESGCM, decrypt, verify_cipher, Refused


def main():
    ops = dr.ops
    dr.guard()
    exported = json.loads((ops.STATE/'VPS07_EXPORT.json').read_text())
    restored = json.loads((ops.STATE/'VPS07_RESTORE.json').read_text())
    receipt = json.loads((ops.STATE/'VPS07_OFFHOST.json').read_text())
    data = dr.private_file(dr.ROOT/'retrieved-vps07/backup.aead')
    key = dr.private_file(dr.KEY, 32)
    rejected = {}
    tests = {
        'wrong_key': lambda: decrypt(data, AESGCM.generate_key(bit_length=256)),
        'corrupt_ciphertext': lambda: decrypt(data[:-1]+bytes([data[-1]^1]), key),
        'offhost_hash_mismatch': lambda: verify_cipher(data, '0'*64, len(data)),
    }
    for name, check in tests.items():
        try:
            check()
            rejected[name] = False
        except Refused:
            rejected[name] = True
    ops.need(all(rejected.values()), 'NATIVE_NEGATIVE_TEST_FAILED')
    current = ops.snapshot(ops.DB)
    comparison = ops.compare(exported['source_snapshot'], current)
    # Existing monitor only: no new scheduler and no worker invocation.
    ops.run(['systemctl', 'start', 'review-activator-monitor.service'])
    monitor = json.loads((ops.STATE/'VPS05_MONITOR.json').read_text())
    ops.need(monitor['status'] == 'PASS', 'MONITOR_FAILED')
    units = ops.SERVICES + ['ssh.service', 'review-activator-backup.timer', 'review-activator-monitor.timer',
                           'review-activator-worker.service', 'review-activator-worker.timer']
    services = {}
    for unit in units:
        services[unit] = dict(line.split('=', 1) for line in ops.run(['systemctl', 'show', unit,
            '-p', 'ActiveState', '-p', 'UnitFileState', '-p', 'Result']).decode().splitlines() if '=' in line)
    file_hashes = {}
    for directory in ('vps05', 'vps07'):
        for p in sorted((Path('/opt/review-activator-lab/ops')/directory).iterdir()):
            if p.suffix == '.py' or p.suffix in ('.service', '.timer'):
                file_hashes[directory+'/'+p.name] = ops.file_hash(p)
    result = {'status': 'PASS', 'utc': ops.utc(), 'server_version_num': int(ops.sql(ops.DB, 'show server_version_num;')),
              'boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
              'health': ops.app_health(), 'services': services, 'listeners': ops.run(['ss', '-H', '-lnt']).decode().splitlines(),
              'ufw': ops.run(['/usr/sbin/ufw', 'status']).decode().splitlines(),
              'offhost': receipt, 'restore': restored['status'], 'lab_comparison': comparison,
              'negative_tests': rejected, 'monitor': monitor, 'installed_source_hashes': file_hashes,
              'returned_key_removed': not (dr.ROOT/'retrieved-vps07/recovery.key').exists(),
              'test_database_absent': ops.sql('postgres', "select count(*) from pg_database where datname='review_activator_dr_vps07';") == '0',
              'row_counts': {k: v['count'] for k, v in current['rows'].items()},
              'reboot': 'NOT_RUN', 'offhost_automation': 'NOT_CONFIGURED', 'real_provider_scheduler': 'OFF'}
    ops.need(ops.listener_evaluation(result['listeners']), 'LISTENERS_CHANGED')
    ops.write_json(ops.STATE/'VPS07_ACCEPTANCE.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'status': 'FAIL', 'code': 'VPS07_ACCEPTANCE_FAILED'}))
        sys.exit(1)
