"""Install only the four tested VPS09A telemetry sources. No invocation/DB/key read.
Fixed VPS paths, source hash, original byte hashes, 0700 code rollback checkpoint.
Not a network-policy change. A repeated/partial invocation fails closed.
"""
import hashlib,json,os,pwd,shutil,socket,subprocess,tarfile
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path('/opt/review-activator-yandex');STATE=Path('/var/lib/review-activator-ops')
ARCHIVE=Path('/tmp/vps09b-safe-telemetry.tar');STAGE=Path('/tmp/vps09b-telemetry-checked')
OLD={
 'lib/server/yandex-session/transport.js':'373b7c5b5a7f02d67e4e69ee2e9b245c39a00e607f9498abca3192fba1f25942',
 'lib/server/yandex-session/service.js':'905d9da5047de1b051bc73afa58b72646bd45c426a9ce998cbdcb25356490f99',
 'tools/vps08a/session.mjs':'e1b6c181c416026e609692123e18bed305efe5f8be828ae78a17840773f15797'}
NEW={
 'lib/server/yandex-session/network-diagnostic.js':'da75d11eb6b3bfef31d49020a1eb2c5902967f528bdda33556057bf6c97747f6',
 'lib/server/yandex-session/transport.js':'498eb7ac40610d6de6f5a606d71230485842d49b42e18d157732c6e9dedb046c',
 'lib/server/yandex-session/service.js':'bc77ded50320ec4c7563e4d25f59e1260f8d5fffc4a92cdd5a565ea375993cc4',
 'tools/vps08a/session.mjs':'66e9d299945d70921dd10779e30434b3254160763eabceb6a67e9aa018965cfa'}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 assert os.getuid()==0 and socket.gethostname()=='hiplet-120706'
 complete=[json.loads(s) for s in (STATE/'VPS09B_NETWORK.jsonl').read_text().splitlines()]
 assert complete[-1]['kind']=='complete' and complete[-1]['attempts']==54
 assert digest(ARCHIVE)=='60b181a1bda7c22aed2448f17f24a39c0864da9569bc67f43f7da3d26f5f7fa9'
 assert not STAGE.exists() and not (STATE/'VPS09B_TELEMETRY.json').exists()
 assert not (ROOT/'lib/server/yandex-session/network-diagnostic.js').exists()
 assert all(digest(ROOT/p)==h for p,h in OLD.items())
 manifest_path=ROOT/'VPS08A_RELEASE.json';manifest=json.loads(manifest_path.read_text())
 entries={e['path']:e for e in manifest['files'] if e['runtime']}
 assert len(entries)==24 and all(digest(ROOT/p)==e['sha256'] for p,e in entries.items())
 timer=subprocess.run(['systemctl','show','review-activator-worker.timer','-p','ActiveState','-p','UnitFileState'],capture_output=True,text=True,check=True).stdout
 assert timer.splitlines()==['ActiveState=inactive','UnitFileState=disabled']
 STAGE.mkdir(mode=0o700)
 with tarfile.open(ARCHIVE) as tar:
  assert set(e.name for e in tar.getmembers())==set(NEW) and all(e.isfile() for e in tar.getmembers())
  tar.extractall(STAGE,filter='data')
 assert all(digest(STAGE/p)==h for p,h in NEW.items())
 for p in NEW:
  checked=subprocess.run(['/opt/node/bin/node','--check',str(STAGE/p)],capture_output=True,timeout=10)
  assert checked.returncode==0
 backup=STATE/'vps09b-runtime-before';backup.mkdir(mode=0o700)
 for p in [*OLD,'VPS08A_RELEASE.json']:
  target=backup/p;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/p,target)
 gid=pwd.getpwnam('review-yandex-reader').pw_gid
 for p,h in NEW.items():
  target=ROOT/p;temporary=target.with_suffix(target.suffix+'.vps09b')
  assert not temporary.exists();shutil.copyfile(STAGE/p,temporary);os.chown(temporary,0,gid);os.chmod(temporary,0o640);temporary.replace(target)
  if p in entries:entries[p]['sha256']=h
  else:manifest['files'].append({'path':p,'sha256':h,'runtime':True})
 receipt={'status':'PASS','utc':datetime.now(timezone.utc).isoformat(),'source_sha':'652fed6ab1dbae3dd05fae9dccbe1d02c78927f7',
  'files':NEW,'rollback_code_checkpoint':str(backup),'rollback_mode':'0700','file_owner':'root:review-yandex-reader','file_mode':'0640',
  'network_policy_changed':False,'business_invocations':0,'db_writes':0,'restart_count':0,'release_runtime_files':25}
 manifest['vps09b_telemetry']=receipt
 pending=manifest_path.with_suffix('.vps09b');pending.write_text(json.dumps(manifest,indent=2)+'\n');os.chmod(pending,manifest_path.stat().st_mode&0o777);os.chown(pending,manifest_path.stat().st_uid,manifest_path.stat().st_gid);pending.replace(manifest_path)
 assert all(digest(ROOT/e['path'])==e['sha256'] for e in manifest['files'] if e['runtime'])
 report=STATE/'VPS09B_TELEMETRY.json';report.write_text(json.dumps(receipt));report.chmod(0o600)
 print(json.dumps(receipt))
if __name__=='__main__':
 try:main()
 except Exception:print(json.dumps({'status':'FAIL','error':'TELEMETRY_NOT_CONFIRMED','retry':'FORBIDDEN'}));raise SystemExit(1)
