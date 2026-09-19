"""Native PG17 persistence gate: NEW Unix-only disposable cluster, synthetic rows.
No existing LAB connections, provider requests or real credentials.
"""
import argparse,hashlib,json,os,pwd,shutil,subprocess,tempfile,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];PG=Path('/usr/lib/postgresql/17/bin')
C='13f3cb80-487a-4a19-96a1-fb3103200230';L='9a95f63b-18e6-447b-a449-8530b67ddbae';ORG='54309413522'
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--report',required=True);a=ap.parse_args();report=Path(a.report)
 assert not report.exists()
 result={'status':'FAIL','tests':[],'provider_requests':0,'existing_lab_connections':0,'cleanup':'NOT_RUN','hashes':{}}
 base=Path(tempfile.mkdtemp(prefix='vps09-native-')).resolve();user=pwd.getpwnam('postgres') if os.getuid()==0 else pwd.getpwuid(os.getuid());os.chmod(base,0o700)
 if os.getuid()==0:os.chown(base,user.pw_uid,user.pw_gid)
 def demote():
  if os.getuid()==0:os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)
 env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':str(base),'PGHOST':str(base),'PGPORT':'55489','PGCONNECT_TIMEOUT':'3','PGOPTIONS':'-c statement_timeout=5000 -c lock_timeout=1000'}
 def cmd(name,args,data=None):return subprocess.run([str(PG/name),*args],input=data,text=True,encoding='utf8',capture_output=True,timeout=40,env=env,cwd=base,preexec_fn=demote)
 def sql(text,role='postgres',deny=False,db='vps09_disposable'):
  p=cmd('psql',['-XqAtw','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U',role,'-d',db],text)
  if (p.returncode!=0)!=deny:
   code=re.search(r'ERROR:\s+([0-9A-Z]{5})',p.stderr);result['sqlstate']=code.group(1) if code else 'UNKNOWN'
   raise RuntimeError('SQL_EXPECTATION_FAILED')
  return p.stdout.strip() if not deny else 'DENIED'
 def check(name,fn):fn();result['tests'].append({'name':name,'status':'PASS'})
 def expect(value):
  if not value:raise RuntimeError('ASSERTION_FAILED')
 def call(rows,phase='replay',c=C,l=L,org=ORG,rev='4',provider="'yandex'"):
  body=json.dumps(rows).replace("'","''")
  return f"select vps_yandex_private.persist_call('{c}','{l}',{provider},'{org}',{rev},'{phase}','{body}'::jsonb);"
 def item(i):return {'external_review_id':i,'author_name':'SYNTHETIC','rating':5,'review_text':'SYNTHETIC',
  'published_at':'2026-01-01T00:00:00Z','observed_at':'2026-09-19T00:00:00Z','owner_reply_text':'SYNTHETIC_REPLY',
  'owner_replied_at':'2026-01-02T00:00:00Z','raw_payload':{'contract_version':'business-list-v1','owner_comment':{'text':'SYNTHETIC_REPLY','time_created':1767312000,'moderation_status':'published'}}}
 def persist(rows,phase='replay'):return json.loads(sql(call(rows,phase),'review-yandex-reader'))
 def digest():return sql("select encode(sha256(convert_to(coalesce(string_agg(row_to_json(r)::text,'' order by id),''),'UTF8')),'hex') from public.review_external_reviews r;")
 def rollback_case(rows,**kw):
  before=digest();sql(call(rows,**kw),'review-yandex-reader',deny=True);expect(digest()==before)
 started=False
 try:
  expect(cmd('initdb',['-D',str(base/'db'),'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8']).returncode==0)
  with (base/'db/postgresql.conf').open('a') as f:f.write(f"\nlisten_addresses=''\nunix_socket_directories='{base}'\nport=55489\nshared_buffers='16MB'\nmax_connections=12\nlog_statement='none'\n")
  expect(cmd('pg_ctl',['-D',str(base/'db'),'-l',str(base/'server.log'),'-w','start']).returncode==0);started=True
  sql('create database vps09_disposable;',db='postgres');result['server_version_num']=int(sql('show server_version_num;'));expect(170000<=result['server_version_num']<180000)
  paths=['supabase/migrations/20260912090000_review_activator_canonical_baseline.sql','supabase/migrations/20260912103803_yandex_session_transport_v1.sql','supabase/migrations/20260913090000_yandex_scoped_persistence_atomic_writer_04.sql','supabase/migrations/20260913100000_yandex_persistence_idempotency_05a.sql']
  for name in paths:
   p=ROOT/name;result['hashes'][name]=hashlib.sha256(p.read_bytes()).hexdigest();sql(p.read_text(encoding='utf8'))
  sql('''alter role anon login;alter role authenticated login;alter role service_role login nosuperuser nobypassrls;
   create role "review-activator" login;create schema vps_lab_private;create table vps_lab_private.version(version text);insert into vps_lab_private.version values('vps04-auth-api-v1');
   revoke all on all functions in schema public from public,anon,authenticated,service_role;
   revoke all on schema review_private from service_role;
   revoke all on all tables in schema public,review_private from service_role;''')
  for i in range(1,4):
   c=C if i==3 else f'10000000-0000-4000-8000-00000000000{i}';l=L if i==3 else f'20000000-0000-4000-8000-00000000000{i}'
   sql(f"insert into public.review_companies(id,slug,name) values('{c}','synthetic-{i}','SYNTHETIC');insert into public.review_locations(id,company_id,name,city,address) values('{l}','{c}','SYNTHETIC','SYNTHETIC','SYNTHETIC');")
   if i<3:sql(f"insert into public.review_external_reviews(company_id,location_id,provider,external_location_id,external_review_id,rating) values('{c}','{l}','yandex','lab-org-{i}','synthetic-{i}',5);")
  p=ROOT/'tools/vps08a/session-access.sql';text=p.read_text();expect(text.count('vps08a_disposable')==1);sql(text.replace('vps08a_disposable','vps09_disposable'))
  result['session_fixture_adaptation']='only disposable DB guard name';result['hashes']['session-access.sql']=hashlib.sha256(p.read_bytes()).hexdigest()
  envelope=json.dumps({'credential_version':'11111111-1111-4111-8111-111111111111','envelope':{'v':1,'kid':'synthetic','iv':'AAAAAAAAAAAAAAAA','tag':'AAAAAAAAAAAAAAAAAAAAAA==','ciphertext':'QUFBQQ=='}})
  sql(f"select vps_yandex_private.session_call('{C}','{L}','{ORG}','replace',0,'{envelope}');",'review-yandex-import')
  for rev in [1,2,3]:sql(f"select vps_yandex_private.session_call('{C}','{L}','{ORG}','transition',{rev},'{{\"state\":\"READY\",\"auth_ok\":true,\"sync_ok\":false,\"error_code\":null}}');",'review-yandex-reader')
  p=ROOT/'tools/vps09/persistence-access.sql';result['hashes'][p.name]=hashlib.sha256(p.read_bytes()).hexdigest();sql(p.read_text())
  for role in ['anon','authenticated','service_role','review-activator','review-yandex-import']:
   check(role+' wrapper denied',lambda role=role:sql(call([item('a')],'first'),role,deny=True))
  check('reader direct table denied',lambda:sql('select * from public.review_external_reviews;','review-yandex-reader',deny=True))
  check('reader direct original RPC denied',lambda:sql(f"select public.review_persist_external_reviews('{C}','{L}','yandex','{ORG}','[]');",'review-yandex-reader',deny=True))
  check('owner NOSUPERUSER NOBYPASSRLS',lambda:expect(sql("select not rolsuper and not rolbypassrls and not rolcanlogin from pg_roles where rolname='vps_yandex_owner';")=='t'))
  for name,kw in [('company',{'c':'10000000-0000-4000-8000-000000000001'}),('location',{'l':'20000000-0000-4000-8000-000000000001'}),('org',{'org':'wrong'}),('nullprovider',{'provider':'null'}),('nullrevision',{'rev':'null'}),('stale',{'rev':'3'})]:
   check('wrong '+name+' no writes',lambda kw=kw:rollback_case([item('a')],phase='first',**kw))
  check('first two inserts',lambda:expect(persist([item('a'),item('b')],'first')=={'inserted':2,'updated':0,'unchanged':0,'seen':2,'persistence_enabled':True}))
  check('first phase cannot repeat',lambda:rollback_case([item('a')],phase='first'))
  check('idempotent strict no-op',lambda:expect(persist([item('a'),item('b')])['unchanged']==2))
  before=digest();changed=item('a');changed['observed_at']='2026-09-20T00:00:00Z'
  check('observed_at-only no row mutation',lambda:expect(persist([changed])['unchanged']==1 and digest()==before))
  changed['review_text']='SYNTHETIC_CHANGED'
  check('update unchanged and new in one atomic batch',lambda:expect(persist([changed,item('b'),item('c')])=={'inserted':1,'updated':1,'unchanged':1,'seen':3,'persistence_enabled':True}))
  check('changed replay updates zero',lambda:expect(persist([changed,item('b'),item('c')])['unchanged']==3))
  check('owner reply and raw object preserved',lambda:expect(sql(f"select count(*)=3 and bool_and(owner_reply_text='SYNTHETIC_REPLY' and owner_replied_at='2026-01-02T00:00:00Z' and raw_payload->'owner_comment'->>'text'='SYNTHETIC_REPLY') from public.review_external_reviews where company_id='{C}';")=='t'))
  check('duplicate batch rollback',lambda:rollback_case([item('a'),item('a')]))
  bad=item('bad');bad['rating']=6
  check('invalid rating rollback',lambda:rollback_case([item('new'),bad]))
  bad=item('bad');bad['raw_payload']['secret']='SYNTHETIC'
  check('raw allowlist rollback',lambda:rollback_case([item('new'),bad]))
  bad=item('bad');bad['published_at']='invalid'
  check('bad timestamp DB error rollback',lambda:rollback_case([item('new'),bad]))
  sql(f"insert into public.review_external_reviews(company_id,location_id,provider,external_location_id,external_review_id,rating) values('{C}','{L}','yandex','wrong-org','z-collision',5);")
  check('collision rolls back earlier insertion',lambda:rollback_case([item('00-before-collision'),item('z-collision')]))
  sql("alter table public.review_external_reviews add constraint synthetic_failure check(external_review_id<>'zz-db-failure');")
  check('mid-loop DB constraint failure atomic rollback',lambda:rollback_case([item('00-before-failure'),item('zz-db-failure')]))
  check('synthetic rows exactly2',lambda:expect(sql(f"select count(*) from public.review_external_reviews where company_id<>'{C}';")=='2'))
  check('downstream all zero',lambda:expect(sql('select (select count(*) from public.review_matches)+(select count(*) from public.review_notification_deliveries)+(select count(*) from public.review_promo_codes)+(select count(*) from public.review_reply_actions)+(select count(*) from public.review_sync_runs);')=='0'))
  check('unique scoped identities',lambda:expect(sql('select count(*)=count(distinct(company_id,location_id,provider,external_review_id)) from public.review_external_reviews;')=='t'))
  check('session READY4 not mutated',lambda:expect(sql("select state='READY' and revision=4 and last_successful_sync_at is null from review_private.yandex_sessions;")=='t'))
  result['status']='PASS'
 except Exception:result['error']='NATIVE_GATE_FAILED'
 finally:
  if started:
   stopped=cmd('pg_ctl',['-D',str(base/'db'),'-m','fast','-w','stop']).returncode==0
   if not stopped:result['status']='FAIL';result['cleanup']='STOP_FAILED'
  else:stopped=True
  if stopped and base.parent==Path(tempfile.gettempdir()) and base.name.startswith('vps09-native-'):
   shutil.rmtree(base);result['cleanup']='PASS'
  result['pass']=len(result['tests']);result['fail']=0 if result['status']=='PASS' else 1;result['skip']=0
  report.write_text(json.dumps(result,indent=2));os.chmod(report,0o600);print(json.dumps(result))
 return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
