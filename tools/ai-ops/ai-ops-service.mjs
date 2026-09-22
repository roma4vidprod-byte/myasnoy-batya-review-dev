import http from 'node:http';
import {openSync,closeSync,fstatSync,readFileSync,chmodSync,rmSync,constants,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {classifyYandexOps,sanitizeOpsTelemetry,AI_YANDEX_OPS_POLICY_VERSION} from '../../lib/ai/yandex-ops.js';

const SOCKET_PATH='/run/review-ai-ops/ops.sock';
const MAX_BODY=16384,MAX_PROVIDER_BODY=1048576;
const MODEL=/^[A-Za-z0-9._:\-]{2,120}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};

function credentialPath(env=process.env){
  const dir=env.CREDENTIALS_DIRECTORY;
  if(typeof dir!=='string'||!dir.startsWith('/run/credentials/'))fail('AI_OPS_NOT_CONFIGURED');
  return join(dir,'openai-api-key');
}
function loadApiKey(env=process.env){
  const fd=openSync(credentialPath(env),constants.O_RDONLY|constants.O_NOFOLLOW);
  let raw;
  try{
    const s=fstatSync(fd);
    if(!s.isFile()||s.uid!==0||s.gid!==0||s.nlink!==1||s.size<20||s.size>1024||(s.mode&0o777)!==0o440)
      fail('AI_OPS_NOT_CONFIGURED');
    raw=readFileSync(fd);
    const key=raw.toString('utf8').trim();
    if(key.length<20||key.length>900||/\s/.test(key)||!/^sk-[A-Za-z0-9_-]+$/.test(key))
      fail('AI_OPS_NOT_CONFIGURED');
    return key;
  }finally{if(raw)raw.fill(0);closeSync(fd);}
}
function extractOutputText(data){
  if(typeof data?.output_text==='string')return data.output_text.trim();
  for(const item of data?.output||[])for(const part of item?.content||[])
    if(part?.type==='output_text'&&part.text)return String(part.text).trim();
  return '';
}
async function callProvider(prompt,{key,model,fetchImpl=fetch}={}){
  let response;
  try{
    response=await fetchImpl('https://api.openai.com/v1/responses',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,instructions:prompt.system,input:prompt.user,max_output_tokens:180})
    });
  }catch{fail('AI_OPS_PROVIDER_FAILED');}
  const text=await response.text();
  if(Buffer.byteLength(text,'utf8')>MAX_PROVIDER_BODY)fail('AI_OPS_PROVIDER_FAILED');
  let body;try{body=text?JSON.parse(text):null;}catch{fail('AI_OPS_PROVIDER_FAILED');}
  if(!response.ok)fail('AI_OPS_PROVIDER_FAILED');
  const output=extractOutputText(body);
  if(!output)fail('AI_OPS_PROVIDER_FAILED');
  return output;
}
async function readJson(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)fail('AI_OPS_INPUT_INVALID');chunks.push(chunk);}
  const raw=Buffer.concat(chunks);
  try{return sanitizeOpsTelemetry(JSON.parse(raw.toString('utf8')));}
  catch(error){if(error?.code==='AI_OPS_INPUT_INVALID')throw error;fail('AI_OPS_INPUT_INVALID');}
  finally{raw.fill(0);}
}
function send(res,status,value){
  const body=JSON.stringify(value);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'});
  res.end(body);
}
function telemetryHash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

export function createAiOpsServer({env=process.env,fetchImpl=fetch,loadKey=loadApiKey}={}){
  const model=String(env.RA_AI_OPS_MODEL||'').trim();
  return http.createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/healthz')
      return send(res,200,{ok:true,service:'ai-ops',configured:Boolean(MODEL.test(model)),
        policy_version:AI_YANDEX_OPS_POLICY_VERSION});
    if(req.method!=='POST'||req.url!=='/classify')return send(res,404,{ok:false,error:'NOT_FOUND'});
    let key='';
    try{
      if(!MODEL.test(model))fail('AI_OPS_NOT_CONFIGURED');
      const telemetry=await readJson(req);
      key=loadKey(env);
      const result=await classifyYandexOps(telemetry,prompt=>callProvider(prompt,{key,model,fetchImpl}));
      return send(res,200,{ok:true,...result,model,telemetry_hash:telemetryHash(telemetry)});
    }catch(error){
      const code=error?.code==='AI_OPS_NOT_CONFIGURED'?'AI_OPS_NOT_CONFIGURED':
        error?.code==='AI_OPS_INPUT_INVALID'?'AI_OPS_INPUT_INVALID':
        error?.code==='AI_OPS_OUTPUT_INVALID'?'AI_OPS_POLICY_REJECTED':'AI_OPS_PROVIDER_FAILED';
      return send(res,code==='AI_OPS_NOT_CONFIGURED'?503:code==='AI_OPS_INPUT_INVALID'?400:502,
        {ok:false,error:code,execution_authorized:false,provider_write_authorized:false});
    }finally{key='';}
  });
}

function isMainEntrypoint(metaUrl,argv1){
  if(typeof metaUrl!=='string'||typeof argv1!=='string'||!argv1)return false;
  try{return metaUrl===pathToFileURL(realpathSync(argv1)).href;}catch{return false;}
}
if(isMainEntrypoint(import.meta.url,process.argv[1])){
  const server=createAiOpsServer();
  try{rmSync(SOCKET_PATH,{force:true});}catch{}
  server.listen(SOCKET_PATH,()=>{
    chmodSync(SOCKET_PATH,0o660);
    process.stdout.write(JSON.stringify({ok:true,transport:'unix',service:'ai-ops',
      policy_version:AI_YANDEX_OPS_POLICY_VERSION})+'\n');
  });
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{
    try{rmSync(SOCKET_PATH,{force:true});}catch{}process.exit(0);
  }));
}
