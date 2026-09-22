import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {userInfo} from 'node:os';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;
const WRITER_UNIT=`review-yandex-stage15-writer-${process.pid}.service`;
const BROWSER_UNIT=`review-yandex-stage15-browser-${process.pid}.service`;
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function validateOrchestratorRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1)
    fail('SERVER_REPLY_REQUEST_INVALID');
  if(value.mode==='readiness'){
    if(Object.keys(value).sort().join()!=='mode,version')fail('SERVER_REPLY_REQUEST_INVALID');
    return Object.freeze({version:1,mode:'readiness'});
  }
  if(value.mode!=='execute'||Object.keys(value).sort().join()!==
    'actionId,externalReviewId,fingerprint,idempotencyKey,mode,version'||
    typeof value.actionId!=='string'||!UUID.test(value.actionId)||
    typeof value.idempotencyKey!=='string'||!UUID.test(value.idempotencyKey)||
    typeof value.fingerprint!=='string'||!HEX64.test(value.fingerprint)||
    typeof value.externalReviewId!=='string'||!value.externalReviewId||value.externalReviewId.length>256)
    fail('SERVER_REPLY_REQUEST_INVALID');
  return Object.freeze({version:1,mode:'execute',actionId:value.actionId.toLowerCase(),
    externalReviewId:value.externalReviewId,fingerprint:value.fingerprint,
    idempotencyKey:value.idempotencyKey.toLowerCase()});
}

function systemdBase(user,group,unit){return [
  '--quiet','--wait','--collect','--pipe','--service-type=exec',`--unit=${unit}`,`--uid=${user}`,`--gid=${group}`,
  '-p','NoNewPrivileges=yes','-p','ProtectSystem=strict','-p','ProtectHome=yes',
  '-p','PrivateTmp=yes','-p','PrivateDevices=yes','-p','CapabilityBoundingSet='
]}
function writerArgs(request){
  const args=systemdBase('review-yandex-writer','review-yandex-writer',WRITER_UNIT);
  args.push('-p',request.mode==='readiness'?'PrivateNetwork=yes':'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    '-p','LoadCredential=yandex-session-key:/etc/review-activator-yandex/session-key.json',
    '-E','RA_RUNTIME_PROFILE=vps-lab');
  if(request.mode==='readiness'){
    args.push('-E','RA_YANDEX_MODE=read-only-admin','/opt/node/bin/node',
      '/opt/review-activator-reply/current/tools/vps14/writer-readiness.mjs');
  }else{
    args.push('-E','RA_YANDEX_MODE=reply-write-one-shot','-E','RA_YANDEX_REPLY_WRITE_ENABLED=true',
      '-E',`RA_STAGE9_ACTION_ID=${request.actionId}`,'-E',`RA_STAGE9_REVIEW_ID=${request.externalReviewId}`,
      '-E',`RA_STAGE9_FINGERPRINT=${request.fingerprint}`,'-E',`RA_STAGE9_IDEMPOTENCY_KEY=${request.idempotencyKey}`,
      '/opt/node/bin/node','/opt/review-activator-reply/current/tools/vps14/writer-approved-once.mjs');
  }
  return args;
}
function browserArgs(){
  const args=systemdBase('review-yandex-browser','review-yandex-browser',BROWSER_UNIT);
  args.push('-p','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    '-p','LoadCredential=yandex-session-key:/etc/review-activator-yandex/session-key.json',
    '-p','RuntimeDirectory=review-yandex-csrf','-p','RuntimeDirectoryMode=0700',
    '-E','RA_RUNTIME_PROFILE=vps-lab','-E','RA_YANDEX_MODE=read-only-admin',
    '-E','RA_YANDEX_BROWSER_BIN=/usr/bin/google-chrome-stable',
    '/opt/node/bin/node','/opt/review-activator-yandex-browser/current/tools/yandex-server-browser/browser-csrf-resolver.mjs');
  return args;
}

function cleanupUnits(){
  for(const unit of [BROWSER_UNIT,WRITER_UNIT]){
    try{spawnSync('/usr/bin/systemctl',['stop',unit],{stdio:'ignore',timeout:5000});}catch{}
    try{spawnSync('/usr/bin/systemctl',['reset-failed',unit],{stdio:'ignore',timeout:5000});}catch{}
  }
}
function startTransient(args){
  const child=spawn('/usr/bin/systemd-run',args,{
    env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']
  });
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();
  let stderr='';child.stderr.on('data',b=>{if(stderr.length<4096)stderr+=b.toString('utf8');});
  return {child,lines,getStderr:()=>stderr};
}
async function nextLine(proc,timeoutMs=20000,max=8192){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('SERVER_REPLY_TIMEOUT'),{code:'SERVER_REPLY_TIMEOUT'})),timeoutMs);});
  const result=await Promise.race([proc.lines.next(),timeout]).finally(()=>clearTimeout(timer));
  if(result.done||typeof result.value!=='string'||Buffer.byteLength(result.value,'utf8')>max)
    fail('SERVER_REPLY_PROTOCOL_INVALID');
  return result.value;
}
function parseJson(line,code='SERVER_REPLY_PROTOCOL_INVALID'){
  try{const value=JSON.parse(line);if(!value||typeof value!=='object'||Array.isArray(value))fail(code);return value;}
  catch(error){if(error?.code)throw error;fail(code);}
}
async function waitExit(proc,timeoutMs=10000){
  if(proc.child.exitCode!==null)return proc.child.exitCode;
  return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Object.assign(new Error('SERVER_REPLY_TIMEOUT'),{code:'SERVER_REPLY_TIMEOUT'})),timeoutMs);
    proc.child.once('close',code=>{clearTimeout(timer);resolve(code??1);});
  });
}
function validateHandoff(value,challenge){
  if(Object.keys(value).sort().join()!=='nonce,op,organizationId,token,version'||
     value.version!==1||value.op!=='csrf_handoff'||value.nonce!==challenge.nonce||
     value.organizationId!=='54309413522'||typeof value.token!=='string'||
     value.token.length<8||value.token.length>1024||!/^[\x21-\x7e]+$/.test(value.token))
    fail('SERVER_REPLY_CSRF_INVALID');
  return value;
}

function validateChallenge(value,{now=Date.now()}={}){
  if(Object.keys(value).sort().join()!=='expiresAt,nonce,version'||value.version!==1||
     typeof value.nonce!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value.nonce)||
     !Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+120000)
    fail('SERVER_REPLY_CHALLENGE_INVALID');
  return value;
}
function validateBrowserEvidence(value){
  if(value?.ok!==true||value.operation!=='server_csrf_resolver'||value.state!=='CSRF_READY'||
     value.organization_id!=='54309413522'||!Number.isSafeInteger(Number(value.session_revision))||
     Number(value.session_revision)<1||value.provider_requests!==1||value.provider_writes!==0||
     !Number.isSafeInteger(value.blocked_non_get)||value.blocked_non_get<0||
     value.reply_endpoint_attempts!==0||value.profile_persistent!==false)
    fail('SERVER_REPLY_BROWSER_EVIDENCE_INVALID');
  return value;
}
function validateWriterReady(value,request){
  if(value?.ok!==true||value.operation!=='csrf_ready'||value.state!=='CSRF_READY'||
     value.session_match!==true||value.action_binding!==true||value.provider_requests!==0||
     value.provider_writes!==0||value.queue_claims!==0)
    fail('SERVER_REPLY_WRITER_READY_INVALID');
  if(request.mode==='execute'&&value.action_id!==request.actionId)
    fail('SERVER_REPLY_WRITER_READY_INVALID');
  if(request.mode==='readiness'&&value.organization_id!=='54309413522')
    fail('SERVER_REPLY_WRITER_READY_INVALID');
  return value;
}
function safeFinal(value){
  if(!value||typeof value!=='object'||value.operation!=='approved_write')
    fail('SERVER_REPLY_FINAL_INVALID');
  if(value.ok===true&&value.status==='SENT'&&value.providerWrites===1)return value;
  if(value.providerWrites===0||value.providerWrites===1)return value;
  fail('SERVER_REPLY_FINAL_INVALID');
}

export async function orchestrateServerReply(request,{startProcess=startTransient,now=Date.now}={}){
  const exact=validateOrchestratorRequest(request);
  if(startProcess===startTransient)cleanupUnits();
  let writer=null,browser=null,handoffLine='',executionReleased=false;
  try{
    writer=startProcess(writerArgs(exact));
    const challenge=validateChallenge(parseJson(await nextLine(writer)),{now:now()});

    browser=startProcess(browserArgs());
    browser.child.stdin.write(JSON.stringify(challenge)+'\n');
    browser.child.stdin.end();
    handoffLine=await nextLine(browser,20000,4096);
    const handoff=validateHandoff(parseJson(handoffLine,'SERVER_REPLY_CSRF_INVALID'),challenge);
    const browserEvidence=validateBrowserEvidence(parseJson(await nextLine(browser,20000,4096)));
    const browserCode=await waitExit(browser,10000);
    if(browserCode!==0)fail('SERVER_REPLY_BROWSER_FAILED');

    writer.child.stdin.write(handoffLine+'\n');
    handoff.token='';handoffLine='';
    if(exact.mode==='readiness')writer.child.stdin.end();
    const ready=validateWriterReady(parseJson(await nextLine(writer,20000,4096)),exact);

    if(exact.mode==='readiness'){
      const writerCode=await waitExit(writer,10000);
      if(writerCode!==0)fail('SERVER_REPLY_WRITER_FAILED');
      return Object.freeze({
        ok:true,mode:'readiness',state:'SERVER_CSRF_READY',
        organization_id:'54309413522',session_revision:browserEvidence.session_revision,
        browser_provider_requests:1,writer_provider_requests:0,provider_writes:0,queue_claims:0,
        action_binding:ready.action_binding===true,session_match:ready.session_match===true,
        profile_persistent:false
      });
    }

    const execute={version:1,op:'execute',actionId:exact.actionId,
      fingerprint:exact.fingerprint,idempotencyKey:exact.idempotencyKey};
    executionReleased=true;
    writer.child.stdin.write(JSON.stringify(execute)+'\n');
    writer.child.stdin.end();
    const final=safeFinal(parseJson(await nextLine(writer,90000,8192),'SERVER_REPLY_FINAL_INVALID'));
    const writerCode=await waitExit(writer,10000);
    if(final.ok===true&&writerCode!==0)fail('SERVER_REPLY_FINAL_INVALID');
    return Object.freeze({
      ok:final.ok===true,mode:'execute',status:final.status,actionId:exact.actionId,
      providerWrites:Number(final.providerWrites??0),
      errorCode:final.errorCode??final.error??null,noRetry:true
    });
  }catch(error){
    if(executionReleased){
      return Object.freeze({ok:false,mode:'execute',status:'RECONCILIATION_REQUIRED',
        errorCode:'SERVER_REPLY_RESULT_UNKNOWN',providerWrites:1,noRetry:true});
    }
    throw error;
  }finally{
    handoffLine='';
    if(startProcess===startTransient)cleanupUnits();
    for(const proc of [browser,writer]){
      if(proc?.child&&proc.child.exitCode===null){try{proc.child.kill('SIGKILL');}catch{}}
    }
  }
}

async function readRequest(){
  const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
  const lines=[];let bytes=0;
  try{
    for await(const line of rl){
      bytes+=Buffer.byteLength(line,'utf8');
      if(bytes>4096||lines.length>0)fail('SERVER_REPLY_REQUEST_INVALID');
      lines.push(line);
    }
  }finally{rl.close();}
  if(lines.length!==1)fail('SERVER_REPLY_REQUEST_INVALID');
  return validateOrchestratorRequest(parseJson(lines[0],'SERVER_REPLY_REQUEST_INVALID'));
}

const SAFE_ERRORS=new Set([
  'SERVER_REPLY_REQUEST_INVALID','SERVER_REPLY_TIMEOUT','SERVER_REPLY_PROTOCOL_INVALID',
  'SERVER_REPLY_CHALLENGE_INVALID','SERVER_REPLY_CSRF_INVALID',
  'SERVER_REPLY_BROWSER_EVIDENCE_INVALID','SERVER_REPLY_BROWSER_FAILED',
  'SERVER_REPLY_WRITER_READY_INVALID','SERVER_REPLY_WRITER_FAILED',
  'SERVER_REPLY_FINAL_INVALID'
]);

if(import.meta.url===`file://${process.argv[1]}`){
  try{
    if(process.argv.length!==2||process.platform!=='linux'||userInfo().username!=='root')
      fail('SERVER_REPLY_REQUEST_INVALID');
    const request=await readRequest();
    const result=await orchestrateServerReply(request);
    process.stdout.write(JSON.stringify(result)+'\n');
    if(!result.ok)process.exitCode=1;
  }catch(error){
    process.stdout.write(JSON.stringify({ok:false,status:'BLOCKED',
      error:SAFE_ERRORS.has(error?.code)?error.code:'SERVER_REPLY_FAILED',
      providerWrites:0,noRetry:true})+'\n');
    process.exitCode=1;
  }
}
