import {ROOT,ETC,ISSUER,run,sql,unit,secretFile,sha} from './bootstrap.mjs';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

const src=resolve(process.argv[2]||'');
let stage='GUARD';
try {
  if(process.getuid()!==0||run('hostname',[]).trim()!=='hiplet-120706') throw new Error();
  const baseline=readFileSync(join(src,'supabase/migrations/20260912090000_review_activator_canonical_baseline.sql'));
  if(sha(baseline)!=='71aa35c22cb2aa99a39491b22de8f0f56d390dd53d6165223a8c61f15126176c') throw new Error();
  if(sql("select to_regclass('public.review_companies') is null;").trim().split('\n').at(-1)!=='t') throw new Error();
  stage='PLATFORM_HELPERS';sql(readFileSync(join(src,'tools/vps04/platform-and-policy.sql'),'utf8'));
  // Exact pinned baseline boundary: exclude all compatibility auth/cron stubs.
  const app=baseline.toString().split('create table public.review_companies (');
  if(app.length!==2) throw new Error();
  stage='APP_BASELINE';sql("begin; set local search_path=public,pg_catalog;\ncreate table public.review_companies ("+app[1]);
  const migrations=readdirSync(join(src,'supabase/migrations')).filter(n=>n.endsWith('.sql')&&n>'20260912090000'&&!n.includes('canonical_baseline')&&!n.includes('scheduler_acl_09a')).sort();
  for(const name of migrations) {stage=name;sql(readFileSync(join(src,'supabase/migrations',name),'utf8'));}
  stage='SCOPED_RPC_POLICY';
  // Reuse exact existing RPC shape/query; add membership and LAB organization checks.
  let rpc=readFileSync(join(src,'supabase/migrations/20260913112000_yandex_admin_reviews_scope_ambiguity_fix_06a.sql'),'utf8');
  const guard="if not public.review_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;";
  if(rpc.split(guard).length!==2) throw new Error();
  rpc=rpc.replace(guard,guard+"\n  if not vps_lab_private.has_company(p_company_id) then raise exception using errcode='42501',message='COMPANY_ACCESS_DENIED'; end if;");
  rpc=rpc.replace("p_external_location_id is distinct from '54309413522'", "p_external_location_id is distinct from ('lab-org-' || case p_company_id when '10000000-0000-4000-8000-000000000001'::uuid then 'a' when '10000000-0000-4000-8000-000000000002'::uuid then 'b' else 'invalid' end)");
  sql(readFileSync(join(src,'tools/vps04/lab-policy.sql'),'utf8'));
  sql(rpc);
  stage='POSTGREST_CONFIG';
  const state=JSON.parse(readFileSync(ETC+'/bootstrap.json','utf8'));
  secretFile('api.env',Object.entries({
    PGRST_DB_URI:`postgresql://ra_lab_authenticator:${state.apiPassword}@127.0.0.1:5432/review_activator_lab`,
    PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_DB_PRE_REQUEST:'public.vps_lab_check_claims',
    PGRST_JWT_SECRET:JSON.stringify({keys:[state.pub]}),PGRST_JWT_AUD:'authenticated',
    PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'13001',PGRST_OPENAPI_MODE:'disabled',
    PGRST_DB_CONFIG:'false',PGRST_DB_POOL:'5',PGRST_LOG_LEVEL:'crit',PGRST_SERVER_TIMING_ENABLED:'false'
  }).map(([k,v])=>`${k}='${v}'`).join('\n')+'\n');
  unit('api','ra-lab-api',ROOT+'/components/postgrest-v14.17/postgrest',{envFile:ETC+'/api.env',memory:192});
  run('systemctl',['daemon-reload']);run('systemctl',['enable','--now','review-lab-api']);
  writeFileSync(ROOT+'/VPS04_SCHEMA.json',JSON.stringify({baseline_sha256:sha(baseline),retained:migrations,recovery09:'MIGRATION_COMPAT_ONLY',recovery09a:'NOT_APPLIED',cloud_writes:0},null,2),{flag:'wx',mode:0o644});
  console.log(JSON.stringify({schema:'PASS',postgrest_started:true,cloud_writes:0}));
}catch {console.log(JSON.stringify({ok:false,stage,error:'LAB_SCHEMA_API_STOPPED'}));process.exitCode=1;}
