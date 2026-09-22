import http from 'node:http';
import {openSync,closeSync,fstatSync,readFileSync,chmodSync,rmSync,constants,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {diagnoseContractDrift} from '../../lib/ai/yandex-contract-drift.js';
import {sanitizeContractDriftEvidence} from '../../lib/server/yandex-contract-drift.js';

const SOCKET='/run/review-ai-contract-drift/drift.sock';
const MAX_BODY=16384,MAX_PROVIDER=1048576;
const MODEL=/^[A-Za-z0-9._:\-]{2,120}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};

function credentialPath(env){
  const dir=env.CREDENTIALS_DIRECTORY;
  if(typeof dir!=='string'||!dir.startsWith('/run/credentials/'))fail('AI_CONTRACT_DRIFT_NOT_CONFIGURED');
  return join(dir,'openai-api-key');
}
function loadKey(env){
  const fd=openSync(credentialPath(env),constants.O_RDONLY|constants.O_NOFOLLOW);let raw;
  try{
    const s=fstatSync(fd);
    if(!s.isFile()||s.uid!==0||s.gid!==0||s.nlink!==1||s.size<20||s.size>1024||(s.mode&0o777)!==0o440)
      fail('AI_CONTRACT_DRIFT_NOT_CONFIGURED');
    raw=readFileSync(fd);const key=raw.toString('utf8').trim();
    if(!/^sk-[A-Za-z0-9_-]{20,900}$/.test(key))fail('AI_CONTRACT_DRIFT_NOT_CONFIGURED');
    return key;
  }finally{if(raw)raw.fill(0);closeSync(fd);}
}
function outputText(data){
  if(typeof data?.output_text==='string')return data.output_text.trim();
  for(const item of data?.output||[])for(const part of item?.content||[])
    if(part?.type==='output_text'&&part.text)return String(part.text).trim();
  return '';
}
async function provider(prompt,{key,model,fetchImpl=fetch}={}){
  let response;
  try{
    response=await fetchImpl('https://api.openai.com/v1/responses',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model,instructions:prompt.system,input:prompt.user,max_output_tokens:180})
    });
  }catch{fail('AI_CONTRACT_DRIFT_PROVIDER_FAILED');}
  const text=await response.text();
  if(Buffer.byteLength(text,'utf8')>MAX_PROVIDER)fail('AI_CONTRACT_DRIFT_PROVIDER_FAILED');
  let body;try{body=text?JSON.parse(text):null;}catch{fail('AI_CONTRACT_DRIFT_PROVIDER_FAILED');}
  if(!response.ok)fail('AI_CONTRACT_DRIFT_PROVIDER_FAILED');
  const out=outputText(body);if(!out)fail('AI_CONTRACT_DRIFT_PROVIDER_FAILED');return out;
}
async function readJson(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)fail('CONTRACT_DRIFT_EVIDENCE_INVALID');chunks.push(chunk);}
  const raw=Buffer.concat(chunks);
  try{return sanitizeContractDriftEvidence(JSON.parse(raw.toString('utf8')));}
  catch(error){if(error?.code)throw error;fail('CONTRACT_DRIFT_EVIDENCE_INVALID');}
  finally{raw.fill(0);}
}
function send(res,status,value){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'});res.end(JSON.stringify(value));
}
export function createDriftAiServer({env=process.env,fetchImpl=fetch,keyLoader=loadKey}={}){
  const model=String(env.RA_AI_OPS_MODEL||'').trim();
  return http.createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/healthz')return send(res,200,{ok:true,configured:MODEL.test(model)});
    if(req.method!=='POST'||req.url!=='/diagnose')return send(res,404,{ok:false,error:'NOT_FOUND'});
    let key='';
    try{
      if(!MODEL.test(model))fail('AI_CONTRACT_DRIFT_NOT_CONFIGURED');
      const evidence=await readJson(req);key=keyLoader(env);
      const result=await diagnoseContractDrift(evidence,prompt=>provider(prompt,{key,model,fetchImpl}));
      return send(res,200,{ok:true,...result,model});
    }catch(error){
      const code=error?.code==='AI_CONTRACT_DRIFT_NOT_CONFIGURED'?'AI_CONTRACT_DRIFT_NOT_CONFIGURED':
        error?.code==='CONTRACT_DRIFT_EVIDENCE_INVALID'?'CONTRACT_DRIFT_EVIDENCE_INVALID':
        error?.code==='AI_CONTRACT_DRIFT_OUTPUT_INVALID'?'AI_CONTRACT_DRIFT_POLICY_REJECTED':
        'AI_CONTRACT_DRIFT_PROVIDER_FAILED';
      return send(res,code==='AI_CONTRACT_DRIFT_NOT_CONFIGURED'?503:code==='CONTRACT_DRIFT_EVIDENCE_INVALID'?400:502,
        {ok:false,error:code,contract_change_authorized:false,provider_write_authorized:false});
    }finally{key='';}
  });
}
function isMain(meta,argv1){try{return meta===pathToFileURL(realpathSync(argv1)).href;}catch{return false;}}
if(isMain(import.meta.url,process.argv[1])){
  const server=createDriftAiServer();try{rmSync(SOCKET,{force:true});}catch{}
  server.listen(SOCKET,()=>{chmodSync(SOCKET,0o660);process.stdout.write('{"ok":true,"service":"ai-contract-drift"}\n');});
  for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>server.close(()=>{try{rmSync(SOCKET,{force:true});}catch{}process.exit(0);}));
}
