// Explicit synthetic LAB bootstrap, executed as root only on the approved VPS.
// No credentials in argv/stdout. Captured child output is never reflected.
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {randomBytes,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';

export const ROOT='/opt/review-activator-lab';
export const ETC='/etc/review-activator-lab';
export const ISSUER='http://127.0.0.1:13000/auth/v1';
export const sha=b=>createHash('sha256').update(b).digest('hex');
export function run(cmd,args,input,env) {
  const r=spawnSync(cmd,args,{input,env:env||process.env,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
  if(r.status!==0) throw Object.assign(new Error('LAB_COMPONENT_COMMAND_FAILED'),{safeStatus:r.status});
  return r.stdout;
}
export function sql(text) {
  return run('runuser',['-u','postgres','--','psql','-X','-v','ON_ERROR_STOP=1','-At','-d','review_activator_lab'],
    "set log_statement='none'; set log_min_error_statement='panic';\n"+text);
}
export function secretFile(name,data) {
  const path=join(ETC,name);
  writeFileSync(path,data,{flag:'wx',mode:0o600});chmodSync(path,0o600);
}
export function token(jwk,claims) {
  const head=Buffer.from(JSON.stringify({alg:'ES256',typ:'JWT',kid:jwk.kid})).toString('base64url');
  const body=Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${head}.${body}.`+sign('sha256',Buffer.from(`${head}.${body}`),{key:jwk,format:'jwk',dsaEncoding:'ieee-p1363'}).toString('base64url');
}
export function unit(name,user,command,{envFile,memory=256,workdir=ROOT}={}) {
  const text=`[Unit]\nDescription=Review Activator synthetic LAB ${name}\nAfter=postgresql@17-main.service network.target\nStartLimitIntervalSec=120\nStartLimitBurst=3\n[Service]\nType=simple\nUser=${user}\nGroup=${user}\nWorkingDirectory=${workdir}\n${envFile?'EnvironmentFile='+envFile+'\n':''}ExecStart=${command}\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=10\nUMask=0077\nNoNewPrivileges=true\nCapabilityBoundingSet=\nPrivateTmp=true\nPrivateDevices=true\nProtectSystem=strict\nProtectHome=true\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\nRestrictRealtime=true\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nIPAddressDeny=any\nIPAddressAllow=localhost\nMemoryMax=${memory}M\nMemorySwapMax=0\nCPUQuota=100%\nTasksMax=96\nStandardOutput=null\nStandardError=null\n[Install]\nWantedBy=multi-user.target\n`;
  writeFileSync(`/etc/systemd/system/review-lab-${name}.service`,text,{flag:'wx',mode:0o644});
}
function systemUser(name) {run('useradd',['--system','--no-create-home','--shell','/usr/sbin/nologin',name]);}
function auth() {
  if(existsSync(ETC)) throw new Error('LAB_ALREADY_CONFIGURED');
  const empty=sql("select count(*) from information_schema.tables where table_schema not in ('information_schema','pg_catalog');").trim().split('\n').at(-1);
  if(empty!=='0') throw new Error('LAB_DATABASE_NOT_EMPTY');
  mkdirSync(ETC,{mode:0o700});
  const jwk=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});
  Object.assign(jwk,{kid:'vps04-lab-es256',alg:'ES256',use:'sig',key_ops:['sign','verify']});
  const {d,...pub}=jwk;pub.key_ops=['verify'];
  const authPassword=randomBytes(32).toString('hex'),apiPassword=randomBytes(32).toString('hex');
  const now=Math.floor(Date.now()/1000),claims={iss:ISSUER,aud:'authenticated',iat:now,exp:now+86400*30};
  const state={jwk,pub,authPassword,apiPassword,anon:token(jwk,{...claims,role:'anon'}),service:token(jwk,{...claims,role:'service_role'})};
  secretFile('bootstrap.json',JSON.stringify(state));
  sql(`alter role supabase_auth_admin login nosuperuser nobypassrls nocreatedb nocreaterole password '${authPassword}';
    alter role service_role nobypassrls;
    create role ra_lab_authenticator login noinherit nosuperuser nobypassrls nocreatedb nocreaterole password '${apiPassword}';
    grant anon,authenticated,service_role to ra_lab_authenticator;
    revoke create on schema public from public;
    create schema auth authorization supabase_auth_admin;
    alter role supabase_auth_admin in database review_activator_lab set search_path=auth;
    grant connect on database review_activator_lab to supabase_auth_admin,ra_lab_authenticator;`);
  const env={GOTRUE_API_HOST:'127.0.0.1',PORT:'19999',GOTRUE_API_PORT:'19999',API_EXTERNAL_URL:ISSUER,
    GOTRUE_SITE_URL:'http://127.0.0.1:13000',GOTRUE_URI_ALLOW_LIST:'http://127.0.0.1:13000/admin.html',
    GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgresql://supabase_auth_admin:${authPassword}@127.0.0.1:5432/review_activator_lab?sslmode=disable`,
    GOTRUE_DB_NAMESPACE:'auth',GOTRUE_DB_MIGRATIONS_PATH:ROOT+'/components/auth-v2.196.0/migrations',
    GOTRUE_JWT_SECRET:randomBytes(32).toString('hex'),GOTRUE_JWT_KEYS:JSON.stringify([jwk]),
    GOTRUE_JWT_ISSUER:ISSUER,GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_EXP:'900',
    GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',
    GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'true',
    GOTRUE_EXTERNAL_PHONE_ENABLED:'false',GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED:'false',
    GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:'19998',GOTRUE_SMTP_ADMIN_EMAIL:'sink@vps04.invalid',
    GOTRUE_LOG_LEVEL:'error',GOTRUE_TRACING_ENABLED:'false',GOTRUE_METRICS_ENABLED:'false'};
  // systemd quoting is not shell quoting; JSON values need single-quoted RHS.
  secretFile('auth.env',Object.entries(env).map(([k,v])=>`${k}='${v}'`).join('\n')+'\n');
  systemUser('ra-lab-auth');systemUser('ra-lab-api');
  run(ROOT+'/components/auth-v2.196.0/auth',['migrate'],undefined,{...process.env,...env});
  unit('auth','ra-lab-auth',ROOT+'/components/auth-v2.196.0/auth',{envFile:ETC+'/auth.env',memory:384});
  run('systemctl',['daemon-reload']);run('systemctl',['enable','--now','review-lab-auth']);
  console.log(JSON.stringify({auth_migrations:'PASS',synthetic_keys:'CREATED_SERVER_ONLY',cloud_effects:0}));
}
if(process.argv[1]===resolve(import.meta.filename)) {
  let stage=process.argv[2];
  try {
    if(process.getuid()!==0||run('hostname',[]).trim()!=='hiplet-120706') throw new Error('WRONG_LAB_HOST');
    if(stage==='auth') auth();else throw new Error('STAGE_INVALID');
  }catch {console.log(JSON.stringify({ok:false,stage,error:'LAB_BOOTSTRAP_STOPPED_NO_AUTOMATIC_RETRY'}));process.exitCode=1;}
}
