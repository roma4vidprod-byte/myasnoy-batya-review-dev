"""Explicit VPS06 installation, fixed LAB host; no providers/Cloud/secret access."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

SOURCE = Path(__file__).resolve().parents[2]
DEST = Path('/opt/review-activator-lab/worker/vps06')
REPORTS = Path('/var/lib/review-activator-ops/vps06')
FILES = ['lib/server/single-sync-run.js', 'tools/vps06/worker.mjs', 'tools/vps06/once.mjs', 'tools/vps06/pg.mjs']


def run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    if result.returncode:
        raise RuntimeError('INSTALL_COMMAND_FAILED')
    return result.stdout.decode().strip()


def main():
    if os.geteuid() != 0 or socket.gethostname() != 'hiplet-120706' or DEST.exists():
        raise RuntimeError('INSTALL_TARGET_GUARD')
    REPORTS.mkdir(mode=0o700, exist_ok=True)
    spec = importlib.util.spec_from_file_location('ops', '/opt/review-activator-lab/ops/vps05/ops.py')
    ops = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ops)
    ops.guard()
    before = ops.snapshot(ops.DB)
    ops.validate_snapshot(before)
    (REPORTS / 'before.json').write_text(json.dumps(before))
    original = ops.sql(ops.DB, "select pg_get_functiondef('public.review_enqueue_due_syncs(uuid)'::regprocedure);")
    (REPORTS / 'enqueue-before.sql').write_text(original)
    rpc_hashes = {name: hashlib.sha256(ops.sql(ops.DB, f"select pg_get_functiondef('public.{name}'::regprocedure);").encode()).hexdigest()
                  for name in ('review_claim_next_sync_run(uuid)', 'review_complete_sync_run(uuid,uuid,jsonb)', 'review_fail_sync_run(uuid,uuid,text)')}
    run(['runuser', '-u', 'postgres', '--', '/usr/lib/postgresql/17/bin/psql', '-Xq', '-v', 'ON_ERROR_STOP=1',
         '-d', 'review_activator_lab', '-f', str(SOURCE / 'tools/vps06/lab-worker.sql')])
    DEST.mkdir(parents=True, mode=0o755)
    # umask 0077 protects reports, but public source directories must be traversable
    # by the unprivileged service account (no credentials are installed here).
    DEST.parent.chmod(0o755)
    DEST.chmod(0o755)
    for name in FILES:
        target = DEST / name
        target.parent.mkdir(parents=True, exist_ok=True)
        current = target.parent
        while current != DEST:
            current.chmod(0o755)
            current = current.parent
        shutil.copyfile(SOURCE / name, target)
        target.chmod(0o644)
    # .js module type without npm installation or external runtime dependencies.
    (DEST / 'package.json').write_text('{"type":"module","private":true}\n')
    (DEST / 'package.json').chmod(0o644)
    for name in ('review-activator-worker.service', 'review-activator-worker.timer'):
        shutil.copyfile(SOURCE / 'tools/vps06' / name, Path('/etc/systemd/system') / name)
    shutil.copyfile(SOURCE / 'tools/vps06/worker.env', '/etc/review-activator-lab/worker.env')
    Path('/etc/review-activator-lab/worker.env').chmod(0o600)
    run(['systemd-analyze', 'verify', '/etc/systemd/system/review-activator-worker.service',
         '/etc/systemd/system/review-activator-worker.timer'])
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'disable', '--now', 'review-activator-worker.timer'])
    report = {'status': 'INSTALLED_TIMER_DISABLED', 'files': {name: hashlib.sha256((DEST / name).read_bytes()).hexdigest() for name in FILES},
              'rpc_hashes_before': rpc_hashes, 'before_preserved': True, 'provider_calls': 0}
    (REPORTS / 'install.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception:
        print('{"status":"FAIL","code":"VPS06_INSTALL_FAILED"}')
        sys.exit(1)
