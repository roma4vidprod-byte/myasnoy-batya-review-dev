"""Actual PG17 + systemd synthetic acceptance. Fixed host, own disposable fixture only.

Run explicitly as root. Never reads credentials, auth logs, sessions or provider data.
Safe reports only; raw child stdout/stderr never printed on failure.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path('/opt/review-activator-lab/worker/vps06')
REPORT = Path('/var/lib/review-activator-ops/vps06/native.json')
PG = '/usr/lib/postgresql/17/bin/psql'
COMPANY = '60000000-0000-4000-8000-000000000006'
LOCATION = '61000000-0000-4000-8000-000000000006'
CONNECTION = '62000000-0000-4000-8000-000000000006'
RUN = '63000000-0000-4000-8000-000000000006'
UNIT = 'review-activator-worker.service'
TIMER = 'review-activator-worker.timer'
results = []
observations = {}


def command(args, timeout=45):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def sql(text, worker=False, expected=0):
    role = 'review-activator' if worker else 'postgres'
    p = command(['runuser', '-u', role, '--', PG, '-XqAtw', '-v', 'ON_ERROR_STOP=1', '-d', 'review_activator_lab', '-c', text])
    if (p.returncode == 0) != (expected == 0):
        raise AssertionError('SQL_RESULT_MISMATCH')
    return p.stdout.strip() if p.returncode == 0 else 'DENIED'


def system(*args, expected=0):
    p = command(['systemctl', *args])
    if (p.returncode == 0) != (expected == 0):
        raise AssertionError('SYSTEMD_RESULT_MISMATCH')
    return p.stdout.strip()


def prop(key):
    return system('show', UNIT, '-p', key, '--value')


def latest():
    return json.loads(Path('/var/lib/review-activator-worker/latest.json').read_text())


def counts():
    return json.loads(sql("select json_build_object('queued',count(*) filter(where status='QUEUED'),"
                         "'running',count(*) filter(where status='RUNNING'),'succeeded',count(*) filter(where status='SUCCEEDED'),"
                         "'failed',count(*) filter(where status='FAILED')) from public.review_sync_runs;"))


def clean():
    # Exact synthetic company identity, never broad deletes or truncate.
    sql(f"do $$ begin if exists(select 1 from public.review_companies where id='{COMPANY}' and slug<>'vps06-synthetic') "
        "then raise exception 'CLEANUP_SCOPE_DENIED'; end if; end $$;"
        f"delete from public.review_companies where id='{COMPANY}' and slug='vps06-synthetic';")


def fixture(jobs=0, operation='success', delay=0, stale=False, due=False):
    clean()
    assert operation in ('success', 'fail') and isinstance(delay, int) and 0 <= delay <= 8000
    config = json.dumps({'mode': 'synthetic-vps06', 'location_id': LOCATION, 'external_org_id': 'vps06-synthetic-org'})
    meta = json.dumps({'vps06': {'operation': operation, 'delay_ms': delay}})
    sql(f"begin; insert into public.review_companies(id,slug,name) values('{COMPANY}','vps06-synthetic','VPS06 SYNTHETIC');"
        f"insert into public.review_locations(id,company_id,name,city,address) values('{LOCATION}','{COMPANY}','SYNTHETIC','LAB','LAB');"
        f"insert into public.review_provider_connections(id,company_id,provider,status,external_account_id,config,next_sync_at,sync_interval_minutes) "
        f"values('{CONNECTION}','{COMPANY}','yandex','READY','vps06-synthetic','{config}',now()+interval '{'-1 minute' if due else '1 hour'}',60);"
        f"insert into public.review_sync_runs(id,provider_connection_id,provider,status,meta,requested_at) "
        f"select case when n=1 then '{RUN}'::uuid else gen_random_uuid() end,'{CONNECTION}','yandex','QUEUED','{meta}'::jsonb,"
        f"now()-interval '{'2 days' if stale else '1 second'}' from generate_series(1,{jobs}) n; commit;")


def wait_active_lock():
    for _ in range(80):
        count = int(sql("select count(*) from pg_locks where locktype='advisory' and granted and classid=1380013908 and objid=6;"))
        if count:
            observations.setdefault('locks', []).append(json.loads(sql("select json_agg(json_build_object('pid',pid,'granted',granted,"
                "'classid',classid,'objid',objid,'mode',mode)) from pg_locks where locktype='advisory' and classid=1380013908 and objid=6;")))
            return
        time.sleep(.05)
    raise AssertionError('LOCK_NOT_OBSERVED')


def wait_done():
    for _ in range(100):
        if prop('ActiveState') not in ('activating', 'active', 'deactivating'):
            return
        time.sleep(.15)
    raise AssertionError('WORKER_DID_NOT_EXIT')


def check(name, fn):
    try:
        detail = fn()
        results.append({'name': name, 'status': 'PASS', 'detail': detail})
    except Exception:
        results.append({'name': name, 'status': 'FAIL', 'code': 'NATIVE_ASSERTION_FAILED'})
        save('FAIL')
        raise
    save('RUNNING')


def save(status):
    REPORT.write_text(json.dumps({'status': status, 'utc': datetime.now(timezone.utc).isoformat(),
        'server_version_num': 170011, 'tests': results, 'observations': observations, 'provider_calls': 0}, indent=2))


def empty():
    clean(); system('start', UNIT)
    assert latest()['code'] == 'EMPTY' and counts() == dict(queued=0, running=0, succeeded=0, failed=0)
    return latest()


def due():
    fixture(due=True); system('start', UNIT)
    assert latest()['code'] == 'COMPLETED' and latest()['enqueued'] == 1
    assert counts() == dict(queued=0, running=0, succeeded=1, failed=0)
    assert sql(f"select public.review_enqueue_due_syncs('{COMPANY}');", worker=True) == '0'
    return latest()


def multiple():
    fixture(jobs=3)
    for left in (2, 1, 0):
        system('start', UNIT)
        assert counts()['queued'] == left and counts()['succeeded'] == 3-left
    system('start', UNIT)
    assert latest()['code'] == 'EMPTY' and counts()['succeeded'] == 3
    return counts()


def processing(stale=False):
    fixture(jobs=1, operation='success' if stale else 'fail', stale=stale)
    system('start', UNIT, expected=1)
    assert latest()['code'] == 'PROCESS_FAILED' and counts()['failed'] == 1 and counts()['succeeded'] == 0
    assert prop('Result') == 'exit-code'
    return latest()


def duplicate_completion():
    fixture(jobs=1); system('start', UNIT)
    summary = '{"pages_fetched":0,"fetched_count":0,"inserted":0,"updated":0,"unchanged":0,"seen":0}'
    assert sql(f"select public.review_complete_sync_run('{COMPANY}','{RUN}','{summary}');", worker=True, expected=1) == 'DENIED'
    assert sql(f"select public.review_fail_sync_run('{COMPANY}','{RUN}','SYNC_OPERATION_FAILED');", worker=True, expected=1) == 'DENIED'
    assert counts()['succeeded'] == 1
    return {'duplicate_complete': 'DENIED', 'stale_fail': 'DENIED'}


def scope_null_acl():
    fixture(jobs=1)
    for statement in ["select public.review_claim_next_sync_run(null);",
        f"select public.review_enqueue_due_syncs('10000000-0000-4000-8000-000000000001');",
        f"select public.review_fail_sync_run('{COMPANY}','{RUN}',null);",
        f"select public.review_fail_sync_run('10000000-0000-4000-8000-000000000001','{RUN}','SYNC_OPERATION_FAILED');",
        'select * from public.review_external_reviews;', 'select * from review_private.yandex_sessions;',
        'select * from auth.users;', 'update cron.job set active=true;']:
        assert sql(statement, worker=True, expected=1) == 'DENIED'
    for role in ('anon', 'authenticated', 'service_role'):
        assert sql(f"set role {role}; select public.review_claim_next_sync_run('{COMPANY}');", expected=1) == 'DENIED'
    assert counts()['queued'] == 1
    return {'denials': 11, 'reviews_and_auth_and_sessions_and_cron': 'DENIED'}


def claim_concurrency():
    fixture(jobs=1)
    a = subprocess.Popen(['runuser','-u','review-activator','--',PG,'-XqAtw','-v','ON_ERROR_STOP=1','-d','review_activator_lab'],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        a.stdin.write(f"begin; select public.review_claim_next_sync_run('{COMPANY}');\n"); a.stdin.flush()
        first = json.loads(a.stdout.readline()); assert first['claimed'] is True
        second = json.loads(sql(f"select public.review_claim_next_sync_run('{COMPANY}');", worker=True))
        assert second == {'claimed': False}
        a.stdin.write('rollback;\n\\q\n'); a.stdin.flush(); a.wait(5)
        assert counts()['queued'] == 1
        return {'first_claim': True, 'second_claim': False, 'rolled_back': True}
    finally:
        if a.poll() is None: a.kill(); a.wait()


def parallel():
    fixture(jobs=1, delay=7000)
    system('start','--no-block',UNIT); wait_active_lock()
    p = command(['systemd-run','--quiet','--wait','--pipe','--collect','--unit=review-activator-vps06-parallel',
        '-p','User=review-activator','-p','PrivateNetwork=yes','-p','RestrictAddressFamilies=AF_UNIX',
        '-p','TimeoutStartSec=15','--setenv=RA_RUNTIME_PROFILE=vps-lab','--setenv=RA_WORKER_PROVIDER=synthetic-vps06',
        '/opt/node/bin/node',str(ROOT/'tools/vps06/once.mjs'),'--once'])
    assert p.returncode == 0
    b = json.loads(p.stdout.strip()); assert b['code'] == 'ALREADY_RUNNING'
    wait_done(); assert counts()['succeeded'] == 1 and counts()['running'] == 0
    system('start',UNIT); assert latest()['code'] == 'EMPTY'
    return {'worker_b': b, 'completed': 1, 'duplicates': 0, 'released': True}


def systemd_duplicate():
    fixture(jobs=1, delay=3000)
    system('start','--no-block',UNIT); wait_active_lock()
    invocation = prop('InvocationID')
    # Compare while activating: systemd may unload a finished oneshot and clear InvocationID.
    system('start','--no-block',UNIT)
    assert invocation and invocation == prop('InvocationID') and prop('ActiveState') == 'activating'
    wait_done()
    assert counts()['succeeded'] == 1
    return {'same_invocation': True, 'completions': 1}


def crash(signal):
    fixture(jobs=1, delay=7000)
    system('start','--no-block',UNIT); wait_active_lock()
    system('kill',f'--signal={signal}', '--kill-whom=main', UNIT)
    wait_done()
    assert counts() == dict(queued=1, running=0, succeeded=0, failed=0)
    assert sql('begin; select pg_try_advisory_xact_lock(1380013908,6); rollback;', worker=True) == 't'
    return {'signal': signal, 'claim_rolled_back': True, 'lock_released': True, 'systemd_result': prop('Result')}


def timeout():
    override = Path('/run/systemd/system/review-activator-worker.service.d/vps06-test.conf')
    assert not override.exists()
    override.parent.mkdir(parents=True, exist_ok=True)
    try:
        override.write_text('[Service]\nTimeoutStartSec=2\n')
        system('daemon-reload'); fixture(jobs=1, delay=7000)
        system('start',UNIT,expected=1)
        assert prop('Result') == 'timeout' and counts()['queued'] == 1 and counts()['succeeded'] == 0
        assert sql('begin; select pg_try_advisory_xact_lock(1380013908,6); rollback;', worker=True) == 't'
        return {'systemd_result': 'timeout', 'claim_rolled_back': True, 'lock_released': True}
    finally:
        override.unlink(); system('daemon-reload')


def sql_failure(which):
    signature = 'review_claim_next_sync_run(uuid)' if which == 'claim' else 'review_complete_sync_run(uuid,uuid,jsonb)'
    fixture(jobs=1)
    try:
        sql(f'revoke execute on function public.{signature} from "review-activator";')
        system('start',UNIT,expected=1)
        assert latest()['code'] == 'DB_OPERATION_FAILED' and latest()['stage'] == which.upper()
        assert counts() == dict(queued=1, running=0, succeeded=0, failed=0)
        return {'stage': latest()['stage'], 'rollback': True, 'completion': 0}
    finally:
        sql(f'grant execute on function public.{signature} to "review-activator";')


def db_unavailable():
    # Hide ONLY the test unit's socket namespace; never stop the actual DB/LAB.
    fixture(jobs=1)
    p = command(['systemd-run','--quiet','--wait','--pipe','--collect','--unit=review-activator-vps06-dbdown',
        '-p','User=review-activator','-p','PrivateNetwork=yes','-p','InaccessiblePaths=/var/run/postgresql',
        '--setenv=RA_RUNTIME_PROFILE=vps-lab','--setenv=RA_WORKER_PROVIDER=synthetic-vps06',
        '/opt/node/bin/node',str(ROOT/'tools/vps06/once.mjs'),'--once'])
    assert p.returncode != 0
    assert latest()['code'] == 'DB_OPERATION_FAILED' and latest()['stage'] == 'DB_READINESS'
    assert counts()['queued'] == 1
    return {'isolated_socket_unavailable': True, 'live_db_stopped': False, 'stage': 'DB_READINESS'}


def timer():
    fixture(jobs=1,delay=7000)
    override = Path('/run/systemd/system/review-activator-worker.timer.d/vps06-test.conf')
    assert not override.exists()
    override.parent.mkdir(parents=True,exist_ok=True)
    try:
        override.write_text('[Timer]\nOnCalendar=\nOnCalendar=*-*-* *:*:0/2\nAccuracySec=100ms\n')
        system('daemon-reload'); system('start',TIMER)
        wait_active_lock(); first = prop('InvocationID')
        # At least two real timer deadlines pass while Type=oneshot is activating.
        time.sleep(4.1)
        assert prop('ActiveState') == 'activating' and prop('InvocationID') == first
        observations['timer_overlap'] = {'same_invocation': True, 'active_state': prop('ActiveState'),
            'timer_active': system('show',TIMER,'-p','ActiveState','--value'), 'cadence': '*-*-* *:*:0/2', 'hold_ms':7000}
        system('stop',TIMER); wait_done()
        assert counts()['succeeded'] == 1
        return {**observations['timer_overlap'], 'completions': 1}
    finally:
        system('disable','--now',TIMER); override.unlink(); system('daemon-reload')


def main():
    assert os.geteuid() == 0 and socket.gethostname() == 'hiplet-120706'
    assert sql('show server_version_num;') == '170011'
    assert sql('select count(*) from public.review_provider_connections;') == '0'
    assert sql('select count(*) from public.review_sync_runs;') == '0'
    try:
        check('empty_queue',empty)
        check('due_enqueue_one_and_dedupe',due)
        check('multiple_jobs_one_per_invocation',multiple)
        check('process_failure',processing)
        check('stale_job',lambda: processing(True))
        check('duplicate_complete_stale_fail',duplicate_completion)
        check('scope_null_acl',scope_null_acl)
        check('native_claim_two_backends',claim_concurrency)
        check('parallel_advisory_lock',parallel)
        check('systemd_duplicate_invocation',systemd_duplicate)
        check('SIGTERM',lambda: crash('SIGTERM'))
        check('SIGKILL',lambda: crash('SIGKILL'))
        check('worker_timeout',timeout)
        check('claim_rpc_failure',lambda: sql_failure('claim'))
        check('complete_rpc_failure',lambda: sql_failure('complete'))
        check('DB_unavailable',db_unavailable)
        check('actual_timer_and_overlap',timer)
    finally:
        system('disable','--now',TIMER)
        system('stop',UNIT)
        clean()
    check('final_empty_queue',empty)
    observations['cleanup'] = counts()
    observations['timer_final'] = {'active': system('show',TIMER,'-p','ActiveState','--value'),
                                  'enabled': system('show',TIMER,'-p','UnitFileState','--value')}
    observations['hashes'] = {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
                            for name in ['lib/server/single-sync-run.js','tools/vps06/worker.mjs','tools/vps06/once.mjs','tools/vps06/pg.mjs']}
    save('PASS')
    print(json.dumps({'status':'PASS','tests':len(results),'provider_calls':0,'cleanup':observations['cleanup']}))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception:
        save('FAIL')
        print(json.dumps({'status':'FAIL','tests':len(results),'last_test':results[-1]['name'] if results else None}))
        sys.exit(1)
