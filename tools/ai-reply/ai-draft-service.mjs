import http from 'node:http';
import {openSync,closeSync,fstatSync,readFileSync,chmodSync,rmSync,constants} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildReviewReplyPrompt,generateReviewReplyDraft,AI_REPLY_POLICY_VERSION} from '../../lib/ai/review-reply.js';

const SOCKET_PATH='/run/review-ai-draft/ai.sock',MAX_BODY=12288,MAX_PROVIDER_BODY=1048576;
const MODEL=/^[A-Za-z0-9._:\-]{2,120}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};

function credentialPath(env=process.env){
  const dir=env.CREDENTIALS_DIRECTORY;
  if(typeof dir!=='string'||!dir.startsWith('/run/credentials/'))fail('AI_NOT_CONFIGURED');
  return join(dir,'openai-api-key');
}
function loadApiKey(env=process.env){
  const fd=openSync(credentialPath(env),constants.O_RDONLY|constants.O_NOFOLLOW);
  let raw;
  try{
    const s=fstatSync(fd);
    if(!s.isFile()||s.uid!==0||s.gid!==0||s.nlink!==1||s.size<20||s.size>1024||(s.mode&0o777)!==0o440)
      fail('AI_NOT_CONFIGURED');
    raw=readFileSync(fd);
    const key=raw.toString('utf8').trim();
    if(key.length<20||key.length>900||/\s/.test(key)||!/^sk-[A-Za-z0-9_-]+$/.test(key))fail('AI_NOT_CONFIGURED');
    return key;
  }finally{if(raw)raw.fill(0);closeSync(fd);}
}
function contextHash(value){
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
      body:JSON.stringify({model,instructions:prompt.system,input:prompt.user,max_output_tokens:220})
    });
  }catch{fail('AI_PROVIDER_FAILED');}
  const text=await response.text();
  if(Buffer.byteLength(text,'utf8')>MAX_PROVIDER_BODY)fail('AI_PROVIDER_FAILED');
  let body;try{body=text?JSON.parse(text):null;}catch{fail('AI_PROVIDER_FAILED');}
  if(!response.ok)fail('AI_PROVIDER_FAILED');
  const output=extractOutputText(body);
  if(!output)fail('AI_PROVIDER_FAILED');
  return output;
}
function validateInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).sort().join()!=='authorName,locationName,provider,rating,reviewText')fail('AI_INPUT_INVALID');
  if(value.provider!=='yandex'||typeof value.reviewText!=='string'||value.reviewText.length>5000||
     (value.authorName!==null&&typeof value.authorName!=='string')||
     (value.locationName!==null&&typeof value.locationName!=='string'))fail('AI_INPUT_INVALID');
  return {rating:value.rating,reviewText:value.reviewText,authorName:value.authorName,locationName:value.locationName,provider:'yandex'};
}
async function readJson(req){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;if(size>MAX_BODY)fail('AI_INPUT_INVALID');chunks.push(chunk);
  }
  const raw=Buffer.concat(chunks);
  try{return JSON.parse(raw.toString('utf8'));}catch{fail('AI_INPUT_INVALID');}finally{raw.fill(0);}
}
function send(res,status,value){
  const body=JSON.stringify(value);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(body);
}

export function createAiDraftServer({env=process.env,fetchImpl=fetch,loadKey=loadApiKey}={}){
  const model=String(env.RA_AI_MODEL||'').trim();
  return http.createServer(async(req,res)=>{
    if(req.method==='GET'&&req.url==='/healthz')
      return send(res,200,{ok:true,service:'ai-draft',configured:Boolean(model)});
    if(req.method!=='POST'||req.url!=='/draft')return send(res,404,{ok:false,error:'NOT_FOUND'});
    let key='';
    try{
      if(!MODEL.test(model))fail('AI_NOT_CONFIGURED');
      const input=validateInput(await readJson(req));
      key=loadKey(env);
      const result=await generateReviewReplyDraft(input,async prompt=>callProvider(prompt,{key,model,fetchImpl}));
      return send(res,200,{ok:true,draft:result.draft,model,policy_version:result.policyVersion,context_hash:contextHash(input)});
    }catch(error){
      const code=['AI_NOT_CONFIGURED','AI_INPUT_INVALID'].includes(error?.code)?error.code:
        String(error?.code||'').startsWith('AI_REPLY_')?'AI_POLICY_REJECTED':'AI_PROVIDER_FAILED';
      return send(res,code==='AI_NOT_CONFIGURED'?503:code==='AI_INPUT_INVALID'?400:502,{ok:false,error:code});
    }finally{key='';}
  });
}

if(import.meta.url===`file://${process.argv[1]}`){
  const server=createAiDraftServer();
  try{rmSync(SOCKET_PATH,{force:true});}catch{}
  server.listen(SOCKET_PATH,()=>{chmodSync(SOCKET_PATH,0o660);process.stdout.write(JSON.stringify({ok:true,transport:'unix',service:'ai-draft'})+'\n');});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{try{rmSync(SOCKET_PATH,{force:true});}catch{}process.exit(0);}));
}
