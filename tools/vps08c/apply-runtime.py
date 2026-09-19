"""Narrow source-only update of the existing private CLI, no DB/provider IO."""
import hashlib,json,os,pwd,shutil,socket
from pathlib import Path
def main():
    assert os.geteuid()==0 and socket.gethostname()=='hiplet-120706'
    stage=Path('/tmp/vps08c-diagnostic-20260919');target=Path('/opt/review-activator-yandex')
    manifest=target/'VPS08A_RELEASE.json';old=json.loads(manifest.read_text())
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    runtime={e['path']:e for e in old['files'] if e['runtime']}
    assert 'vps08b' in old and 'vps08c' not in old
    assert all(digest(target/p)==e['sha256'] for p,e in runtime.items())
    new=json.loads((stage/'VPS08C_SOURCE.json').read_text());assert new['base_sha']==old['base_sha']
    assert all(digest(stage/e['path'])==e['sha256'] for e in new['files'])
    # Explicitly prove strict parser has not changed since the previous live read.
    assert digest(stage/'lib/providers/yandex.js')==digest(target/'lib/providers/yandex.js')
    paths=['lib/server/yandex-session/service.js','tools/vps08a/session.mjs','lib/server/yandex-session/pagination-structure.js']
    assert not (target/paths[-1]).exists()
    backup=Path('/var/lib/review-activator-ops/vps08c-runtime-before');backup.mkdir(mode=0o700,exist_ok=False)
    shutil.copy2(manifest,backup/manifest.name)
    for p in paths[:-1]:
        dst=backup/p;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target/p,dst)
    gid=pwd.getpwnam('review-yandex-reader').pw_gid
    for p in paths:
        dst=target/p;temp=dst.with_suffix(dst.suffix+'.vps08c')
        with temp.open('xb') as f:f.write((stage/p).read_bytes())
        os.chown(temp,0,gid);os.chmod(temp,0o640);temp.replace(dst)
        if p not in runtime:
            entry={'path':p,'runtime':True};old['files'].append(entry);runtime[p]=entry
        runtime[p]['sha256']=digest(dst)
    old['vps08c']={'base_sha':new['base_sha'],'source_manifest_sha256':digest(stage/'VPS08C_SOURCE.json'),'changed_files':paths}
    manifest.write_text(json.dumps(old,indent=2)+'\n')
    assert all(digest(target/p)==e['sha256'] for p,e in runtime.items())
    print(json.dumps({'runtime_update':'PASS','files':len(paths),'parser_unchanged':True,'all_runtime_hashes_match':True,'previous_source_preserved':True,'key_env_db_changes':0}))
if __name__=='__main__':
    try:main()
    except Exception:print(json.dumps({'runtime_update':'FAIL','error':'SOURCE_UPDATE_NOT_CONFIRMED'}));raise SystemExit(1)
