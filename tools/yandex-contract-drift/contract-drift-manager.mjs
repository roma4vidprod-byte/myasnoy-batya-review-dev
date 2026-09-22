import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,renameSync,rmSync,chmodSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {userInfo} from 'node:os';
import {classifyContractDrift,sanitizeContractDriftEvidence} from '../../lib/server/yandex-contract-drift.js';

const OPS='/var/lib/review-activator-ops';
const OUT=OPS+'/YANDEX_CONTRACT_DRIFT_STAGE20.json';
const fail=code=>{throw Object.assign(new Error(code),{code});};

function unit(name){return 'review-yandex-stage20-'+name+'-'+process.pid+'.service';}
function cleanup(name){
  const u=unit(name);
  try{spawnSync('/usr/bin/systemctl',['stop',u],{stdio:'ignore',timeout:5000});}catch{}
  try{spawnSync('/usr/bin/systemctl',['reset-failed',u],{stdio:'ignore',timeout:5000});}catch{}
}
function common(name,runtime){
  return ['--quiet','--wait','--collect','--pipe','--service-type=exec','--unit='+unit(name),
    '--uid=review-yandex-browser','--gid=review-yandex-browser',
    '-p','NoNewPrivileges=yes','-p','ProtectSystem=strict','-p','ProtectHome=yes','-p','PrivateTmp=yes',
    '-p','PrivateDevices=yes','-p','CapabilityBoundingSet=','-p','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    '-p','LoadCredential=yandex-session-key:/etc/review-activator-yandex/session-key.json',
    '-p','RuntimeDirectory='+runtime,'-p','RuntimeDirectoryMode=0700',
    '-E','RA_RUNTIME_PROFILE=vps-lab','-E','RA_YANDEX_MODE=read-only-admin',
    '-E','RA_YANDEX_BROWSER_BIN=/usr/bin/google-chrome-stable'];
}
function runJson(args,name,timeoutMs=35000){
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/systemd-run',args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
    let out='',err='',done=false;
    const finish=(error,value)=>{
      if(done)return;done=true;clearTimeout(timer);out='';err='';
      error?reject(Object.assign(new Error(error),{code:error})):resolve(value);
    };
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish('CONTRACT_DRIFT_PROBE_TIMEOUT');},timeoutMs);
    child.stdout.on('data',b=>{out+=b.toString('utf8');if(Buffer.byteLength(out)>65536){try{child.kill('SIGKILL');}catch{}finish('CONTRACT_DRIFT_PROTOCOL_INVALID');}});
    child.stderr.on('data',b=>{if(err.length<4096)err+=b.toString('utf8');});
    child.on('error',()=>finish('CONTRACT_DRIFT_PROBE_FAILED'));
    child.on('close',()=>{
      if(done)return;
      const lines=out.trim().split(/\r?\n/).filter(Boolean);
      if(lines.length!==1)return finish('CONTRACT_DRIFT_PROTOCOL_INVALID');
      try{finish(null,JSON.parse(lines[0]));}catch{finish('CONTRACT_DRIFT_PROTOCOL_INVALID');}
    });
  });
}
async function runPage(){
  cleanup('page');
  const args=common('page','review-yandex-contract-drift');
  args.push('/opt/node/bin/node','/opt/review-activator-contract-drift/current/tools/yandex-contract-drift/browser-contract-probe.mjs');
  try{return await runJson(args,'page',35000);}finally{cleanup('page');}
}
async function runApi(){
  cleanup('api');
  const args=common('api','review-yandex-browser');
  args.push('/opt/node/bin/node','/opt/review-activator-yandex-browser/current/tools/yandex-server-browser/browser-once.mjs');
  try{return await runJson(args,'api',35000);}finally{cleanup('api');}
}
function apiEvidence(v){
  if(v?.ok===true&&v.operation==='server_browser_read'&&v.provider_writes===0){
    return {result:'PASS',error_code:null,session_revision:Number(v.session_revision),
      provider_requests:Number(v.provider_requests??0),provider_writes:0,
      page_items:Number(v.page_items),reported_total:Number.isFinite(v.reported_total)?Number(v.reported_total):null,
      list_csrf_present:v.list_csrf_present===true,
      business_answer_csrf_present_count:Number.isSafeInteger(v.business_answer_csrf_present_count)?v.business_answer_csrf_present_count:null};
  }
  return {result:'FAIL',error_code:typeof v?.error==='string'?v.error:'BROWSER_READ_FAILED',
    session_revision:0,provider_requests:Number.isSafeInteger(v?.provider_requests)?v.provider_requests:0,
    provider_writes:0,page_items:null,reported_total:null,list_csrf_present:false,
    business_answer_csrf_present_count:null};
}
function persist(value){
  mkdirSync(OPS,{recursive:true,mode:0o700});
  const tmp=OUT+'.tmp-'+process.pid;
  try{
    writeFileSync(tmp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600,flag:'w'});
    chmodSync(tmp,0o600);renameSync(tmp,OUT);
  }finally{try{rmSync(tmp,{force:true});}catch{}}
}

export async function runContractDriftManager({pageProbe=runPage,apiProbe=runApi,now=()=>new Date(),persistFn=persist}={}){
  const page=await pageProbe(),api=apiEvidence(await apiProbe());
  const evidence=sanitizeContractDriftEvidence({version:1,page,api});
  const diagnosis=classifyContractDrift(evidence);
  const result=Object.freeze({
    ok:true,operation:'yandex_contract_drift',evidence_version:1,evidence,diagnosis,
    observed_at:now().toISOString(),provider_writes:0,contract_change_authorized:false
  });
  persistFn(result);return result;
}
function isMainEntrypoint(metaUrl,argv1){
  if(typeof metaUrl!=='string'||typeof argv1!=='string'||!argv1)return false;
  try{return metaUrl===pathToFileURL(realpathSync(argv1)).href;}catch{return false;}
}
if(isMainEntrypoint(import.meta.url,process.argv[1])){
  try{
    if(process.argv.length!==2||process.platform!=='linux'||userInfo().username!=='root')
      fail('CONTRACT_DRIFT_RUNTIME_INVALID');
    const result=await runContractDriftManager();
    process.stdout.write(JSON.stringify({
      ok:true,operation:result.operation,classification:result.diagnosis.classification,
      action_id:result.diagnosis.action_id,reason_code:result.diagnosis.reason_code,
      provider_writes:0,contract_change_authorized:false})+'\n');
  }catch(error){
    process.stdout.write(JSON.stringify({ok:false,operation:'yandex_contract_drift',
      error:['CONTRACT_DRIFT_RUNTIME_INVALID','CONTRACT_DRIFT_PROBE_TIMEOUT','CONTRACT_DRIFT_PROBE_FAILED',
        'CONTRACT_DRIFT_PROTOCOL_INVALID','CONTRACT_DRIFT_EVIDENCE_INVALID',
        'CONTRACT_DRIFT_UNSAFE_EVIDENCE','CONTRACT_DRIFT_REVISION_MISMATCH'].includes(error?.code)
        ?error.code:'CONTRACT_DRIFT_FAILED',
      provider_writes:0,contract_change_authorized:false})+'\n');
    process.exitCode=1;
  }
}
