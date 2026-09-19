// The Native Messaging source is plaintext only in memory. The SSH admin CLI
// supplies an already-authenticated pipe and a fresh, single-use challenge.
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fail,encryptSession,validateSessionClassified} from './crypto.js';
import {assertContextScope,VPS_SESSION_SCOPE} from './profile-context.js';

export function prepareVpsImport({context,keyring,store,expectedRevision,now=Date.now}) {
  assertContextScope(context,VPS_SESSION_SCOPE);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('SESSION_REVISION_REQUIRED');
  const nonce=randomBytes(32),expiresAt=now()+120000;
  let used=false;
  return {
    challenge: Object.freeze({nonce:nonce.toString('base64'),expiresAt,expectedRevision}),
    async submit(message) {
      if(used)fail('SESSION_IMPORT_REPLAY');
      used=true;
      let material;
      try {
        if(now()>=expiresAt)fail('SESSION_IMPORT_EXPIRED');
        if(!message||Object.keys(message).sort().join()!=='nonce,session'||
          typeof message.nonce!=='string'||! /^[A-Za-z0-9+/]{43}=$/.test(message.nonce)||
          !timingSafeEqual(nonce,Buffer.from(message.nonce,'base64')))fail('SESSION_IMPORT_DENIED');
        material=validateSessionClassified(message.session,now());
        const encrypted=encryptSession(VPS_SESSION_SCOPE,material,keyring,now(),context);
        const result=await store.replace(VPS_SESSION_SCOPE,expectedRevision,encrypted);
        if(result?.state!=='NOT_CONFIGURED'||Number(result.revision)!==expectedRevision+1)fail('SESSION_IMPORT_NOT_CONFIRMED');
        return {ok:true,state:'NOT_CONFIGURED',revision:Number(result.revision)};
      } finally {
        nonce.fill(0);
        for(const value of [material,message?.session])if(Array.isArray(value?.cookies))for(const c of value.cookies)if(c&&typeof c==='object')c.value='';
      }
    },
    cancel(){used=true;nonce.fill(0);}
  };
}
