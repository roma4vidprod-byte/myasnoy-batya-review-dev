#!/usr/bin/env python3
"""Isolated native PostgreSQL 17 gate. No DSN, cloud connection or existing database accepted.
Requires initdb/pg_ctl/psql in --pg-bin and Node for synthetic fixture export.
Creates a disposable Unix-socket-only cluster, then destroys ONLY that cluster.
NOT a substitute for Windows integration tests. NOT a remote execution tool.
"""
from __future__ import annotations
import argparse, json, os, pathlib, queue, shutil, subprocess, tempfile, threading, time, uuid

if os.name == 'posix':
    import pwd

ROOT = pathlib.Path(__file__).resolve().parents[2]

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--pg-bin', required=True)
    ap.add_argument('--report', required=True)
    ns = ap.parse_args()
    report = pathlib.Path(ns.report).resolve()
    result = {'status': 'NOT_RUN', 'tests': [], 'remote_connections': 0,
              'isolation': 'disposable cluster, listen_addresses empty, unique Unix socket'}
    pg = pathlib.Path(ns.pg_bin).resolve()
    for binary in ('initdb', 'pg_ctl', 'psql'):
        if not (pg / binary).is_file():
            result['blocker'] = 'NATIVE_POSTGRES_BINARIES_MISSING'
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text(json.dumps(result, indent=2)); return 2
    if os.name != 'posix':
        result['blocker'] = 'RUN_IN_ISOLATED_LINUX_OR_WSL'
        report.write_text(json.dumps(result, indent=2)); return 2
    base = pathlib.Path(tempfile.mkdtemp(prefix='review-recovery-native-'))
    dbdir, socketdir = base / 'db', base / 'socket'
    socketdir.mkdir()
    child_uid = os.getuid(); child_gid = os.getgid()
    if child_uid == 0:
        user = pwd.getpwnam('nobody'); child_uid, child_gid = user.pw_uid, user.pw_gid
        os.chown(base, child_uid, child_gid); os.chown(socketdir, child_uid, child_gid)
    os.chmod(base, 0o700); os.chmod(socketdir, 0o700)
    def demote():
        if os.getuid() == 0:
            os.setgroups([]); os.setgid(child_gid); os.setuid(child_uid)
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(base),
           'LANG': 'C.UTF-8', 'PGHOST': str(socketdir), 'PGPORT': '55439',
           'PGUSER': 'postgres', 'PGDATABASE': 'postgres'}
    def command(binary, arguments, *, input_text=None, timeout=30, app='recovery-native'):
        return subprocess.run([str(pg/binary), *arguments], input=input_text, text=True,
            capture_output=True, timeout=timeout, env={**env, 'PGAPPNAME': app},
            preexec_fn=demote, cwd=str(base))
    def query(sql, *, app='recovery-native'):
        r=command('psql',['-X','-Atq','-v','ON_ERROR_STOP=1'],input_text=sql,app=app)
        if r.returncode: raise RuntimeError(r.stderr.strip())  # all data here is synthetic
        return r.stdout.strip()
    started=False; open_sessions=[]
    try:
        r=command('initdb',['-D',str(dbdir),'--username=postgres','--auth-local=trust',
            '--auth-host=reject','--encoding=UTF8','--no-locale'],timeout=60)
        if r.returncode: raise RuntimeError('ISOLATED_INITDB_FAILED')
        r=command('pg_ctl',['-D',str(dbdir),'-l',str(base/'server.log'),'-o',
            f"-F -h '' -k {socketdir} -p 55439",'-w','start'],timeout=60)
        if r.returncode: raise RuntimeError('ISOLATED_SERVER_START_FAILED')
        started=True
        version=int(query("select current_setting('server_version_num')"))
        result['server_version_num']=version
        if version//10000 != 17: raise RuntimeError('POSTGRES_17_REQUIRED_FOR_THIS_GATE')
        fixture=json.loads(subprocess.check_output(['node','--input-type=module','-e',
            "import {fixtureSql,args,ids} from './test/support/contract-recovery-fixture.mjs';console.log(JSON.stringify({fixtureSql,args:args(),ids}));"],
            cwd=str(ROOT),env={'PATH':env['PATH']},text=True,timeout=20))
        fixture_sql=fixture['fixtureSql']; ids=fixture['ids']
        migration=(ROOT/'supabase/migrations/20260914210000_yandex_contract_recovery_admin_09.sql').read_text()
        query(fixture_sql); query(migration)
        def reset():
            # Only the automatically-created, disposable local cluster can be addressed by this runner.
            query('drop schema review_private cascade; drop schema cron cascade; '
                  'drop table public.review_sync_runs,public.review_external_reviews,public.review_provider_connections cascade;')
            query(fixture_sql.replace('create role anon; create role authenticated; create role service_role;',''))
            query(migration)
        def literal(v):
            if v is None: return 'null'
            return "'"+str(v).replace("'","''")+"'"
        def recovery_sql(a=None):
            a=list(a or fixture['args'])
            # Each test uses an explicit fixed approval lifetime and stable request ID for replay.
            return 'select review_private.recover_yandex_contract_connection('+','.join(map(literal,a))+');'
        def stats():
            return json.loads(query("select json_build_object('audits',(select count(*) from review_private.yandex_contract_recoveries),"
                "'status',(select status from public.review_provider_connections where id='"+ids['connection']+"'),"
                "'revision',(select revision from review_private.yandex_sessions));"))
        class Session:
            def __init__(self, app):
                self.app=app; self.lines=queue.Queue(); self.output=[]
                self.p=subprocess.Popen([str(pg/'psql'),'-X','-Atq','-v','ON_ERROR_STOP=1'],
                    stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,
                    bufsize=1,env={**env,'PGAPPNAME':app},cwd=str(base),preexec_fn=demote)
                def reader():
                    for line in self.p.stdout:
                        self.output.append(line.strip()); self.lines.put(line.strip())
                    self.lines.put('__EOF__')
                threading.Thread(target=reader,daemon=True).start();open_sessions.append(self)
            def send(self, sql):
                self.p.stdin.write(sql+'\n');self.p.stdin.flush()
            def until(self, needle, timeout=12):
                deadline=time.monotonic()+timeout; received=[]
                while time.monotonic()<deadline:
                    try: line=self.lines.get(timeout=max(.01,deadline-time.monotonic()))
                    except queue.Empty: break
                    received.append(line)
                    if needle in line: return received
                    if line=='__EOF__': break
                raise AssertionError(f'MISSING_RESULT {needle}: {received}')
            def close(self):
                if self.p.poll() is None:
                    try: self.send('rollback;\n\\q');self.p.wait(timeout=3)
                    except (BrokenPipeError,subprocess.TimeoutExpired):self.p.kill();self.p.wait(timeout=3)
        def wait_lock(app):
            deadline=time.monotonic()+8
            while time.monotonic()<deadline:
                if query("select coalesce(bool_or(wait_event_type='Lock'),false) from pg_stat_activity where application_name="+literal(app))=='t':return
                time.sleep(.02)
            raise AssertionError('REAL_LOCK_WAIT_NOT_OBSERVED')
        def record(name, fn):
            reset()
            try: fn();result['tests'].append({'name':name,'status':'PASS'})
            except Exception:
                result['tests'].append({'name':name,'status':'FAIL'});raise
            finally:
                for s in open_sessions:s.close()
                open_sessions.clear()
        def duplicate():
            a,b=Session('recovery-a'),Session('recovery-b')
            sql=recovery_sql();a.send('begin;'+sql+'\n\\echo A_READY');a.until('A_READY')
            b.send(sql);wait_lock(b.app);a.send('commit;');out=b.until('ALREADY_APPLIED')
            assert any('ALREADY_APPLIED' in x for x in out)
            assert stats()=={'audits':1,'status':'READY','revision':13}
        record('two concurrent identical requests -> one effective recovery, one audit',duplicate)
        def newer_connection():
            a,b=Session('recovery-a'),Session('recovery-b')
            a.send("begin; update public.review_provider_connections set last_error='NEW_ERROR',updated_at=clock_timestamp() where id='"+ids['connection']+"';\n\\echo A_READY")
            a.until('A_READY');b.send(recovery_sql());wait_lock(b.app);a.send('commit;');b.until('RECOVERY_CONNECTION_CHANGED')
            assert stats()=={'audits':0,'status':'ERROR','revision':13}
        record('concurrent newer connection error cannot be cleared',newer_connection)
        def newer_session():
            a,b=Session('recovery-a'),Session('recovery-b')
            a.send("begin; update review_private.yandex_sessions set revision=14,state='NOT_CONFIGURED';\n\\echo A_READY")
            a.until('A_READY');b.send(recovery_sql());wait_lock(b.app);a.send('commit;');b.until('RECOVERY_SESSION_CHANGED')
            assert stats()=={'audits':0,'status':'ERROR','revision':14}
        record('concurrent session replacement cannot be accepted as revision 13',newer_session)
        def session_wait():
            a,b=Session('recovery-a'),Session('recovery-b')
            a.send('begin;'+recovery_sql()+'\n\\echo A_READY');a.until('A_READY')
            b.send("update review_private.yandex_sessions set revision=14,state='NOT_CONFIGURED';\n\\echo B_DONE")
            wait_lock(b.app);a.send('commit;');b.until('B_DONE')
            assert stats()=={'audits':1,'status':'READY','revision':14}
        record('recovery holds shared session lock through transaction end',session_wait)
        def active_run():
            a,b=Session('recovery-a'),Session('recovery-b')
            a.send("begin; insert into public.review_sync_runs values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','"+ids['connection']+"','QUEUED',null,'{}');\n\\echo A_READY")
            a.until('A_READY');b.send(recovery_sql());wait_lock(b.app);a.send('commit;');b.until('RECOVERY_ACTIVE_RUN')
            assert stats()=={'audits':0,'status':'ERROR','revision':13}
        record('concurrent queued run through existing FK blocks recovery',active_run)
        def expired_wait():
            a,b=Session('recovery-a'),Session('recovery-b')
            params=list(fixture['args']);params[-1]=query("select (clock_timestamp()+interval '2 seconds')::text")
            a.send("begin; select id from public.review_provider_connections where id='"+ids['connection']+"' for update;\n\\echo A_READY")
            a.until('A_READY');b.send(recovery_sql(params));wait_lock(b.app)
            time.sleep(2.1);a.send('rollback;');b.until('RECOVERY_APPROVAL_INVALID')
            assert stats()=={'audits':0,'status':'ERROR','revision':13}
        record('approval expiration is rechecked after lock wait',expired_wait)
        result['status']='PASS_NATIVE_POSTGRES_17_CONCURRENCY'
    except Exception as exc:
        result['status']='FAIL_NATIVE_GATE'
        # Only constant test labels or synthetic local DB errors; never a user DSN or credentials.
        result['failure_type']=type(exc).__name__
        result['failure_summary']=str(exc)[:300]
    finally:
        for s in open_sessions:s.close()
        if started:command('pg_ctl',['-D',str(dbdir),'-m','immediate','-w','stop'],timeout=30)
        shutil.rmtree(base,ignore_errors=True)
        report.parent.mkdir(parents=True,exist_ok=True);report.write_text(json.dumps(result,indent=2))
    return 0 if result['status'].startswith('PASS_') else 1

if __name__=='__main__':raise SystemExit(main())
