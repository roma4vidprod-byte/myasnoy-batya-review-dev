"""VPS08A native PG17 session/RLS/CAS tests in a NEW private cluster only.

Linux, existing binaries, no target DSN, no existing LAB DB. Synthetic material.
Raw SQL/error output is never emitted. No app/key/import/runtime installation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/usr/lib/postgresql/17/bin')
C = '13f3cb80-487a-4a19-96a1-fb3103200230'
L = '9a95f63b-18e6-447b-a449-8530b67ddbae'
ORG = '54309413522'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--report', required=True)
    ap.add_argument('--deployed-runtime', choices=['/opt/review-activator-yandex'])
    args = ap.parse_args()
    report = Path(args.report).resolve()
    if report.exists():
        raise RuntimeError('REPORT_EXISTS')
    result = {'status': 'FAIL', 'tests': [], 'cleanup': 'NOT_RUN', 'existing_lab_connections': 0,
              'provider_requests': 0, 'source_hashes': {}}
    base = Path(tempfile.mkdtemp(prefix='vps08a-session-test-')).resolve()
    user = pwd.getpwnam('postgres') if os.getuid() == 0 else pwd.getpwuid(os.getuid())
    os.chmod(base, 0o700)
    if os.getuid() == 0:
        os.chown(base, user.pw_uid, user.pw_gid)
    def demote():
        if os.getuid() == 0:
            os.setgroups([])
            os.setgid(user.pw_gid)
            os.setuid(user.pw_uid)
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': str(base),
           'PGHOST': str(base), 'PGPORT': '55488', 'PGDATABASE': 'vps08a_disposable',
           'PGCONNECT_TIMEOUT': '3', 'PGOPTIONS': '-c statement_timeout=5000 -c lock_timeout=1000'}
    started = False
    def cmd(binary, argv, data=None):
        return subprocess.run([str(PG/binary), *argv], input=data, text=True, encoding='utf8',
                              capture_output=True, timeout=40, env=env, cwd=base, preexec_fn=demote)
    def sql(value, role='postgres', denied=False, db='vps08a_disposable'):
        r = cmd('psql', ['-XqAtw', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', db], value)
        if (r.returncode != 0) != denied:
            raise RuntimeError('SQL_EXPECTATION_FAILED')
        return r.stdout.strip() if not denied else 'DENIED'
    def call(action, revision='null', data='{}', company=C, location=L):
        return f"select vps_yandex_private.session_call('{company}','{location}','{ORG}','{action}',{revision},'{data}'::jsonb);"
    def case(name, fn):
        fn()
        result['tests'].append({'name': name, 'status': 'PASS'})
    try:
        if cmd('postgres', ['--version']).returncode:
            raise RuntimeError('PG17_BINARY_FAILED')
        if cmd('initdb', ['-D', str(base/'db'), '-U', 'postgres', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8']).returncode:
            raise RuntimeError('INITDB_FAILED')
        conf = base/'db/postgresql.conf'
        with conf.open('a') as f:
            f.write(f"\nlisten_addresses=''\nunix_socket_directories='{base}'\nport=55488\nshared_buffers='16MB'\nmax_connections=12\nlog_statement='none'\n")
        if cmd('pg_ctl', ['-D', str(base/'db'), '-l', str(base/'server.log'), '-w', 'start']).returncode:
            raise RuntimeError('CLUSTER_START_FAILED')
        started = True
        sql('create database vps08a_disposable;', db='postgres')
        version = int(sql('show server_version_num;'))
        if not 170000 <= version < 180000:
            raise RuntimeError('PG17_REQUIRED')
        result['server_version_num'] = version
        sql('''create role anon login; create role authenticated login; create role service_role login;
            create role "review-activator" login;
            create table public.review_companies(id uuid primary key);
            create table public.review_locations(id uuid primary key,company_id uuid references public.review_companies);
            alter table public.review_locations enable row level security;
            create table public.review_external_reviews(company_id uuid,location_id uuid,provider text,external_review_id text,external_location_id text);
            create schema vps_lab_private;
            create table vps_lab_private.version(version text);
            insert into vps_lab_private.version values('vps04-auth-api-v1');''')
        migration = ROOT/'supabase/migrations/20260912103803_yandex_session_transport_v1.sql'
        adapter = ROOT/'tools/vps08a/session-access.sql'
        for path in [migration, adapter, Path(__file__)]:
            result['source_hashes'][path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        sql(migration.read_text(encoding='utf8'))
        # Match the existing LAB hardening, not Cloud service_role defaults.
        sql('revoke connect on database vps08a_disposable from public; grant connect on database vps08a_disposable to anon,authenticated,service_role,"review-activator"; revoke all on schema review_private from service_role; revoke all on all tables in schema review_private from service_role; revoke all on all functions in schema public from public,anon,authenticated,service_role;')
        sql(f"insert into public.review_companies values('{C}'); insert into public.review_locations values('{L}','{C}');")
        sql(adapter.read_text(encoding='utf8'))
        encrypted = json.dumps({'credential_version': '11111111-1111-4111-8111-111111111111',
            'envelope': {'v': 1, 'kid': 'synthetic-native', 'iv': 'AAAAAAAAAAAAAAAA',
                         'tag': 'AAAAAAAAAAAAAAAAAAAAAA==', 'ciphertext': 'QUFBQQ=='}})
        worker, importer = 'review-yandex-reader', 'review-yandex-import'
        case('least privilege roles', lambda: assert_true(sql("select bool_and(not rolsuper and not rolbypassrls) from pg_roles where rolname in ('vps_yandex_owner','review-yandex-reader','review-yandex-import');") == 't'))
        for role in ['anon','authenticated','service_role','review-activator']:
            case(role+' private RPC denied', lambda role=role: sql(call('read'), role, denied=True))
        for role in [worker, importer]:
            case(role+' direct table denied', lambda role=role: sql('select * from review_private.yandex_sessions;', role, denied=True))
        case('worker replace denied', lambda: sql(call('replace', 0, encrypted), worker, denied=True))
        case('importer read denied', lambda: sql(call('read'), importer, denied=True))
        case('first replace revision1 NOT_CONFIGURED', lambda: assert_true(json.loads(sql(call('replace', 0, encrypted), importer))['state'] == 'NOT_CONFIGURED'))
        before = json.loads(sql(call('read'), worker))
        case('duplicate create CAS denied', lambda: sql(call('replace', 0, encrypted), importer, denied=True))
        case('stale revision denied', lambda: sql(call('replace', 2, encrypted), importer, denied=True))
        case('wrong company denied', lambda: sql(call('read', company='22222222-2222-4222-8222-222222222222'), worker, denied=True))
        case('wrong location denied', lambda: sql(call('read', location='22222222-2222-4222-8222-222222222222'), worker, denied=True))
        case('wrong org denied', lambda: sql(call('read').replace(ORG,'123'), worker, denied=True))
        ready = json.dumps({'state':'READY','auth_ok':True,'sync_ok':False,'error_code':None})
        case('importer transition denied', lambda: sql(call('transition', 1, ready), importer, denied=True))
        case('worker health CAS READY', lambda: assert_true(json.loads(sql(call('transition', 1, ready), worker))['revision'] == 2))
        case('duplicate health CAS denied', lambda: sql(call('transition', 1, ready), worker, denied=True))
        case('sync timestamp mutation denied', lambda: sql(call('transition', 2, ready.replace('"sync_ok": false','"sync_ok": true')), worker, denied=True))
        case('disable material deletion denied', lambda: sql(call('transition', 2, ready.replace('READY','DISABLED')), worker, denied=True))
        after = json.loads(sql(call('read'), worker))
        case('health preserves exact tuple and sync timestamp', lambda: assert_true(all(after[k] == before[k] for k in ['envelope','credential_version','last_successful_sync_at'])))
        case('status strips encrypted material', lambda: assert_true('envelope' not in json.loads(sql(call('status'), importer))))
        case('replacement CAS increments revision', lambda: assert_true(json.loads(sql(call('replace', 2, encrypted), importer))['revision'] == 3))
        error = json.dumps({'state':'ERROR','auth_ok':False,'sync_ok':False,'error_code':'YANDEX_NETWORK_ERROR'})
        case('ERROR transition preserves credential', lambda: assert_true(json.loads(sql(call('transition', 3, error), worker))['credential_version'] == before['credential_version']))
        case('null scope fails closed', lambda: sql(call('read').replace("'"+C+"'",'null'), worker, denied=True))
        case('snapshot and alert actions denied', lambda: [sql(call(a), worker, denied=True) for a in ['snapshot','claim_alert']])
        case('NULL action denied', lambda: sql(call('read').replace("'read'",'null'), worker, denied=True))
        case('NULL data denied', lambda: sql(call('read').replace("'{}'::jsonb",'null::jsonb'), worker, denied=True))
        for role in [worker,importer]:
            case(role+' underlying CAS RPC denied', lambda role=role: sql(call('read').replace('vps_yandex_private.session_call','public.review_yandex_session_store'), role, denied=True))
        if args.deployed_runtime:
            source = sys.stdin.buffer.read(12001)
            if not source or len(source)>12000:raise RuntimeError('SYNTHETIC_SOURCE_REQUIRED')
            smoke = subprocess.run(['/opt/node/bin/node',str(ROOT/'tools/vps08a/deployed-smoke.mjs'),args.deployed_runtime],
                input=source, capture_output=True, timeout=30, env=env, cwd=base)
            if smoke.returncode:raise RuntimeError('DEPLOYED_SYNTHETIC_FAILED')
            result['deployed_crypto_smoke']=json.loads(smoke.stdout)
            case('deployed crypto protected synthetic transport CAS',lambda:assert_true(result['deployed_crypto_smoke']['status']=='PASS'))
        result['status'] = 'PASS'
    except Exception as e:
        result['error'] = str(e) if str(e) in ['SQL_EXPECTATION_FAILED','PG17_BINARY_FAILED','INITDB_FAILED','CLUSTER_START_FAILED','PG17_REQUIRED','ASSERTION_FAILED'] else 'NATIVE_TEST_FAILED'
    finally:
        stopped = not started or cmd('pg_ctl', ['-D', str(base/'db'), '-m', 'immediate', '-w', 'stop']).returncode == 0
        if stopped and base.name.startswith('vps08a-session-test-') and base.parent == Path(tempfile.gettempdir()).resolve():
            shutil.rmtree(base)
            result['cleanup'] = 'PASS' if not base.exists() else 'FAIL'
        else:
            result['cleanup'] = 'FAIL'
        if result['cleanup'] != 'PASS': result['status'] = 'FAIL'
        result['pass'] = len(result['tests'])
        result['fail'] = 0 if result['status'] == 'PASS' else 1
        report.write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps({'status':result['status'],'pass':result['pass'],'fail':result['fail'],'cleanup':result['cleanup'],'error':result.get('error')}))
    return 0 if result['status']=='PASS' else 1


def assert_true(value):
    if not value: raise RuntimeError('ASSERTION_FAILED')


if __name__ == '__main__':
    raise SystemExit(main())
