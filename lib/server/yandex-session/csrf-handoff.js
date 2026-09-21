import {createHash,randomBytes,randomUUID} from 'node:crypto';
const ORG='54309413522';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code){throw Object.assign(new Error(code),{code});}
export function createCsrfHandoffChallenge({
  credentialVersion,sessionRevision,actionId=randomUUID(),now=Date.now(),
  ttlMs=60000,random=randomBytes
}={}){
  if(typeof credentialVersion!=='string'||!UUID.test(credentialVersion)||
     !Number.isSafeInteger(sessionRevision)||sessionRevision<1||
     typeof actionId!=='string'||!UUID.test(actionId)||
     !Number.isSafeInteger(now)||!Number.isSafeInteger(ttlMs)||ttlMs<10000||ttlMs>120000)
    fail('CSRF_HANDOFF_CONTEXT_INVALID');
  const nonce=random(32).toString('base64');
  if(!/^[A-Za-z0-9+/]{43}=$/.test(nonce))fail('CSRF_HANDOFF_CONTEXT_INVALID');
  const expiresAt=now+ttlMs;
  const sessionBinding=createHash('sha256').update(
    [ORG,credentialVersion,sessionRevision].join(':')
  ).digest('hex');
  return {
    public:Object.freeze({version:1,nonce,expiresAt}),
    private:{nonce,expiresAt,organizationId:ORG,credentialVersion,
      sessionRevision,sessionBinding,actionId:actionId.toLowerCase(),used:false}
  };
}
export function acceptCsrfHandoff(challenge,message,{now=Date.now()}={}){
  if(!challenge||typeof challenge!=='object'||challenge.used===true)
    fail('CSRF_HANDOFF_REPLAY');
  challenge.used=true;
  if(!message||typeof message!=='object'||Array.isArray(message)||
     Object.keys(message).sort().join()!=='nonce,op,organizationId,token,version'||
     message.version!==1||message.op!=='csrf_handoff'||
     message.nonce!==challenge.nonce||
     message.organizationId!==challenge.organizationId||
     !Number.isSafeInteger(now)||now>=challenge.expiresAt||
     typeof message.token!=='string'||message.token.length<8||message.token.length>1024||
     !/^[\x21-\x7e]+$/.test(message.token))
    fail('CSRF_HANDOFF_DENIED');
  return {
    token:message.token,
    organizationId:challenge.organizationId,
    credentialVersion:challenge.credentialVersion,
    sessionRevision:challenge.sessionRevision,
    sessionBinding:challenge.sessionBinding,
    actionId:challenge.actionId
  };
}
export function assertCsrfSessionBinding(challenge,stored){
  if(!challenge||!stored||stored.state!=='READY'||
     stored.credential_version!==challenge.credentialVersion||
     Number(stored.revision)!==challenge.sessionRevision)
    fail('CSRF_HANDOFF_SESSION_CHANGED');
  return true;
}
