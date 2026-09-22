import http from 'node:http';
import {readFileSync,statSync,writeFileSync,renameSync,rmSync,chmodSync} from 'node:fs';
import {sanitizeContractDriftEvidence} from '../../lib/server/yandex-contract-drift.js';

const IN='/var/lib/review-activator-ops/YANDEX_CONTRACT_DRIFT_STAGE20.json';
const OUT='/var/lib/review-activator-ops/YANDEX_CONTRACT_DRIFT_AI_STAGE20.json';
const SOCKET='/run/review-ai-contract-drift/drift.sock';
const fail=code=>{throw Object.assign(new Error(code),{code});};

function readEvidence(){
  const s=statSync(IN);
  if(!s.isFile()||s.uid!==0||s.gid!==0||(s.mode&0o077)!==0||s.size<2||s.size>65536)
    fail('AI_CONTRACT_DRIFT_INPUT_INVALID');
  let raw;
  try{
    raw=readFileSync(IN);
    const v=JSON.parse(raw.toString('utf8'));
    return sanitizeContractDriftEvidence(v.evidence);
  }catch(error){if(error?.code)throw error;fail('AI_CONTRACT_DRIFT_INPUT_INVALID');}
  finally{if(raw)raw.fill(0);}
}
function callService(evidence){
  const body=JSON.stringify(evidence);
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath:SOCKET,path:'/diagnose',method:'POST',
      headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
      const chunks=[];let size=0;
      res.on('data',c=>{size+=c.length;if(size>32768){req.destroy();reject(Object.assign(new Error('AI_CONTRACT_DRIFT_PROTOCOL_INVALID'),{code:'AI_CONTRACT_DRIFT_PROTOCOL_INVALID'}));}else chunks.push(c);});
      res.on('end',()=>{
        try{const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));resolve({status:res.statusCode,value:v});}
        catch{reject(Object.assign(new Error('AI_CONTRACT_DRIFT_PROTOCOL_INVALID'),{code:'AI_CONTRACT_DRIFT_PROTOCOL_INVALID'}));}
      });
    });
    req.setTimeout(25000,()=>req.destroy(Object.assign(new Error('AI_CONTRACT_DRIFT_TIMEOUT'),{code:'AI_CONTRACT_DRIFT_TIMEOUT'})));
    req.on('error',error=>reject(Object.assign(new Error(['ENOENT','ECONNREFUSED'].includes(error?.code)?'AI_CONTRACT_DRIFT_NOT_CONFIGURED':'AI_CONTRACT_DRIFT_SERVICE_FAILED'),
      {code:['ENOENT','ECONNREFUSED'].includes(error?.code)?'AI_CONTRACT_DRIFT_NOT_CONFIGURED':'AI_CONTRACT_DRIFT_SERVICE_FAILED'})));
    req.end(body);
  });
}
function persist(value){
  const tmp=OUT+'.tmp-'+process.pid;
  try{
    writeFileSync(tmp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600,flag:'w'});
    chmodSync(tmp,0o600);renameSync(tmp,OUT);
  }finally{try{rmSync(tmp,{force:true});}catch{}}
}
async function main(){
  const evidence=readEvidence();
  try{
    const response=await callService(evidence);
    if(response.status===200&&response.value?.ok===true){
      const v=response.value;
      if(v.contract_change_authorized!==false||v.provider_write_authorized!==false||
         v.endpoint_change_authorized!==false||v.selector_change_authorized!==false)
        fail('AI_CONTRACT_DRIFT_PROTOCOL_INVALID');
      const out={ok:true,state:'AI_DIAGNOSED',classification:v.classification,action_id:v.action_id,
        reason_code:v.reason_code,summary_code:v.summary_code,confidence:v.confidence,
        contract_change_authorized:false,provider_write_authorized:false,
        endpoint_change_authorized:false,selector_change_authorized:false};
      persist(out);process.stdout.write(JSON.stringify(out)+'\n');return;
    }
    if(response.status===503&&response.value?.error==='AI_CONTRACT_DRIFT_NOT_CONFIGURED')
      throw Object.assign(new Error('AI_CONTRACT_DRIFT_NOT_CONFIGURED'),{code:'AI_CONTRACT_DRIFT_NOT_CONFIGURED'});
    fail('AI_CONTRACT_DRIFT_SERVICE_FAILED');
  }catch(error){
    const code=['AI_CONTRACT_DRIFT_NOT_CONFIGURED','AI_CONTRACT_DRIFT_TIMEOUT','AI_CONTRACT_DRIFT_SERVICE_FAILED',
      'AI_CONTRACT_DRIFT_PROTOCOL_INVALID','AI_CONTRACT_DRIFT_INPUT_INVALID'].includes(error?.code)
      ?error.code:'AI_CONTRACT_DRIFT_FAILED';
    const out={ok:false,state:'AI_NOT_CONFIGURED',error:code,
      contract_change_authorized:false,provider_write_authorized:false,
      endpoint_change_authorized:false,selector_change_authorized:false};
    persist(out);process.stdout.write(JSON.stringify(out)+'\n');
    if(code!=='AI_CONTRACT_DRIFT_NOT_CONFIGURED')process.exitCode=1;
  }
}
main();
