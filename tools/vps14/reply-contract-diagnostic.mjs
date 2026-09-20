import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {userInfo} from 'node:os';
import {createVpsSessionContext,VPS_SESSION_SCOPE as scope} from '../../lib/server/yandex-session/profile-context.js';
import {decryptSessionClassified,fail} from '../../lib/server/yandex-session/crypto.js';
import {createSessionStore} from '../../lib/server/yandex-session/store.js';
import {createYandexReadTransport} from '../../lib/server/yandex-session/transport.js';
import {safeSchemaRule} from '../../lib/server/yandex-session/preflight.js';
import {createVpsRpc} from '../vps08a/pg.mjs';

const ORG='54309413522';
const REVIEWS_URL=`https://yandex.ru/sprav/api/${ORG}/reviews?ranking=by_time&source=pagination&page=1`;
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const type=value=>value===null?'null':Array.isArray(value)?'array':typeof value;

function loadKeyring(){
  const fd=openSync('/etc/review-activator-yandex/session-key.json',constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const s=fstatSync(fd);
    if(!s.isFile()||s.uid!==0||s.gid!==process.getgid()||(s.mode&0o777)!==0o640||s.nlink!==1||s.size>1024)
      fail('SESSION_KEY_NOT_CONFIGURED');
    const raw=readFileSync(fd);
    try{
      const value=JSON.parse(raw.toString('utf8'));
      if(Object.keys(value).sort().join()!=='key,kid'||!/^vps-yandex-[a-f0-9]{16}$/.test(value.kid))
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
  const rpc=createVpsRpc();
  const store=createSessionStore({rpc,context});
  ring=loadKeyring();

  const row=await store.read(scope);
  if(!row||row.state!=='READY')fail('SESSION_NOT_READY');
  session=decryptSessionClassified(scope,row,ring,Date.now(),context);

  let attempted=0;
  const read=createYandexReadTransport({
    scope,session,allowRead:true,context,
    fetchImpl:async(...args)=>{attempted+=1;return fetch(...args);}
  });

  const payload=await read({
    method:'GET',
    permanentId:ORG,
    page:1,
    url:REVIEWS_URL
  });

  const list=payload?.list;
  if(!list||typeof list!=='object'||!Array.isArray(list.items))
    fail('YANDEX_CONTRACT_DRIFT');

  const answerTokenTypes={};
  const privacyTypes={};
  let answerTokenPresent=0;
  let privacyPresent=0;
  let unanswered=0;
  let reviewIdsPresent=0;

  for(const item of list.items){
    const answerType=type(item?.business_answer_csrf_token);
    answerTokenTypes[answerType]=(answerTokenTypes[answerType]||0)+1;
    if(answerType==='string'&&item.business_answer_csrf_token.length>0)answerTokenPresent+=1;

    const privacyType=type(item?.author?.privacy);
    privacyTypes[privacyType]=(privacyTypes[privacyType]||0)+1;
    if(privacyType==='string'&&item.author.privacy.length>0)privacyPresent+=1;

    if(typeof item?.id==='string'&&item.id.length>0)reviewIdsPresent+=1;
    if(item?.owner_comment==null)unanswered+=1;
  }

  emit({
    ok:true,
    operation:'reply_contract_diagnostic',
    provider_requests:attempted,
    provider_writes:0,
    answer_endpoint_called:false,
    item_count:list.items.length,
    list_csrf_type:type(list.csrf_token),
    list_csrf_present:typeof list.csrf_token==='string'&&list.csrf_token.length>0,
    business_answer_token_present:answerTokenPresent,
    business_answer_token_types:answerTokenTypes,
    author_privacy_present:privacyPresent,
    author_privacy_types:privacyTypes,
    review_ids_present:reviewIdsPresent,
    unanswered
  });
}catch(error){
  emit({
    ok:false,
    operation:'reply_contract_diagnostic',
    error:error?.code||'VPS14_DIAGNOSTIC_FAILED',
    schema_rule:error?.code==='SESSION_PLAINTEXT_SCHEMA_INVALID'?safeSchemaRule(error):null,
    provider_writes:0,
    answer_endpoint_called:false
  });
  process.exitCode=1;
}finally{
  if(session?.cookies)for(const cookie of session.cookies)if(cookie)cookie.value='';
  if(ring)for(const key of Object.values(ring.keys))key.fill(0);
}
