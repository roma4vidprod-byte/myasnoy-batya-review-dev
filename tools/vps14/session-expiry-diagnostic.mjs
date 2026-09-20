import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {userInfo} from 'node:os';
import {
  createVpsSessionContext,VPS_SESSION_SCOPE as scope
} from '../../lib/server/yandex-session/profile-context.js';
import {decryptSessionClassified,fail} from '../../lib/server/yandex-session/crypto.js';
import {createSessionStore} from '../../lib/server/yandex-session/store.js';
import {createVpsRpc} from '../vps08a/pg.mjs';

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
      return {currentKid:value.kid,keys:{[value.kid]:Buffer.from(value.key,'base64')}};
    }finally{raw.fill(0);}
  }finally{closeSync(fd);}
}
let ring,session;
try{
  if(process.argv.length!==2)fail('SESSION_MODE_INVALID');
  if(userInfo().username!=='review-yandex-reader')fail('SESSION_ROLE_DENIED');
  const context=createVpsSessionContext();
  const store=createSessionStore({rpc:createVpsRpc(),context});
  ring=loadKeyring();
  const row=await store.read(scope);
  if(!row)fail('SESSION_NOT_READY');

  // Diagnostic only: epoch validation opens the authenticated envelope while
  // preserving every schema rule except current-time expiry. No provider IO.
  session=decryptSessionClassified(scope,row,ring,0,context);
  const now=Date.now();
  const ttl=session.cookies
    .filter(c=>typeof c.expires==='number'&&Number.isFinite(c.expires)&&c.expires!==-1)
    .map(c=>Math.floor(c.expires-now/1000));

  const countWithin=seconds=>ttl.filter(value=>value<=seconds).length;
  const sorted=[...ttl].sort((a,b)=>a-b);
  emit({
    ok:true,
    operation:'session_expiry_diagnostic',
    provider_requests:0,
    provider_writes:0,
    revision:Number(row.revision),
    state:row.state,
    cookie_count:session.cookies.length,
    session_cookie_count:session.cookies.length-ttl.length,
    persistent_cookie_count:ttl.length,
    expired_now:countWithin(0),
    expiring_5m:countWithin(300),
    expiring_30m:countWithin(1800),
    expiring_1h:countWithin(3600),
    expiring_6h:countWithin(21600),
    expiring_24h:countWithin(86400),
    min_ttl_seconds:sorted.length?sorted[0]:null,
    max_ttl_seconds:sorted.length?sorted.at(-1):null
  });
}catch(error){
  emit({
    ok:false,
    operation:'session_expiry_diagnostic',
    error:error?.code||'SESSION_EXPIRY_DIAGNOSTIC_FAILED',
    provider_requests:0,
    provider_writes:0
  });
  process.exitCode=1;
}finally{
  if(session?.cookies)for(const cookie of session.cookies)if(cookie)cookie.value='';
  if(ring)for(const key of Object.values(ring.keys))key.fill(0);
}
