"""One-time, explicit VPS08A LAB installation. No session import/provider call.

Input is a reviewed source-only staging directory. Refuses existing installation;
never rotates/reuses a key, changes SSH/listeners/timers or retries mutations.
"""
import argparse
import base64
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import socket
import subprocess
import sys

DEST=Path('/opt/review-activator-yandex')
KEYDIR=Path('/etc/review-activator-yandex')
OPS=Path('/opt/review-activator-lab/ops/vps05/ops.py')
STATE=Path('/var/lib/review-activator-ops')
stage='GUARD'

def need(value,code):
    if not value:raise RuntimeError(code)

def run(argv):
    p=subprocess.run(argv,capture_output=True,timeout=30,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'})
    need(p.returncode==0,'INSTALL_COMMAND_FAILED')

def main():
    global stage
    ap=argparse.ArgumentParser();ap.add_argument('--stage',required=True);a=ap.parse_args()
    src=Path(a.stage).resolve()
    need(os.geteuid()==0 and socket.gethostname()=='hiplet-120706','HOST_DENIED')
    need(src.parent==Path('/tmp') and src.name.startswith('vps08a-install-'),'STAGE_DENIED')
    need(not DEST.exists() and not KEYDIR.exists(),'INSTALL_ALREADY_PRESENT')
    os.umask(0o077)
    manifest=json.loads((src/'VPS08A_INSTALL_MANIFEST.json').read_text())
    for e in manifest['files']:
        p=src/e['path'];need(p.resolve().is_relative_to(src) and not p.is_symlink(),'SOURCE_PATH_DENIED')
        need(hashlib.sha256(p.read_bytes()).hexdigest()==e['sha256'],'SOURCE_HASH_MISMATCH')
    need(hashlib.sha256(OPS.read_bytes()).hexdigest()==manifest['previous_ops_sha256'],'EXISTING_OPS_CHANGED')
    spec=importlib.util.spec_from_file_location('ops',OPS);ops=importlib.util.module_from_spec(spec);spec.loader.exec_module(ops)
    ops.guard();need(ops.app_health()=={'healthz':200,'readyz':200},'HEALTH_FAILED')
    need(ops.run(['systemctl','show','review-activator-worker.timer','-p','ActiveState','-p','UnitFileState']).decode().strip()=='ActiveState=inactive\nUnitFileState=disabled','TIMER_NOT_OFF')
    need(ops.sql(ops.DB,"select count(*) from pg_roles where rolname in ('review-yandex-reader','review-yandex-import','vps_yandex_owner');")=='0','ROLES_EXIST')
    for name in ['review-yandex-reader','review-yandex-import']:
        try:pwd.getpwnam(name)
        except KeyError:pass
        else:raise RuntimeError('OS_USER_EXISTS')
    try:grp.getgrnam('review-yandex')
    except KeyError:pass
    else:raise RuntimeError('OS_GROUP_EXISTS')
    stage='PROTECTED_BACKUP';backup=ops.backup()
    report={'status':'INSTALL_IN_PROGRESS','backup':{k:backup[k] for k in ['utc','dump','directory_mode']},'session_imports':0,'provider_requests':0}
    # Keep a recoverable copy of the exact previous backup adapter.
    prior=STATE/'vps08a-previous-ops.py';need(not prior.exists(),'CHECKPOINT_EXISTS')
    shutil.copyfile(OPS,prior);os.chmod(prior,0o600)
    stage='OS_ROLES'
    run(['/usr/sbin/groupadd','--system','review-yandex'])
    for name in ['review-yandex-reader','review-yandex-import']:
        run(['/usr/sbin/useradd','--system','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','--gid','review-yandex',name])
    gid=grp.getgrnam('review-yandex').gr_gid
    stage='SOURCE_INSTALL';DEST.mkdir(mode=0o755);os.chmod(DEST,0o755)
    for e in manifest['files']:
        if e.get('runtime'):
            p=DEST/e['path'];p.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
            for directory in p.parents:
                if directory==DEST:break
                os.chmod(directory,0o755)
            shutil.copyfile(src/e['path'],p);os.chmod(p,0o644)
    (DEST/'VPS08A_RELEASE.json').write_text(json.dumps(manifest,indent=2)+'\n');os.chmod(DEST/'VPS08A_RELEASE.json',0o644)
    stage='KEY_CREATE';KEYDIR.mkdir(mode=0o750);os.chmod(KEYDIR,0o750);os.chown(KEYDIR,0,gid)
    kid='vps-yandex-'+secrets.token_hex(8)
    key=bytearray(secrets.token_bytes(32))
    try:
        fd=os.open(KEYDIR/'session-key.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640)
        try:
            os.fchown(fd,0,gid);os.fchmod(fd,0o640)
            with os.fdopen(fd,'w') as stream:json.dump({'kid':kid,'key':base64.b64encode(key).decode()},stream)
        except Exception:
            try:os.close(fd)
            except OSError:pass
            raise
    finally:key[:]=b'\0'*len(key)
    stage='SCOPED_DATABASE_INSTALL'
    scope="""insert into public.review_companies(id,slug,name) values('13f3cb80-487a-4a19-96a1-fb3103200230','review-dev-yandex-smoke-01-asbest','[DEV SYNTHETIC] Review Activator — Asbest smoke 01');
insert into public.review_locations(id,company_id,name,city,address,active) values('9a95f63b-18e6-447b-a449-8530b67ddbae','13f3cb80-487a-4a19-96a1-fb3103200230','[DEV SYNTHETIC] Асбест — Yandex 54309413522','Асбест','Ленинградская 41А',false);
"""
    sql=(src/'tools/vps08a/session-access.sql').read_text()
    need(sql.count('\ncommit;')==1,'SQL_INSTALL_CONTRACT')
    ops.sql(ops.DB,sql.replace('\ncommit;','\n'+scope+'commit;'),readonly=False)
    stage='BACKUP_COMPATIBILITY_INSTALL'
    tmp=OPS.with_name('ops-vps08a-pending.py');need(not tmp.exists(),'OPS_PENDING_EXISTS')
    shutil.copyfile(src/'tools/vps05/ops.py',tmp);os.chmod(tmp,0o644);tmp.replace(OPS)
    report.update(status='INSTALLED_NOT_IMPORTED',utc=ops.utc(),release=str(DEST),key={'kid':kid,'path':str(KEYDIR/'session-key.json'),'owner':'root','group':'review-yandex','mode':'0640'},scope_rows={'review_companies':1,'review_locations':1,'location_active':False,'review_provider_connections':0})
    ops.write_json(STATE/'VPS08A_INSTALL.json',report)
    print(json.dumps(report))

if __name__=='__main__':
    try:main()
    except Exception:print(json.dumps({'status':'FAIL','stage':stage,'error':'INSTALL_NOT_CONFIRMED','retry':False}));sys.exit(1)
