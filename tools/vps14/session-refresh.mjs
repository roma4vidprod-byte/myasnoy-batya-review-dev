// One-shot VDSina browser-session refresh. No provider request and no retry loop.
import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {userInfo} from 'node:os';
import {
  createVpsSessionContext,VPS_SESSION_SCOPE as scope
} from '../../lib/server/yandex-session/profile-context.js';
import {fail} from '../../lib/server/yandex-session/crypto.js';
import {createSessionStore} from '../../lib/server/yandex-session/store.js';
import {prepareVpsImport} from '../../lib/server/yandex-session/vps-import.js';
import {createVpsRpc} from '../vps08a/pg.mjs';

const EXPECTED_REVISION=4;
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');

function keyring(){
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

let ring,importer;
try{
  if(process.argv.length!==2)fail('SESSION_MODE_INVALID');
  if(userInfo().username!=='review-yandex-import')fail('SESSION_ROLE_DENIED');

  const context=createVpsSessionContext();
  const rpc=createVpsRpc();
  const store=createSessionStore({rpc,context});
  const before=await rpc('review_yandex_session_store',{
    p_company_id:scope.companyId,p_location_id:scope.locationId,
    p_org_id:scope.organizationId,p_action:'status',
    p_expected_revision:null,p_data:{}
  });

  if(!before||before.state!=='READY'||
     Number(before.revision)!==EXPECTED_REVISION||
     before.last_error_code!==null)
    fail('SESSION_CHANGED');

  ring=keyring();
  importer=prepareVpsImport({
    context,keyring:ring,store,expectedRevision:EXPECTED_REVISION
  });
  emit({
    ok:true,
    operation:'refresh_prepare',
    ...importer.challenge
  });

  const chunks=[];
  let size=0;
  const timer=setTimeout(
    ()=>process.stdin.destroy(Error('SESSION_IMPORT_EXPIRED')),120000
  );
  try{
    for await(const chunk of process.stdin){
      size+=chunk.length;
      if(size>65002){
        chunk.fill(0);
        fail('SESSION_INPUT_INVALID');
      }
      chunks.push(chunk);
    }
    const bytes=Buffer.concat(chunks);
    try{
      const message=JSON.parse(bytes.toString('utf8'));
      const result=await importer.submit(message);
      if(result.revision!==EXPECTED_REVISION+1||
         result.state!=='NOT_CONFIGURED')
        fail('SESSION_IMPORT_NOT_CONFIRMED');
      emit({
        ok:true,
        operation:'refresh',
        state:'NOT_CONFIGURED',
        revision:result.revision,
        provider_requests:0,
        provider_writes:0
      });
    }finally{bytes.fill(0);}
  }finally{
    clearTimeout(timer);
    for(const chunk of chunks)chunk.fill(0);
    process.stdin.destroy();
  }
}catch(error){
  emit({
    ok:false,
    operation:'refresh',
    error:[
      'SESSION_CHANGED','SESSION_IMPORT_EXPIRED','SESSION_IMPORT_REPLAY',
      'SESSION_IMPORT_DENIED','SESSION_IMPORT_NOT_CONFIRMED',
      'SESSION_PLAINTEXT_SCHEMA_INVALID','SESSION_KEY_NOT_CONFIGURED'
    ].includes(error?.code)?error.code:'SESSION_REFRESH_FAILED',
    provider_requests:0,
    provider_writes:0
  });
  process.exitCode=1;
}finally{
  importer?.cancel();
  if(ring)for(const key of Object.values(ring.keys))key.fill(0);
}
