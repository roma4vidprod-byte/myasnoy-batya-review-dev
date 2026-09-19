"""Pinned VPS09 admin orchestration. Existing private CLI/writer only.
Safe aggregates/checkpoints; never prints child errors, rows, keys or bodies.
"""
import argparse,hashlib,importlib.util,json,os,pwd,re,shutil,socket,subprocess
from pathlib import Path
RUNTIME=Path('/opt/review-activator-yandex');OPS=Path('/opt/review-activator-lab/ops/vps05/ops.py')
STATE=Path('/var/lib/review-activator-ops');STAGE=Path('/tmp/vps09-20260919-v3')
C='13f3cb80-487a-4a19-96a1-fb3103200230';L='9a95f63b-18e6-447b-a449-8530b67ddbae';ORG='54309413522'
def need(v):
 if not v:raise RuntimeError('VPS09_GUARD_FAILED')
def ops():
 s=importlib.util.spec_from_file_location('ops',OPS);o=importlib.util.module_from_spec(s);s.loader.exec_module(o);o.guard();return o
def summary(o):
 s=o.snapshot(o.DB);o.validate_snapshot(s)
 row=o.query_json(o.DB,"select json_build_object('rows',count(*),'scope_valid',coalesce(bool_and(company_id='"+C+"' and location_id='"+L+"' and external_org_id='"+ORG+"'),false),'state',min(state),'revision',min(revision),'last_successful_sync_at',min(last_successful_sync_at)) from review_private.yandex_sessions;")
 counts=o.query_json(o.DB,"""select json_build_object('real',count(*) filter(where company_id='13f3cb80-487a-4a19-96a1-fb3103200230'),
 'synthetic',count(*) filter(where company_id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')),
 'duplicates',(select count(*) from (select company_id,location_id,provider,external_review_id from public.review_external_reviews group by 1,2,3,4 having count(*)>1) d),
 'with_owner_reply',count(*) filter(where company_id='13f3cb80-487a-4a19-96a1-fb3103200230' and owner_reply_text is not null),
 'without_owner_reply',count(*) filter(where company_id='13f3cb80-487a-4a19-96a1-fb3103200230' and owner_reply_text is null),
 'scope_valid',coalesce(bool_and(location_id='9a95f63b-18e6-447b-a449-8530b67ddbae' and provider='yandex' and external_location_id='54309413522') filter(where company_id='13f3cb80-487a-4a19-96a1-fb3103200230'),true),
 'ratings_valid',coalesce(bool_and(rating between 1 and 5),true),
 'raw_allowed',not exists(select 1 from public.review_external_reviews r cross join lateral jsonb_object_keys(r.raw_payload) k(key)
 where not(k.key=any(array['contract_version','type_confirmation','id','cmnt_entity_id','external_id_source','author_name','full_text','rating','time_created','owner_comment','comments_count','lang','public_rating'])))) from public.review_external_reviews;""")
 synthetic=o.sql(o.DB,"select encode(sha256(convert_to(coalesce(string_agg(row_to_json(r)::text,'' order by id),''),'UTF8')),'hex') from public.review_external_reviews r where company_id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');")
 timer=o.run(['systemctl','show','review-activator-worker.timer','-p','ActiveState','-p','UnitFileState']).decode().splitlines()
 health=o.app_health();listeners=o.run(['ss','-H','-lnt']).decode().splitlines()
 need(row['rows']==1 and row['scope_valid'] and row['state']=='READY' and row['revision']==4)
 need(counts['synthetic']==2 and counts['duplicates']==0 and all(counts[k] for k in ['scope_valid','ratings_valid','raw_allowed']))
 need(health=={'healthz':200,'readyz':200} and o.listener_evaluation(listeners))
 need(timer==['ActiveState=inactive','UnitFileState=disabled'])
 return {'utc':o.utc(),'session':row,'reviews':counts,'table_counts':{k:v['count'] for k,v in s['rows'].items()},
  'table_hashes':{k:v['sha256'] for k,v in s['rows'].items()},'synthetic_hash':synthetic,'health':health,'timer':timer,'public_tcp':'SSH_ONLY'}
def install(o):
 need(not (STATE/'VPS09_INSTALL.json').exists())
 m=json.loads((STAGE/'VPS09_SOURCE.json').read_text());need(m['source_sha']=='da98ed313a3d12ce9f8b7af7b50541151d74e346')
 for e in m['files']:need(o.file_hash(STAGE/e['path'])==e['sha256'])
 native=json.loads(Path('/tmp/vps09-native-20260919-final.json').read_text());need(native['status']=='PASS' and native['cleanup']=='PASS' and native['pass']==31)
 need(native['hashes']['persistence-access.sql']==o.file_hash(STAGE/'tools/vps09/persistence-access.sql'))
 before=summary(o);need(before['reviews']['real']==0)
 release=RUNTIME/'VPS08A_RELEASE.json';old=json.loads(release.read_text());entries={e['path']:e for e in old['files'] if e['runtime']}
 need('vps08d' in old and 'vps09' not in old)
 for p,e in entries.items():need(o.file_hash(RUNTIME/p)==e['sha256'])
 backup=o.backup()
 previous=STATE/'vps09-runtime-before';previous.mkdir(mode=0o700)
 shutil.copy2(OPS,previous/'ops.py');shutil.copy2(release,previous/release.name)
 paths=['lib/server/yandex-session/service.js','tools/vps08a/pg.mjs','tools/vps08a/session.mjs']
 writer='lib/server/review-persistence-writer.js'
 need(writer not in entries and not (RUNTIME/writer).exists())
 for p in paths:
  dst=previous/p;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(RUNTIME/p,dst)
 paths.append(writer)
 # Fixed local DDL adapter. Does not replace the underlying persistence function.
 writer_before=o.sql(o.DB,"select md5(pg_get_functiondef('public.review_persist_external_reviews(uuid,uuid,text,text,jsonb)'::regprocedure));")
 o.sql(o.DB,(STAGE/'tools/vps09/persistence-access.sql').read_text(),readonly=False)
 need(writer_before==o.sql(o.DB,"select md5(pg_get_functiondef('public.review_persist_external_reviews(uuid,uuid,text,text,jsonb)'::regprocedure));"))
 gid=pwd.getpwnam('review-yandex-reader').pw_gid
 for p in paths:
  dst=RUNTIME/p;tmp=dst.with_suffix(dst.suffix+'.vps09');shutil.copyfile(STAGE/p,tmp);os.chown(tmp,0,gid);os.chmod(tmp,0o640);tmp.replace(dst)
  if p not in entries:
   entries[p]={'path':p,'sha256':o.file_hash(dst),'runtime':True};old['files'].append(entries[p])
  else:entries[p]['sha256']=o.file_hash(dst)
 old['vps09']={'source_sha':m['source_sha'],'source_manifest_sha256':o.file_hash(STAGE/'VPS09_SOURCE.json'),'changed_files':paths}
 release.write_text(json.dumps(old,indent=2)+'\n')
 tmp=OPS.with_suffix('.vps09');shutil.copyfile(STAGE/'tools/vps05/ops.py',tmp);os.chmod(tmp,0o644);tmp.replace(OPS)
 result={'status':'PASS','utc':o.utc(),'backup_before':{k:backup[k] for k in ['utc','dump','directory_mode']},'before':before,
 'original_writer_unchanged':True,'source_manifest_sha256':old['vps09']['source_manifest_sha256'],'source_updates':5,'private_sql_adapter':1}
 o.write_json(STATE/'VPS09_INSTALL.json',result);return result
def receipt(o,result,count):
 path=STATE/'VPS09_LAST_SYNC.json';prior=json.loads(path.read_text()) if path.exists() else {}
 data={'last_sync_result':result,'real_review_count':count,'sync_failure':None if result=='PASS' else 'SYNC_NOT_CONFIRMED',
  'last_successful_provider_read':o.utc() if result=='PASS' else prior.get('last_successful_provider_read'),
  'last_successful_persistence':o.utc() if result=='PASS' else prior.get('last_successful_persistence')}
 tmp=STATE/'vps09-receipt-pending.json';o.write_json(tmp,data,replace=True);tmp.replace(path)
def run_sync(o,phase):
 path=STATE/('VPS09_'+phase.upper()+'.json');need(not path.exists())
 baseline=json.loads((STATE/'VPS09_INSTALL.json').read_text())['before'];before=summary(o)
 monitor=o.monitor();need(monitor['status']=='PASS')
 need(before['reviews']['real']==0 if phase=='first' else before['reviews']['real']>0)
 if phase=='replay':need(json.loads((STATE/'VPS09_FIRST.json').read_text())['status']=='PASS')
 # Durable attempt marker: even a timeout cannot cause an automatic repeat.
 result={'status':'ATTEMPTED','phase':phase,'utc':o.utc(),'before':before,'monitor_before':'PASS'}
 o.write_json(path,result);receipt(o,'IN_PROGRESS',before['reviews']['real'])
 p=subprocess.run(['sudo','-n','-u','review-yandex-reader','--','env','-i','PATH=/usr/bin:/bin',
   'RA_RUNTIME_PROFILE=vps-lab','RA_YANDEX_MODE=read-only-admin','/opt/node/bin/node',str(RUNTIME/'tools/vps08a/session.mjs'),'manual-'+phase],
   capture_output=True,text=True,timeout=55)
 try:child=json.loads(p.stdout)
 except Exception:child={'ok':False,'error':'RESULT_NOT_CONFIRMED','attempted':None,'completed':None}
 # The installed CLI emits only fixed safe fields. Never emit its stderr.
 result['sync']=child;after=summary(o);result['after']=after
 need(before['synthetic_hash']==after['synthetic_hash']==baseline['synthetic_hash'])
 need(all(after['table_hashes'][k]==v for k,v in before['table_hashes'].items() if k!='public.review_external_reviews'))
 result['unrelated_hashes_unchanged']=True
 if p.returncode!=0 or child.get('ok') is not True:
  result['status']='FAIL';o.write_json(path,result,replace=True);receipt(o,'FAIL',after['reviews']['real']);return result
 totals=child['persistence_result'];need(totals['seen']==child['unique'] and totals['inserted']+totals['updated']+totals['unchanged']==child['unique'])
 need(after['reviews']['real']==before['reviews']['real']+totals['inserted'])
 result['status']='PASS';o.write_json(path,result,replace=True);receipt(o,'PASS',after['reviews']['real']);return result
def finish(o):
 need(json.loads((STATE/'VPS09_REPLAY.json').read_text())['status']=='PASS');before=summary(o);b=o.backup()
 monitor=o.monitor();need(monitor['status']=='PASS');result={'status':'PASS','backup_after':{k:b[k] for k in ['utc','dump','directory_mode','data_classification']},'postflight':before,
 'monitor_status':monitor['status'],'monitor_provider':monitor['sample']['provider']}
 o.write_json(STATE/'VPS09_FINAL.json',result);return result
def main():
 ap=argparse.ArgumentParser();ap.add_argument('operation',choices=['install','first','replay','finish','audit']);a=ap.parse_args()
 try:
  o=ops();need(socket.gethostname()=='hiplet-120706')
  result=install(o) if a.operation=='install' else run_sync(o,a.operation) if a.operation in ('first','replay') else finish(o) if a.operation=='finish' else summary(o)
  print(json.dumps(result));return 0 if result.get('status','PASS')=='PASS' else 1
 except Exception:print(json.dumps({'status':'FAIL','operation':a.operation,'error':'VPS09_NOT_CONFIRMED','retry':'FORBIDDEN_FOR_LIVE'}));return 1
if __name__=='__main__':raise SystemExit(main())
