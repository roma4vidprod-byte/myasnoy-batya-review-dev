import {readFileSync,statSync,writeFileSync,renameSync,rmSync,chmodSync,existsSync,realpathSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {
  createOperatorTicket,acknowledgeOperatorTicket,verifyOperatorTicket,
  validateOperatorTicket,safeOperatorInstructions
} from '../../lib/server/yandex-operator-fallback.js';

const OPS='/var/lib/review-activator-ops';
const ESCALATION=OPS+'/YANDEX_OPERATOR_ESCALATION_STAGE18.json';
const TELEMETRY=OPS+'/YANDEX_AI_OPS_INPUT.json';
const TICKET=OPS+'/YANDEX_OPERATOR_FALLBACK_STAGE19.json';
const fail=code=>{throw Object.assign(new Error(code),{code});};

function readRootJson(path,{optional=false,max=65536}={}){
  if(!existsSync(path)){if(optional)return null;fail('OPERATOR_FALLBACK_INPUT_MISSING');}
  const s=statSync(path);
  if(!s.isFile()||s.uid!==0||s.gid!==0||(s.mode&0o077)!==0||s.size<2||s.size>max)
    fail('OPERATOR_FALLBACK_INPUT_INVALID');
  let raw;
  try{raw=readFileSync(path);return JSON.parse(raw.toString('utf8'));}
  catch{fail('OPERATOR_FALLBACK_INPUT_INVALID');}
  finally{if(raw)raw.fill(0);}
}
function atomicWrite(path,value){
  const tmp=path+'.tmp-'+process.pid;
  try{
    writeFileSync(tmp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600,flag:'w'});
    chmodSync(tmp,0o600);renameSync(tmp,path);
  }finally{try{rmSync(tmp,{force:true});}catch{}}
}
function runPsql(sql,{maxBytes=8192}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/sbin/runuser',['-u','postgres','--','/usr/lib/postgresql/17/bin/psql',
      '-XqAtw','-v','ON_ERROR_STOP=1','-d','review_activator_lab','-c',sql],{
      env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',PGCLIENTENCODING:'UTF8',PGAPPNAME:'stage19-operator-fallback'},
      stdio:['ignore','pipe','pipe']
    });
    let out='',err='',done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);out='';err='';error?reject(Object.assign(new Error(error),{code:error})):resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish('OPERATOR_FALLBACK_STATUS_FAILED');},10000);
    child.stdout.on('data',b=>{out+=b.toString('utf8');if(Buffer.byteLength(out)>maxBytes){child.kill('SIGKILL');finish('OPERATOR_FALLBACK_STATUS_FAILED');}});
    child.stderr.on('data',b=>{if(err.length<2048)err+=b.toString('utf8');});
    child.on('error',()=>finish('OPERATOR_FALLBACK_STATUS_FAILED'));
    child.on('close',code=>{
      if(code!==0)return finish('OPERATOR_FALLBACK_STATUS_FAILED');
      try{
        const value=JSON.parse(out.trim());
        if(!value||typeof value!=='object'||Array.isArray(value))return finish('OPERATOR_FALLBACK_STATUS_FAILED');
        finish(null,value);
      }catch{finish('OPERATOR_FALLBACK_STATUS_FAILED');}
    });
  });
}
export async function readSafeSessionStatus(){
  const sql=`select json_build_object('state',state,'revision',revision,'error_code',last_error_code)::text
from review_private.yandex_sessions
where company_id='13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
  and location_id='9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
  and external_org_id='54309413522';`;
  return await runPsql(sql);
}
async function readOneRequest(){
  const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
  const lines=[];let bytes=0;
  try{
    for await(const line of rl){bytes+=Buffer.byteLength(line);if(bytes>2048||lines.length>0)fail('OPERATOR_FALLBACK_REQUEST_INVALID');lines.push(line);}
  }finally{rl.close();}
  if(lines.length!==1)fail('OPERATOR_FALLBACK_REQUEST_INVALID');
  try{return JSON.parse(lines[0]);}catch{fail('OPERATOR_FALLBACK_REQUEST_INVALID');}
}

export async function runOperatorFallback(mode,{
  readJson=readRootJson,write=atomicWrite,readStatus=readSafeSessionStatus,now=Date.now
}={}){
  if(!['ingest','ack','verify','status'].includes(mode))fail('OPERATOR_FALLBACK_MODE_INVALID');
  const existing=readJson(TICKET,{optional:true});
  if(mode==='status'){
    if(!existing)return Object.freeze({ok:true,operation:'operator_fallback',state:'NO_TICKET'});
    return Object.freeze({ok:true,operation:'operator_fallback',...safeOperatorInstructions(existing)});
  }
  if(mode==='ack'){
    if(!existing)fail('OPERATOR_FALLBACK_TICKET_MISSING');
    const request=await readOneRequest();
    const next=acknowledgeOperatorTicket(existing,request,{nowMs:now()});
    write(TICKET,next);
    return Object.freeze({ok:true,operation:'operator_fallback',...safeOperatorInstructions(next)});
  }
  if(mode==='verify'){
    if(!existing)fail('OPERATOR_FALLBACK_TICKET_MISSING');
    const next=verifyOperatorTicket(existing,await readStatus(),{nowMs:now()});
    write(TICKET,next);
    return Object.freeze({ok:true,operation:'operator_fallback',...safeOperatorInstructions(next)});
  }

  // Scheduled ingest may verify an already acknowledged ticket, but never acknowledges it.
  if(existing){
    const valid=validateOperatorTicket(existing);
    if(['OPERATOR_CONFIRMED','VERIFYING'].includes(valid.state)){
      const next=verifyOperatorTicket(valid,await readStatus(),{nowMs:now()});
      write(TICKET,next);
      return Object.freeze({ok:true,operation:'operator_fallback',...safeOperatorInstructions(next)});
    }
    if(['ACTION_REQUIRED','RESOLVED','FAILED','EXPIRED'].includes(valid.state)){
      const escalation=readJson(ESCALATION,{optional:true});
      if(!escalation||escalation.source_recovery_id===valid.source_recovery_id||escalation.recovery_id===valid.source_recovery_id)
        return Object.freeze({ok:true,operation:'operator_fallback',...safeOperatorInstructions(valid)});
    }
  }

  const escalation=readJson(ESCALATION,{optional:true});
  if(!escalation)return Object.freeze({ok:true,operation:'operator_fallback',state:'NO_ACTION'});
  const telemetry=readJson(TELEMETRY);
  const ticket=createOperatorTicket({escalation,telemetry,nowMs:now()});
  write(TICKET,ticket);
  return Object.freeze({ok:true,operation:'operator_fallback',...safeOperatorInstructions(ticket)});
}

function isMainEntrypoint(metaUrl,argv1){
  if(typeof metaUrl!=='string'||typeof argv1!=='string'||!argv1)return false;
  try{return metaUrl===pathToFileURL(realpathSync(argv1)).href;}catch{return false;}
}
const SAFE_ERRORS=new Set([
  'OPERATOR_FALLBACK_INPUT_MISSING','OPERATOR_FALLBACK_INPUT_INVALID','OPERATOR_FALLBACK_ESCALATION_INVALID',
  'OPERATOR_FALLBACK_ESCALATION_UNSUPPORTED','OPERATOR_FALLBACK_TICKET_INVALID','OPERATOR_FALLBACK_ACK_INVALID',
  'OPERATOR_FALLBACK_STATE_INVALID','OPERATOR_FALLBACK_STATUS_INVALID','OPERATOR_FALLBACK_STATUS_FAILED',
  'OPERATOR_FALLBACK_REQUEST_INVALID','OPERATOR_FALLBACK_MODE_INVALID','OPERATOR_FALLBACK_TICKET_MISSING'
]);
if(isMainEntrypoint(import.meta.url,process.argv[1])){
  try{
    if(process.argv.length!==2||process.platform!=='linux'||userInfo().username!=='root')
      fail('OPERATOR_FALLBACK_MODE_INVALID');
    const mode=process.env.RA_STAGE19_MODE||'ingest';
    const result=await runOperatorFallback(mode);
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){
    process.stdout.write(JSON.stringify({ok:false,operation:'operator_fallback',
      state:'BLOCKED',error:SAFE_ERRORS.has(error?.code)?error.code:'OPERATOR_FALLBACK_FAILED',
      provider_writes:0,operator_secret_input_allowed:false})+'\n');
    process.exitCode=1;
  }
}
