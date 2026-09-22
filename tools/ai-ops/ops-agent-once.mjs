import http from 'node:http';
import {readFileSync,statSync,mkdirSync,writeFileSync,renameSync,rmSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {userInfo} from 'node:os';
import {sanitizeOpsTelemetry,PLAYBOOKS,CLASSIFICATIONS,AI_YANDEX_OPS_POLICY_VERSION} from '../../lib/ai/yandex-ops.js';

const INPUT='/var/lib/review-activator-ops/YANDEX_AI_OPS_INPUT.json';
const OUTPUT='/var/lib/review-activator-ops/YANDEX_AI_OPS_DECISION.json';
const SOCKET='/run/review-ai-ops/ops.sock';
const fail=code=>{throw Object.assign(new Error(code),{code});};

function readInput(){
  const s=statSync(INPUT);
  if(!s.isFile()||s.uid!==0||s.gid!==0||(s.mode&0o077)!==0||s.size<2||s.size>32768)
    fail('AI_OPS_INPUT_INVALID');
  let raw;
  try{raw=readFileSync(INPUT);return sanitizeOpsTelemetry(JSON.parse(raw.toString('utf8')));}
  catch(error){if(error?.code==='AI_OPS_INPUT_INVALID')throw error;fail('AI_OPS_INPUT_INVALID');}
  finally{if(raw)raw.fill(0);}
}
function callService(telemetry){
  const body=JSON.stringify(telemetry);
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath:SOCKET,path:'/classify',method:'POST',
      headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>32768){req.destroy();return reject(Object.assign(new Error('AI_OPS_PROTOCOL_INVALID'),{code:'AI_OPS_PROTOCOL_INVALID'}));}chunks.push(chunk);});
      res.on('end',()=>{
        const raw=Buffer.concat(chunks);
        try{
          const value=JSON.parse(raw.toString('utf8'));
          if(res.statusCode!==200)return reject(Object.assign(new Error(value?.error||'AI_OPS_SERVICE_FAILED'),{code:value?.error||'AI_OPS_SERVICE_FAILED'}));
          resolve(value);
        }catch(error){reject(Object.assign(new Error(error?.code||'AI_OPS_PROTOCOL_INVALID'),{code:error?.code||'AI_OPS_PROTOCOL_INVALID'}));}
        finally{raw.fill(0);}
      });
    });
    req.setTimeout(25000,()=>req.destroy(Object.assign(new Error('AI_OPS_TIMEOUT'),{code:'AI_OPS_TIMEOUT'})));
    req.on('error',error=>reject(Object.assign(new Error(error?.code==='ENOENT'||error?.code==='ECONNREFUSED'?'AI_OPS_NOT_CONFIGURED':'AI_OPS_SERVICE_FAILED'),
      {code:error?.code==='ENOENT'||error?.code==='ECONNREFUSED'?'AI_OPS_NOT_CONFIGURED':'AI_OPS_SERVICE_FAILED'})));
    req.end(body);
  });
}
function validateDecision(value){
  if(value?.ok!==true||value.policy_version!==AI_YANDEX_OPS_POLICY_VERSION||
     !Object.prototype.hasOwnProperty.call(CLASSIFICATIONS,value.classification)||
     !Object.prototype.hasOwnProperty.call(PLAYBOOKS,value.playbook_id)||
     !CLASSIFICATIONS[value.classification].includes(value.playbook_id)||
     value.execution_authorized!==false||value.provider_write_authorized!==false||
     typeof value.telemetry_hash!=='string'||!/^[0-9a-f]{64}$/.test(value.telemetry_hash))
    fail('AI_OPS_DECISION_INVALID');
  return Object.freeze({
    ok:true,operation:'ai_yandex_ops_decision',policy_version:value.policy_version,
    classification:value.classification,playbook_id:value.playbook_id,reason_code:value.reason_code,
    confidence:value.confidence,telemetry_hash:value.telemetry_hash,
    execution_authorized:false,provider_write_authorized:false
  });
}
function persist(value){
  mkdirSync(dirname(OUTPUT),{recursive:true,mode:0o700});
  const tmp=OUTPUT+'.tmp-'+process.pid;
  try{
    writeFileSync(tmp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600,flag:'w'});
    chmodSync(tmp,0o600);renameSync(tmp,OUTPUT);
  }finally{try{rmSync(tmp,{force:true});}catch{}}
}
async function main(){
  if(process.platform!=='linux'||userInfo().username!=='root'||process.argv.length!==2)
    fail('AI_OPS_RUNTIME_INVALID');
  const telemetry=readInput();
  const decision=validateDecision(await callService(telemetry));
  persist(decision);
  process.stdout.write(JSON.stringify(decision)+'\n');
}
main().catch(error=>{
  const code=['AI_OPS_NOT_CONFIGURED','AI_OPS_INPUT_INVALID','AI_OPS_TIMEOUT',
    'AI_OPS_SERVICE_FAILED','AI_OPS_DECISION_INVALID','AI_OPS_RUNTIME_INVALID'].includes(error?.code)
    ?error.code:'AI_OPS_FAILED';
  process.stdout.write(JSON.stringify({ok:false,operation:'ai_yandex_ops_decision',error:code,
    execution_authorized:false,provider_write_authorized:false})+'\n');
  process.exitCode=1;
});
