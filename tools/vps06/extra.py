"""Remaining native guard/monitor/preservation evidence, not a general harness."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys

spec = importlib.util.spec_from_file_location('native', Path(__file__).with_name('native.py'))
n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n)
spec = importlib.util.spec_from_file_location('ops', '/opt/review-activator-lab/ops/vps05/ops.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
out = Path('/var/lib/review-activator-ops/vps06')


def transient(name, profile, provider):
    args = ['systemd-run','--quiet','--wait','--pipe','--collect',f'--unit=review-activator-vps06-{name}',
            '-p','User=review-activator','-p','PrivateNetwork=yes','-p','RestrictAddressFamilies=AF_UNIX',
            f'--setenv=RA_RUNTIME_PROFILE={profile}']
    if provider is not None:
        args.append(f'--setenv=RA_WORKER_PROVIDER={provider}')
    p = n.command([*args,'/opt/node/bin/node',str(n.ROOT/'tools/vps06/once.mjs'),'--once'])
    assert p.returncode != 0
    return json.loads(p.stdout.strip())


def main():
    assert os.geteuid() == 0 and socket.gethostname() == 'hiplet-120706'
    before = json.loads((out/'before.json').read_text())
    report = {'tests': []}
    for name, profile, provider, code in [
        ('cloud','cloud-dev','synthetic-vps06','PROFILE_DENIED'),
        ('wrong','unknown','synthetic-vps06','PROFILE_DENIED'),
        ('missing','vps-lab',None,'SYNTHETIC_MODE_REQUIRED'),
        ('ambiguous','vps-lab','yandex','SYNTHETIC_MODE_REQUIRED')]:
        value = transient(name, profile, provider)
        assert value['code'] == code and value['stage'] == 'GUARD'
        assert n.counts() == dict(queued=0,running=0,succeeded=0,failed=0)
        report['tests'].append({'name':name,'status':'PASS','code':code,'provider_calls':0})
    # Actual hardened existing monitor must observe guard failure, without running the worker.
    n.system('start','review-activator-monitor.service',expected=1)
    monitor_failure = json.loads(Path('/var/lib/review-activator-ops/VPS05_MONITOR.json').read_text())
    assert 'WORKER_FAILED' in monitor_failure['codes']
    report['monitor_failure_observed'] = monitor_failure
    n.fixture(jobs=1)
    try:
        p = n.command(['runuser','-u','review-activator','--','env','-i','RA_RUNTIME_PROFILE=vps-lab',
             'RA_WORKER_PROVIDER=synthetic-vps06','/opt/node/bin/node',str(Path(__file__).with_name('inject-exception.mjs'))])
        assert p.returncode != 0
        value = json.loads(p.stdout.strip())
        assert value['code'] == 'PROCESS_FAILED' and n.counts()['failed'] == 1
        assert 'SYNTHETIC_UNEXPECTED_DO_NOT_LOG' not in p.stdout+p.stderr
        report['tests'].append({'name':'unexpected_exception','status':'PASS','fail_once':True,'raw_exception_hidden':True})
    finally:
        n.clean()
    n.system('start',n.UNIT)
    # Prior expected monitor failure is recorded above; explicitly acknowledge it before healthy check.
    n.system('reset-failed','review-activator-monitor.service')
    n.system('start','review-activator-monitor.service')
    report['monitor'] = json.loads(Path('/var/lib/review-activator-ops/VPS05_MONITOR.json').read_text())
    assert report['monitor']['status'] == 'PASS'
    assert report['monitor']['sample']['worker']['last_success']
    after = ops.snapshot(ops.DB)
    ops.validate_snapshot(after)
    assert before['tables'] == after['tables']
    report['lab_tables_preserved'] = True
    install = json.loads((out/'install.json').read_text())
    rpc = {name:hashlib.sha256(ops.sql(ops.DB,f"select pg_get_functiondef('public.{name}'::regprocedure);").encode()).hexdigest()
           for name in install['rpc_hashes_before']}
    assert rpc == install['rpc_hashes_before']
    report['unchanged_claim_complete_fail_hashes'] = rpc
    report['health'] = ops.app_health()
    assert report['health'] == {'healthz':200,'readyz':200}
    report['listeners'] = ops.run(['ss','-H','-lnt']).decode().splitlines()
    assert ops.listener_evaluation(report['listeners'])
    report['timers'] = {name: n.system('show',name,'-p','ActiveState','-p','UnitFileState') for name in
                       ['review-activator-worker.timer','review-activator-backup.timer','review-activator-monitor.timer']}
    report['operational_windows_dependencies'] = []
    for path in n.ROOT.rglob('*'):
        if path.is_file():
            text = path.read_text().lower()
            if any(word in text for word in ('c:\\','powershell','putty','desktop commander','/mnt/c/')):
                report['operational_windows_dependencies'].append(str(path))
    assert not report['operational_windows_dependencies']
    report['db_role'] = json.loads(n.sql("select row_to_json(x) from (select rolname,rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolbypassrls from pg_roles where rolname='review-activator') x;"))
    report['service'] = n.system('show',n.UNIT,'-p','User','-p','Type','-p','ActiveState','-p','Result',
                               '-p','PrivateNetwork','-p','RestrictAddressFamilies','-p','TimeoutStartUSec','-p','Restart')
    report['postgrest_dependency'] = 'NOT_USED_DIRECT_UNIX_POSTGRESQL'
    report['boot_id'] = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    report['backup_unit_hashes'] = {name: hashlib.sha256((Path('/etc/systemd/system')/name).read_bytes()).hexdigest()
                                   for name in ('review-activator-backup.service','review-activator-backup.timer','review-activator-monitor.service','review-activator-monitor.timer')}
    report['deployed_ops_hash'] = hashlib.sha256(Path('/opt/review-activator-lab/ops/vps05/ops.py').read_bytes()).hexdigest()
    report['status'] = 'PASS'
    (out/'extra.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'status':'PASS','tests':len(report['tests']),'lab_preserved':True,'monitor':'PASS','health':report['health']}))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception:
        print('{"status":"FAIL","code":"EXTRA_ACCEPTANCE_FAILED"}')
        sys.exit(1)
