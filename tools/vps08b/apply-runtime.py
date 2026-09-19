"""Source-only private CLI update; no DB/provider/key/env operations."""
import hashlib,json,os,pwd,shutil,socket
from pathlib import Path
def main():
    assert os.geteuid()==0 and socket.gethostname()=='hiplet-120706'
    stage=Path('/tmp/vps08b-diagnostic-20260919')
    target=Path('/opt/review-activator-yandex')
    manifest=target/'VPS08A_RELEASE.json'
    old=json.loads(manifest.read_text())
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    runtime={e['path']:e for e in old['files'] if e['runtime']}
    assert all(digest(target/p)==e['sha256'] for p,e in runtime.items())
    new=json.loads((stage/'VPS08B_SOURCE.json').read_text())
    assert new['base_sha']==old['base_sha']
    assert all(digest(stage/e['path'])==e['sha256'] for e in new['files'])
    paths=['lib/providers/yandex.js','lib/server/yandex-session/service.js','lib/server/yandex-session/transport.js','tools/vps08a/session.mjs']
    backup=Path('/var/lib/review-activator-ops/vps08b-runtime-before')
    backup.mkdir(mode=0o700,exist_ok=False)
    shutil.copy2(manifest,backup/manifest.name)
    for p in paths:
        dest=backup/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target/p,dest)
    gid=pwd.getpwnam('review-yandex-reader').pw_gid
    for p in paths:
        dst=target/p;temp=dst.with_suffix(dst.suffix+'.vps08b')
        with temp.open('xb') as f:f.write((stage/p).read_bytes())
        os.chown(temp,0,gid);os.chmod(temp,0o640);temp.replace(dst)
        runtime[p]['sha256']=digest(dst)
    old['vps08b']={'base_sha':new['base_sha'],'source_manifest_sha256':digest(stage/'VPS08B_SOURCE.json'),'changed_files':paths}
    manifest.write_text(json.dumps(old,indent=2)+'\n')
    assert all(digest(target/p)==e['sha256'] for p,e in runtime.items())
    print(json.dumps({'runtime_update':'PASS','files':len(paths),'all_runtime_hashes_match':True,'previous_source_preserved':True,'key_env_db_changes':0}))
if __name__=='__main__':
    try:main()
    except Exception:print(json.dumps({'runtime_update':'FAIL','error':'SOURCE_UPDATE_NOT_CONFIRMED'}));raise SystemExit(1)
