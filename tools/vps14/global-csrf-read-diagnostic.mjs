import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {userInfo} from 'node:os';
import {
  createVpsSessionContext,VPS_SESSION_SCOPE as scope
} from '../../lib/server/yandex-session/profile-context.js';
import {decryptSessionClassified,fail} from '../../lib/server/yandex-session/crypto.js';
import {createSessionStore} from '../../lib/server/yandex-session/store.js';
import {createVpsRpc} from '../vps08a/pg.mjs';

const URL='https://yandex.ru/sprav/54309413522/edit/reviews';
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');

function loadKeyring(){
  const fd=openSync('/etc/review-activator-yandex/session-key.json',
    constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const s=fstatSync(fd);
    if(!s.isFile()||s.uid!==0||s.gid!==process.getgid()||
       (s.mode&0o777)!==0o640||s.nlink!==1||s.size>1024)
      fail('SESSION_KEY_NOT_CONFIGURED');
    const raw=readFileSync(fd);
    try{
      const value=JSON.parse(raw.toString('utf8'));
      if(Object.keys(value).sort().join()!=='key,kid'||
         !/^vps-yandex-[a-f0-9]{16}$/.test(value.kid)||
         !/^[A-Za-z0-9+/]{43}=$/.test(value.key))
        fail('SESSION_KEY_NOT_CONFIGURED');
      return {
        currentKid:value.kid,
        keys:{[value.kid]:Buffer.from(value.key,'base64')}
      };
    }finally{raw.fill(0);}
  }finally{closeSync(fd);}
}

function contentType(value){
  if(/^text\/html(?:;|$)/i.test(value||''))return 'HTML';
  if(/^application\/(?:[a-z0-9.-]+\+)?json(?:;|$)/i.test(value||''))return 'JSON';
  return 'OTHER';
}

function scanCsrf(text){
  // Values stay in local memory only. Output contains counts and lengths, never values.
  const direct=[...text.matchAll(/["']csrf["']\s*:\s*["']([^"'\\]{8,512})["']/g)];
  const escaped=[...text.matchAll(/(?:\\u0022|\\")csrf(?:\\u0022|\\")\s*:\s*(?:\\u0022|\\")([^"\\]{8,512})(?:\\u0022|\\")/g)];
  const lengths=[...new Set([...direct,...escaped].map(match=>match[1].length))].sort((a,b)=>a-b);
  return {
    csrf_key_occurrences:(text.match(/csrf/gi)||[]).length,
    csrf_value_candidate_count:direct.length+escaped.length,
    csrf_candidate_lengths:lengths
  };
}

let ring,session;
try{
  if(process.argv.length!==2)fail('SESSION_MODE_INVALID');
  if(userInfo().username!=='review-yandex-reader')fail('SESSION_ROLE_DENIED');

  const context=createVpsSessionContext();
  const store=createSessionStore({rpc:createVpsRpc(),context});
  ring=loadKeyring();
  const row=await store.read(scope);
  if(!row||row.state!=='READY')fail('SESSION_NOT_READY');
  session=decryptSessionClassified(scope,row,ring,Date.now(),context);

  const cookie=session.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
  const response=await fetch(URL,{
    method:'GET',
    headers:{Accept:'text/html,application/xhtml+xml',Cookie:cookie},
    redirect:'manual',
    signal:AbortSignal.timeout(10000)
  });
  if(response.status===401)fail('YANDEX_HTTP_401');
  if(response.status===403)fail('YANDEX_HTTP_403');
  if(response.status>=300&&response.status<400)fail('YANDEX_LOGIN_REDIRECT');
  if(response.status!==200)fail('YANDEX_HTTP_ERROR');

  const text=await response.text();
  const bytes=Buffer.byteLength(text,'utf8');
  if(bytes>4_000_000)fail('YANDEX_RESPONSE_TOO_LARGE');
  const scan=scanCsrf(text);

  emit({
    ok:true,
    operation:'global_csrf_read_diagnostic',
    provider_requests:1,
    provider_writes:0,
    answer_endpoint_called:false,
    status:response.status,
    content_type:contentType(response.headers.get('content-type')),
    bytes,
    preload_marker:text.includes('__PRELOAD_DATA'),
    ...scan
  });
}catch(error){
  emit({
    ok:false,
    operation:'global_csrf_read_diagnostic',
    error:[
      'SESSION_NOT_READY','SESSION_PLAINTEXT_SCHEMA_INVALID',
      'YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT',
      'YANDEX_HTTP_ERROR','YANDEX_RESPONSE_TOO_LARGE'
    ].includes(error?.code)?error.code:'GLOBAL_CSRF_DIAGNOSTIC_FAILED',
    provider_writes:0,
    answer_endpoint_called:false
  });
  process.exitCode=1;
}finally{
  if(session?.cookies)for(const cookie of session.cookies)if(cookie)cookie.value='';
  if(ring)for(const key of Object.values(ring.keys))key.fill(0);
}
