import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {join} from 'node:path';
import {decryptSessionForRequest} from '../../lib/server/yandex-session/crypto.js';
import {VPS_SESSION_SCOPE} from '../../lib/server/yandex-session/profile-context.js';

function fail(code){throw Object.assign(new Error(code),{code});}
function credentialPath(env=process.env){
  const dir=env.CREDENTIALS_DIRECTORY;
  if(typeof dir!=='string'||!dir.startsWith('/run/credentials/'))
    fail('SESSION_KEY_NOT_CONFIGURED');
  return join(dir,'yandex-session-key');
}
export function loadWriterKeyring(env=process.env){
  const fd=openSync(credentialPath(env),constants.O_RDONLY|constants.O_NOFOLLOW);
  let raw;
  try{
    const s=fstatSync(fd);
    if(!s.isFile()||s.nlink!==1||s.size<40||s.size>1024||(s.mode&0o077)!==0)
      fail('SESSION_KEY_NOT_CONFIGURED');
    raw=readFileSync(fd);
    const value=JSON.parse(raw.toString('utf8'));
    if(Object.keys(value).sort().join()!=='key,kid'||
       !/^vps-yandex-[a-f0-9]{16}$/.test(value.kid)||
       !/^[A-Za-z0-9+/]{43}=$/.test(value.key))
      fail('SESSION_KEY_NOT_CONFIGURED');
    const key=Buffer.from(value.key,'base64');
    value.key='';
    if(key.length!==32)fail('SESSION_KEY_NOT_CONFIGURED');
    return {currentKid:value.kid,keys:{[value.kid]:key}};
  }catch(error){
    if(error?.code==='SESSION_KEY_NOT_CONFIGURED')throw error;
    fail('SESSION_KEY_NOT_CONFIGURED');
  }finally{
    if(raw)raw.fill(0);
    closeSync(fd);
  }
}
export function createWriterSessionAdapter({store,context,now=()=>Date.now(),loadKeyring=loadWriterKeyring}={}){
  if(!store||typeof store.readSession!=='function')fail('REPLY_WORKER_STORE_INVALID');
  if(!context||typeof loadKeyring!=='function')fail('SESSION_PROFILE_INVALID');
  return async function getSession(){
    let ring;
    try{
      const stored=await store.readSession();
      ring=loadKeyring();
      const session=decryptSessionForRequest(VPS_SESSION_SCOPE,stored,ring,now(),context);
      return {session,stored};
    }finally{
      if(ring)for(const key of Object.values(ring.keys))key.fill(0);
    }
  };
}
