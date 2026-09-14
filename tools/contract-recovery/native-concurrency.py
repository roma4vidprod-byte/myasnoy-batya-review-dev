#!/usr/bin/env python3
"""Recovery 09 native PG17 gate: disposable cluster only, Windows OR POSIX.

No host, DSN, password, existing database, or PGDATA is accepted. The only DB
binaries used are the explicitly selected local PG17 bin directory. Windows:
127.0.0.1/random port + generated SCRAM credential + restricted temporary ACL.
POSIX: private Unix socket, no TCP, demoted UID when started as root.
No application env, secrets, service configuration, or remote SQL is used.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import pathlib
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION_REL = 'supabase/migrations/20260914210000_yandex_contract_recovery_admin_09.sql'
FIXTURE_REL = 'test/support/contract-recovery-fixture.mjs'
EXPECTED_SQL_SHA256 = '2bd1f0db934c8f8763b3e8aed621eaf2d382f7d3e28056415f420f1e39b993d7'
CASES = (
    'two concurrent identical requests -> one effective recovery, one audit',
    'concurrent newer connection error cannot be cleared',
    'concurrent session replacement cannot be accepted as revision 13',
    'recovery holds shared session lock through transaction end',
    'concurrent queued run through existing FK blocks recovery',
    'approval expiration is rechecked after lock wait',
)


class GateError(Exception):
    """Fixed safe message only; never a subprocess command or raw error body."""


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def normalized_bytes(path: pathlib.Path) -> bytes:
    return path.read_bytes().replace(b'\r\n', b'\n')


def clean_env(source: dict, home: pathlib.Path, pg: pathlib.Path, windows: bool) -> dict:
    """Do NOT copy PG*, NODE_OPTIONS, credentials, or arbitrary app environment."""
    result = {'PATH': str(pg) + os.pathsep + source.get('PATH', os.defpath),
              'HOME': str(home), 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'TZ': 'UTC'}
    if windows:
        for name in ('SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'):
            if source.get(name):
                result[name] = source[name]
        result['TEMP'] = result['TMP'] = str(home)
        result['USERPROFILE'] = str(home)
        result['APPDATA'] = str(home)
    return result


def verify_local_path(path: pathlib.Path) -> None:
    s = str(path)
    if s.startswith(('\\\\', '//')) or '://' in s:
        raise GateError('LOCAL_FILESYSTEM_PATH_REQUIRED')
    if any(ord(c) < 32 for c in s):
        raise GateError('INVALID_PATH')


def binary_paths(pg: pathlib.Path, windows: bool) -> dict:
    suffix = '.exe' if windows else ''
    return {name: pg / (name + suffix) for name in ('initdb', 'pg_ctl', 'psql', 'postgres')}


def parse_pg17_version(text: str) -> str:
    m = re.fullmatch(r'[^\r\n]+ \(PostgreSQL\) (17\.[0-9]+)(?: [^\r\n]*)?\s*', text)
    if not m:
        raise GateError('POSTGRES_17_REQUIRED_FOR_THIS_GATE')
    return m.group(1)


def reserve_loopback_port() -> int:
    # Reservation is released immediately before start. Bind collisions fail; no retries.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        sock.bind(('127.0.0.1', 0))
        return int(sock.getsockname()[1])


def pgconf_string(value: str) -> str:
    return "'" + value.replace('\\', '/').replace("'", "''") + "'"


def lock_windows_directory(base: pathlib.Path, env: dict) -> None:
    system_root = env.get('SystemRoot') or env.get('WINDIR')
    if not system_root:
        raise GateError('WINDOWS_SYSTEMROOT_REQUIRED')
    system32 = pathlib.Path(system_root) / 'System32'
    r = subprocess.run([str(system32/'whoami.exe'), '/user', '/fo', 'csv', '/nh'],
                       capture_output=True, text=True, env=env, timeout=15)
    if r.returncode:
        raise GateError('WINDOWS_IDENTITY_UNAVAILABLE')
    rows = list(csv.reader(io.StringIO(r.stdout.strip())))
    sid = rows[-1][-1].strip() if rows else ''
    if not re.fullmatch(r'S-1-\d+(?:-\d+)+', sid):
        raise GateError('WINDOWS_SID_UNAVAILABLE')
    r = subprocess.run([str(system32/'icacls.exe'), str(base), '/inheritance:r',
                        '/grant:r', f'*{sid}:(OI)(CI)F'],
                       capture_output=True, text=True, env=env, timeout=15)
    if r.returncode:
        raise GateError('WINDOWS_TEMP_ACL_FAILED')


def write_report(path: pathlib.Path, result: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp-' + uuid.uuid4().hex)
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pg-bin', required=True, help='Local extracted PostgreSQL 17 bin directory')
    ap.add_argument('--report', required=True, help='New local JSON output path')
    ns = ap.parse_args(argv)
    windows = os.name == 'nt'
    report = pathlib.Path(ns.report).resolve()
    pg = pathlib.Path(ns.pg_bin).resolve()
    result = {
        'status': 'NOT_RUN', 'tests': [], 'remote_connections': 0,
        'platform': sys.platform, 'started_at_utc': datetime.now(timezone.utc).isoformat(),
        'isolation': 'new private temporary cluster; no existing DB/DSN; no services',
        'transport': 'IPv4 loopback + generated SCRAM password' if windows else 'private Unix socket, no TCP',
        'migration_normalized_sha256': None, 'fixture_normalized_sha256': None,
        'native_gate_executed': False, 'cleanup': 'NOT_NEEDED',
    }
    base = None
    started = False
    child_kwargs = {}
    sessions = []
    marker = uuid.uuid4().hex
    try:
        verify_local_path(pathlib.Path(ns.pg_bin))
        verify_local_path(pathlib.Path(ns.report))
        verify_local_path(pg)
        verify_local_path(report)
        if report.exists():
            raise GateError('REPORT_ALREADY_EXISTS_USE_NEW_PATH')
        bins = binary_paths(pg, windows)
        if not all(p.is_file() for p in bins.values()):
            result['blocker'] = 'NATIVE_POSTGRES_BINARIES_MISSING'
            write_report(report, result)
            return 2
        if os.name not in ('nt', 'posix'):
            raise GateError('UNSUPPORTED_LOCAL_PLATFORM')
        migration = ROOT / MIGRATION_REL
        fixture = ROOT / FIXTURE_REL
        if not migration.is_file() or not fixture.is_file():
            raise GateError('RECOVERY09_SOURCE_FILES_MISSING')
        sqlbytes = normalized_bytes(migration)
        result['migration_normalized_sha256'] = sha256_bytes(sqlbytes)
        result['fixture_normalized_sha256'] = sha256_bytes(normalized_bytes(fixture))
        result['runner_sha256'] = sha256_bytes(pathlib.Path(__file__).read_bytes())
        if result['migration_normalized_sha256'] != EXPECTED_SQL_SHA256:
            raise GateError('RECOVERY09_SQL_HASH_MISMATCH')
        # Verification only; do not load a Git env or execute hooks.
        result['source_commit'] = 'NOT_VERIFIED'
        result['tracked_worktree_clean'] = 'NOT_VERIFIED'
        try:
            git = shutil.which('git')
            if git:
                r = subprocess.run([git, '-C', str(ROOT), 'rev-parse', 'HEAD'],
                    env=clean_env(os.environ, ROOT, pg, windows), capture_output=True,
                    text=True, timeout=10)
                if r.returncode == 0 and re.fullmatch(r'[0-9a-f]{40}\s*', r.stdout):
                    result['source_commit'] = r.stdout.strip()
                st = subprocess.run([git, '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=no'],
                    env=clean_env(os.environ, ROOT, pg, windows), capture_output=True,
                    text=True, timeout=10)
                if st.returncode == 0:
                    result['tracked_worktree_clean'] = not bool(st.stdout.strip())
        except (OSError, subprocess.SubprocessError):
            pass
        base = pathlib.Path(tempfile.mkdtemp(prefix='review-recovery-native-'))
        env = clean_env(os.environ, base, pg, windows)
        if windows:
            lock_windows_directory(base, env)
        else:
            os.chmod(base, 0o700)
            if os.getuid() == 0:
                import pwd
                user = pwd.getpwnam('nobody')
                os.chown(base, user.pw_uid, user.pw_gid)
                def demote():
                    os.setgroups([])
                    os.setgid(user.pw_gid)
                    os.setuid(user.pw_uid)
                child_kwargs['preexec_fn'] = demote
        (base / 'runner-owned.marker').write_text(marker, encoding='ascii')
        for name, binary in bins.items():
            result['current_stage'] = 'BINARY_VERSION_' + name.upper()
            r = subprocess.run([str(binary), '--version'], env=env, cwd=base,
                capture_output=True, text=True, timeout=15, **child_kwargs)
            if r.returncode:
                result['binary_exit_code'] = r.returncode
                raise GateError('POSTGRES_BINARY_CANNOT_START')
            result.setdefault('binary_versions', {})[name] = parse_pg17_version(r.stdout.strip())
        if len(set(result['binary_versions'].values())) != 1:
            raise GateError('MIXED_POSTGRES_BINARY_VERSIONS')
        node = shutil.which('node', path=env['PATH'])
        if not node:
            raise GateError('NODE_NOT_FOUND')
        export = (
            "import {fixtureSql,args,ids} from './test/support/contract-recovery-fixture.mjs';"
            "console.log(JSON.stringify({fixtureSql,args:args(),ids}));"
        )
        # Only the checked-in synthetic fixture is imported. No project bootstrap or .env.
        result['current_stage'] = 'SYNTHETIC_FIXTURE_EXPORT'
        r = subprocess.run([node, '--input-type=module', '-e', export], cwd=ROOT,
            env=env, capture_output=True, text=True, encoding='utf-8', timeout=20)
        if r.returncode:
            raise GateError('SYNTHETIC_FIXTURE_EXPORT_FAILED')
        f = json.loads(r.stdout)
        if not isinstance(f.get('fixtureSql'), str) or not isinstance(f.get('args'), list) or len(f['args']) != 9:
            raise GateError('SYNTHETIC_FIXTURE_EXPORT_INVALID')
        ids, fixture_sql = f['ids'], f['fixtureSql']
        if ids.get('company') != '11111111-1111-4111-8111-111111111111':
            raise GateError('SYNTHETIC_ONLY_FIXTURE_REQUIRED')
        dbdir, socketdir = base/'db', base/'socket'
        socketdir.mkdir()
        if not windows:
            os.chmod(socketdir, 0o700)
            if os.getuid() == 0:
                os.chown(socketdir, user.pw_uid, user.pw_gid)
        port = reserve_loopback_port() if windows else 55439
        password = secrets.token_urlsafe(48)
        pwfile = base/'initdb.password'
        pwfile.write_text(password+'\n', encoding='ascii')
        if not windows:
            os.chmod(pwfile, 0o600)
            if os.getuid() == 0:
                os.chown(pwfile, user.pw_uid, user.pw_gid)
        env.update({'PGHOST': '127.0.0.1' if windows else str(socketdir),
                    'PGPORT': str(port), 'PGUSER': 'postgres', 'PGDATABASE': 'postgres',
                    'PGCONNECT_TIMEOUT': '5', 'PGCLIENTENCODING': 'UTF8', 'PGTZ': 'UTC',
                    'PGSSLMODE': 'disable', 'PGGSSENCMODE': 'disable',
                    'PGOPTIONS': '-c statement_timeout=25000 -c lock_timeout=20000 -c timezone=UTC'})
        if windows:
            pgpass = base/'pgpass.conf'
            pgpass.write_text(f'127.0.0.1:{port}:postgres:postgres:{password}\n', encoding='ascii')
            env['PGPASSFILE'] = str(pgpass)
        def command(name, arguments, *, input_text=None, timeout=35, app='recovery-native-admin'):
            # On Windows pg_ctl passes its inherited stdout/stderr handles to the
            # detached postgres child. Capturing those handles makes
            # subprocess.run().communicate() wait forever for EOF. pg_ctl start
            # writes its diagnostic to server.log already; do not expose a pipe
            # to the child process.
            output = {'stdout': subprocess.PIPE, 'stderr': subprocess.PIPE}
            if windows and name == 'pg_ctl' and 'start' in arguments:
                output = {'stdout': subprocess.DEVNULL, 'stderr': subprocess.DEVNULL}
            return subprocess.run([str(bins[name]), *arguments], input=input_text,
                text=True, encoding='utf-8', errors='replace', timeout=timeout,
                env={**env,'PGAPPNAME':app}, cwd=base, **output, **child_kwargs)
        def query(sql, *, app='recovery-native-admin'):
            r = command('psql',['-X','-w','-Atq','-v','ON_ERROR_STOP=1'],input_text=sql,app=app)
            if r.returncode:
                # No raw stderr in the report, even though the DB has synthetic contents only.
                raise GateError('SYNTHETIC_SQL_EXECUTION_FAILED')
            return r.stdout.strip()
        init_args = ['-D',str(dbdir),'--username=postgres','--encoding=UTF8','--no-locale',
                     '--pwfile='+str(pwfile), '--auth-local=trust',
                     '--auth-host=scram-sha-256' if windows else '--auth-host=reject']
        result['current_stage'] = 'INITDB'
        r = command('initdb',init_args,timeout=90)
        pwfile.unlink(missing_ok=True)
        if r.returncode:
            raise GateError('ISOLATED_INITDB_FAILED')
        with (dbdir/'postgresql.conf').open('a',encoding='utf-8',newline='\n') as conf:
            conf.write('\n# Disposable Recovery 09 native gate ONLY\n')
            conf.write('listen_addresses = '+pgconf_string('127.0.0.1' if windows else '')+'\n')
            conf.write('unix_socket_directories = '+pgconf_string('' if windows else str(socketdir))+'\n')
            conf.write(f"port = {port}\nmax_connections = 12\nshared_buffers = '16MB'\n")
            conf.write("timezone = 'UTC'\nlog_timezone = 'UTC'\npassword_encryption = 'scram-sha-256'\n")
            conf.write("fsync = off\nssl = off\nlog_statement = 'none'\nlogging_collector = off\n")
        if windows:
            (dbdir/'pg_hba.conf').write_text(
                'host postgres postgres 127.0.0.1/32 scram-sha-256\n'
                'host all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n',encoding='ascii')
        result['current_stage'] = 'START_OWN_CLUSTER'
        r=command('pg_ctl',['-D',str(dbdir),'-l',str(base/'server.log'),'-w','-t','60','start'],timeout=70)
        if r.returncode:
            raise GateError('ISOLATED_SERVER_START_FAILED')
        started=True
        result['current_stage'] = 'VERIFY_CLUSTER_IDENTITY'
        info=json.loads(query("select json_build_object('server_version_num',current_setting('server_version_num')::int,"
            "'data_directory',current_setting('data_directory'),'listen_addresses',current_setting('listen_addresses'),"
            "'port',current_setting('port')::int,'server_address',inet_server_addr(),"
            "'timezone',current_setting('TimeZone'),'postmaster_start',pg_postmaster_start_time());"))
        if info['server_version_num']//10000 != 17:
            raise GateError('POSTGRES_17_REQUIRED_FOR_THIS_GATE')
        if pathlib.Path(info['data_directory']).resolve() != dbdir.resolve():
            raise GateError('REFUSED_NON_OWNED_DATABASE')
        if info['listen_addresses'] != ('127.0.0.1' if windows else '') or info['port'] != port:
            raise GateError('CLUSTER_ISOLATION_MISMATCH')
        if info['server_address'] != ('127.0.0.1' if windows else None):
            raise GateError('CLUSTER_ADDRESS_MISMATCH')
        result['server_version_num']=info['server_version_num']
        result['isolation_verified']=True
        result['timezone']=info['timezone']
        result['local_port']=port
        result['native_gate_executed']=True
        result['current_stage'] = 'APPLY_SYNTHETIC_SCHEMA'
        query(fixture_sql); query(sqlbytes.decode('utf-8'))
        def reset():
            query('drop schema review_private cascade; drop schema cron cascade; '
                  'drop table public.review_sync_runs,public.review_external_reviews,public.review_provider_connections cascade;')
            query(fixture_sql.replace('create role anon; create role authenticated; create role service_role;',''))
            query(sqlbytes.decode('utf-8'))
        def literal(value):
            return 'null' if value is None else "'"+str(value).replace("'","''")+"'"
        def recovery_sql(a=None):
            return 'select review_private.recover_yandex_contract_connection('+','.join(map(literal,a or f['args']))+');'
        def stats():
            return json.loads(query("select json_build_object('audits',(select count(*) from review_private.yandex_contract_recoveries),"
                "'status',(select status from public.review_provider_connections where id="+literal(ids['connection'])+"),"
                "'revision',(select revision from review_private.yandex_sessions));"))
        def expect_stats(expected):
            if stats()!=expected:
                raise GateError('NATIVE_STATE_ASSERTION_FAILED')
        lock_observations=[]
        class Session:
            def __init__(self, app):
                self.app=app;self.lines=queue.Queue();self.output=[]
                self.p=subprocess.Popen([str(bins['psql']),'-X','-w','-Atq','-v','ON_ERROR_STOP=1'],
                    stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                    text=True,encoding='utf-8',errors='replace',bufsize=1,
                    env={**env,'PGAPPNAME':app},cwd=base,**child_kwargs)
                def reader():
                    for line in self.p.stdout:
                        self.output.append(line.strip());self.lines.put(line.strip())
                    self.lines.put('__EOF__')
                self.reader=threading.Thread(target=reader,daemon=True)
                self.reader.start();sessions.append(self)
            def send(self, sql):
                self.p.stdin.write(sql+'\n');self.p.stdin.flush()
            def until(self, needle, timeout=15):
                deadline=time.monotonic()+timeout
                while time.monotonic()<deadline:
                    try: line=self.lines.get(timeout=max(.01,deadline-time.monotonic()))
                    except queue.Empty: break
                    if needle in line: return
                    if line=='__EOF__': break
                raise GateError('EXPECTED_SYNTHETIC_RESULT_NOT_OBSERVED')
            def close(self):
                if self.p.poll() is None:
                    try:
                        self.send('rollback;\n\\q');self.p.wait(timeout=5)
                    except (BrokenPipeError,OSError,subprocess.TimeoutExpired):
                        self.p.kill();self.p.wait(timeout=5)
                self.reader.join(timeout=2)
                for stream in (self.p.stdin,self.p.stdout):
                    if stream: stream.close()
        def wait_lock(app):
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                v=json.loads(query("select coalesce(json_agg(json_build_object('pid',pid,'wait_event_type',wait_event_type,"
                    "'blockers',pg_blocking_pids(pid))),'[]'::json) from pg_stat_activity where application_name="+literal(app)))
                if any(row['wait_event_type']=='Lock' and len(row['blockers'])>0 for row in v):
                    lock_observations.append(v);return
                time.sleep(.05)
            raise GateError('REAL_LOCK_WAIT_NOT_OBSERVED')
        def record(name,fn):
            result['current_stage']='RESET_SYNTHETIC_SCHEMA'
            reset();before=len(lock_observations);start=time.monotonic()
            result['current_stage']='NATIVE_CASE_' + str(CASES.index(name)+1)
            try:
                fn()
                result['tests'].append({'name':name,'status':'PASS','lock_wait_verified':len(lock_observations)>before,
                    'lock_observations':lock_observations[before:],'duration_ms':round((time.monotonic()-start)*1000)})
            except Exception:
                result['tests'].append({'name':name,'status':'FAIL','lock_observations':lock_observations[before:]})
                raise
            finally:
                for sess in sessions:sess.close()
                sessions.clear()
        def duplicate():
            a,b=Session('recovery-a'),Session('recovery-b')
            sql=recovery_sql();a.send('begin;'+sql+'\n\\echo A_READY');a.until('A_READY')
            b.send(sql);wait_lock(b.app);a.send('commit;');b.until('ALREADY_APPLIED')
            expect_stats({'audits':1,'status':'READY','revision':13})
        def newer_connection():
            a,b=Session('recovery-a'),Session('recovery-b')
            a.send("begin; update public.review_provider_connections set last_error='NEW_ERROR',updated_at=clock_timestamp() where id="+literal(ids['connection'])+";\n\\echo A_READY")
            a.until('A_READY');b.send(recovery_sql());wait_lock(b.app);a.send('commit;');b.until('RECOVERY_CONNECTION_CHANGED')
            expect_stats({'audits':0,'status':'ERROR','revision':13})
        def newer_session():
            a,b=Session('recovery-a'),Session('recovery-b')
            a.send("begin; update review_private.yandex_sessions set revision=14,state='NOT_CONFIGURED';\n\\echo A_READY")
            a.until('A_READY');b.send(recovery_sql());wait_lock(b.app);a.send('commit;');b.until('RECOVERY_SESSION_CHANGED')
            expect_stats({'audits':0,'status':'ERROR','revision':14})
        def session_wait():
            a,b=Session('recovery-a'),Session('recovery-b')
            a.send('begin;'+recovery_sql()+'\n\\echo A_READY');a.until('A_READY')
            b.send("update review_private.yandex_sessions set revision=14,state='NOT_CONFIGURED';\n\\echo B_DONE")
            wait_lock(b.app);a.send('commit;');b.until('B_DONE')
            expect_stats({'audits':1,'status':'READY','revision':14})
        def active_run():
            a,b=Session('recovery-a'),Session('recovery-b')
            a.send("begin; insert into public.review_sync_runs values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',"+literal(ids['connection'])+",'QUEUED',null,'{}');\n\\echo A_READY")
            a.until('A_READY');b.send(recovery_sql());wait_lock(b.app);a.send('commit;');b.until('RECOVERY_ACTIVE_RUN')
            expect_stats({'audits':0,'status':'ERROR','revision':13})
        def expired_wait():
            a,b=Session('recovery-a'),Session('recovery-b')
            a.send('begin; select id from public.review_provider_connections where id='+literal(ids['connection'])+' for update;\n\\echo A_READY')
            a.until('A_READY')
            params=list(f['args']);params[-1]=query("select (clock_timestamp()+interval '6 seconds')::text")
            b.send(recovery_sql(params));wait_lock(b.app)
            deadline=time.monotonic()+10
            while query('select clock_timestamp() >= '+literal(params[-1])+'::timestamptz')!='t':
                if time.monotonic()>=deadline:raise GateError('APPROVAL_EXPIRY_WAIT_FAILED')
                time.sleep(.05)
            a.send('rollback;');b.until('RECOVERY_APPROVAL_INVALID')
            expect_stats({'audits':0,'status':'ERROR','revision':13})
        for name,fn in zip(CASES,(duplicate,newer_connection,newer_session,session_wait,active_run,expired_wait)):
            record(name,fn)
        result['current_stage']='ALL_SIX_NATIVE_CASES_PASSED'
        result['status']='PASS_NATIVE_POSTGRES_17_CONCURRENCY'
    except (Exception, KeyboardInterrupt) as exc:
        if isinstance(exc,GateError) and not result['native_gate_executed']:
            result['status']='NOT_RUN';result['blocker']=str(exc)
        else:
            result['status']='FAIL_NATIVE_GATE'
            result['failure_code']=str(exc) if isinstance(exc,GateError) else 'LOCAL_EXECUTION_FAILED'
        result['failure_type']=type(exc).__name__
    finally:
        for sess in sessions:
            try:sess.close()
            except Exception:pass
        if base is not None:
            # Never kill by image name, touch a service, or delete a supplied DB path.
            owned=(base/'runner-owned.marker').is_file() and (base/'runner-owned.marker').read_text(encoding='ascii')==marker
            alive=(base/'db'/'postmaster.pid').is_file()
            stopped=not alive
            if owned and alive:
                try:
                    r=command('pg_ctl',['-D',str(base/'db'),'-m','immediate','-w','-t','30','stop'],timeout=35)
                    stopped=r.returncode==0 and not (base/'db'/'postmaster.pid').exists()
                except Exception:stopped=False
            if owned and stopped:
                try:shutil.rmtree(base);result['cleanup']='OWNED_CLUSTER_REMOVED'
                except OSError:result['cleanup']='OWNED_TEMP_FILES_REMAIN'
            elif not owned and not alive:
                # An ACL failure can occur before the marker is created. Only this mkdtemp is in scope.
                try:shutil.rmtree(base);result['cleanup']='UNSTARTED_OWNED_TEMP_REMOVED'
                except OSError:result['cleanup']='OWNED_TEMP_FILES_REMAIN'
            else:
                result['cleanup']='STOP_NOT_CONFIRMED_DIRECTORY_PRESERVED'
                result['status']='FAIL_CLEANUP'
            if result['cleanup']!='OWNED_CLUSTER_REMOVED' and result['status'].startswith('PASS_'):
                result['status']='PARTIAL_TESTS_PASS_CLEANUP_PENDING'
        result['finished_at_utc']=datetime.now(timezone.utc).isoformat()
        # Never replace an existing report, including an accidental source-file selection.
        if not report.exists():write_report(report,result)
    return 0 if result['status']=='PASS_NATIVE_POSTGRES_17_CONCURRENCY' else (2 if result['status']=='NOT_RUN' else 1)


if __name__=='__main__':
    raise SystemExit(main())
