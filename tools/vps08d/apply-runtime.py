"""Reviewed private CLI source update only; no DB, key/env or provider IO."""
import hashlib,json,os,pwd,shutil,socket
from pathlib import Path

def main():
    assert os.geteuid()==0 and socket.gethostname()=='hiplet-120706'
    stage=Path('/tmp/vps08d-diagnostic-20260919');target=Path('/opt/review-activator-yandex')
    manifest=target/'VPS08A_RELEASE.json';old=json.loads(manifest.read_text())
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    runtime={e['path']:e for e in old['files'] if e['runtime']}
    assert 'vps08c' in old and 'vps08d' not in old
    assert all(digest(target/p)==e['sha256'] for p,e in runtime.items())
    new=json.loads((stage/'VPS08D_SOURCE.json').read_text());assert new['base_sha']==old['base_sha']
    assert all(digest(stage/e['path'])==e['sha256'] for e in new['files'])
    # Individual-item normalization and its raw-field allowlist stay unchanged.
    item_contract=lambda p:p.read_text().split('export function parseYandexReviewsPayload(')[0]
    assert item_contract(stage/'lib/providers/yandex.js')==item_contract(target/'lib/providers/yandex.js')
    paths=['lib/providers/yandex.js','lib/server/yandex-session/service.js',
           'lib/server/yandex-session/vps-diagnostic.js','tools/vps08a/session.mjs']
    assert all(p in runtime for p in paths)
    for p in runtime:
        if p not in paths and (stage/p).exists():assert digest(stage/p)==digest(target/p)
    backup=Path('/var/lib/review-activator-ops/vps08d-runtime-before');backup.mkdir(mode=0o700,exist_ok=False)
    shutil.copy2(manifest,backup/manifest.name)
    for p in paths:
        dst=backup/p;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target/p,dst)
    gid=pwd.getpwnam('review-yandex-reader').pw_gid
    for p in paths:
        dst=target/p;temp=dst.with_suffix(dst.suffix+'.vps08d')
        with temp.open('xb') as f:f.write((stage/p).read_bytes())
        os.chown(temp,0,gid);os.chmod(temp,0o640);temp.replace(dst)
        runtime[p]['sha256']=digest(dst)
    old['vps08d']={'base_sha':new['base_sha'],'source_manifest_sha256':digest(stage/'VPS08D_SOURCE.json'),'changed_files':paths}
    manifest.write_text(json.dumps(old,indent=2)+'\n')
    assert all(digest(target/p)==e['sha256'] for p,e in runtime.items())
    print(json.dumps({'runtime_update':'PASS','files':len(paths),'item_contract_unchanged':True,
       'all_runtime_hashes_match':True,'previous_source_preserved':True,'key_env_db_changes':0,
       'source_manifest_sha256':digest(stage/'VPS08D_SOURCE.json')}))
if __name__=='__main__':
    try:main()
    except Exception:print(json.dumps({'runtime_update':'FAIL','error':'SOURCE_UPDATE_NOT_CONFIRMED'}));raise SystemExit(1)
