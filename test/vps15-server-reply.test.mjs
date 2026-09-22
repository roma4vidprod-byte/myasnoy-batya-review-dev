import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validatePublicChallenge,validatePreloadResult,isMainEntrypoint as resolverIsMainEntrypoint} from '../tools/yandex-server-browser/browser-csrf-resolver.mjs';
import {validateOrchestratorRequest,orchestrateServerReply,isMainEntrypoint as orchestratorIsMainEntrypoint} from '../tools/vps15/server-reply-orchestrator.mjs';

const resolver=readFileSync(new URL('../tools/yandex-server-browser/browser-csrf-resolver.mjs',import.meta.url),'utf8');
const orchestrator=readFileSync(new URL('../tools/vps15/server-reply-orchestrator.mjs',import.meta.url),'utf8');
const nonce='A'.repeat(43)+'=';
const challenge={version:1,nonce,expiresAt:61000};
const handoff={version:1,op:'csrf_handoff',nonce,organizationId:'54309413522',token:'SYNTHETIC_CSRF_TOKEN'};
const browserEvidence={ok:true,operation:'server_csrf_resolver',state:'CSRF_READY',
  organization_id:'54309413522',session_revision:6,provider_requests:1,provider_writes:0,
  blocked_requests:4,blocked_non_get:2,reply_endpoint_attempts:0,profile_persistent:false};

function fakeProc(lines,{throwAt=-1}={}){
  let index=0;const writes=[];
  return {
    child:{
      stdin:{write:value=>{writes.push(String(value));return true;},end:()=>{}},
      exitCode:0,kill:()=>{}
    },
    lines:{async next(){
      if(index===throwAt){index++;throw Object.assign(new Error('synthetic disconnect'),{code:'SYNTHETIC'});}
      if(index>=lines.length)return {done:true};
      return {done:false,value:lines[index++]};
    }},
    getStderr:()=>'',writes
  };
}

test('Stage15 browser resolver validates challenge and preload token binding',()=>{
  assert.deepEqual(validatePublicChallenge(challenge,{now:1000}),challenge);
  assert.equal(validatePreloadResult({token:'TOKEN_12345678',permanentId:'54309413522'}),'TOKEN_12345678');
  assert.throws(()=>validatePublicChallenge({...challenge,expiresAt:1000},{now:1000}),/SERVER_CSRF_CHALLENGE_INVALID/);
  assert.throws(()=>validatePreloadResult({token:'TOKEN_12345678',permanentId:'999'}),/SERVER_CSRF_VALUE_INVALID/);
});

test('Stage15 browser resolver is exact page GET-only and never calls reply endpoint',()=>{
  assert.match(resolver,/\/sprav\/\$\{ORG\}\/p\/edit\/reviews\//);
  assert.match(resolver,/method==='GET'&&url===PAGE/);
  assert.match(resolver,/Fetch\.failRequest/);
  assert.match(resolver,/Runtime\.evaluate/);
  assert.match(resolver,/__PRELOAD_DATA/);
  assert.doesNotMatch(resolver,/method\s*:\s*['"]POST['"]/);
  assert.doesNotMatch(resolver,/--no-sandbox|remote-debugging-port/);
});

test('Stage15 request validation separates readiness from exact execute',()=>{
  assert.deepEqual(validateOrchestratorRequest({version:1,mode:'readiness'}),{version:1,mode:'readiness'});
  const exact=validateOrchestratorRequest({version:1,mode:'execute',
    actionId:'11111111-1111-4111-8111-111111111111',externalReviewId:'review-1',
    fingerprint:'a'.repeat(64),idempotencyKey:'22222222-2222-4222-8222-222222222222'});
  assert.equal(exact.mode,'execute');assert.equal(exact.externalReviewId,'review-1');
  assert.throws(()=>validateOrchestratorRequest({version:1,mode:'readiness',actionId:'x'}),/SERVER_REPLY_REQUEST_INVALID/);
});

test('Stage15 readiness completes server-browser handoff with zero claim and zero write',async()=>{
  const writerReady={ok:true,operation:'csrf_ready',state:'CSRF_READY',organization_id:'54309413522',
    session_match:true,action_binding:true,csrf_present:true,csrf_length:20,provider_requests:0,provider_writes:0,queue_claims:0};
  let calls=0;const procs=[];
  const startProcess=args=>{
    calls++;
    if(calls===1){
      assert.ok(args.some(x=>String(x).includes('writer-readiness.mjs')));
      const p=fakeProc([JSON.stringify(challenge),JSON.stringify(writerReady)]);procs.push(p);return p;
    }
    assert.ok(args.some(x=>String(x).includes('browser-csrf-resolver.mjs')));
    const p=fakeProc([JSON.stringify(handoff),JSON.stringify(browserEvidence)]);procs.push(p);return p;
  };
  const result=await orchestrateServerReply({version:1,mode:'readiness'},{startProcess,now:()=>1000});
  assert.equal(result.ok,true);assert.equal(result.state,'SERVER_CSRF_READY');
  assert.equal(result.browser_provider_requests,1);
  assert.equal(result.writer_provider_requests,0);
  assert.equal(result.provider_writes,0);
  assert.equal(result.queue_claims,0);
  assert.equal(result.action_binding,true);assert.equal(result.session_match,true);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_CSRF_TOKEN'),false);
  assert.equal(procs[0].writes.length,1);
  assert.match(procs[0].writes[0],/SYNTHETIC_CSRF_TOKEN/);
});

test('Stage15 execute uncertainty is reconciliation-only and never retry',async()=>{
  const request={version:1,mode:'execute',
    actionId:'11111111-1111-4111-8111-111111111111',externalReviewId:'review-1',
    fingerprint:'a'.repeat(64),idempotencyKey:'22222222-2222-4222-8222-222222222222'};
  const writerReady={ok:true,operation:'csrf_ready',state:'CSRF_READY',
    action_id:request.actionId,session_match:true,action_binding:true,
    provider_requests:0,provider_writes:0,queue_claims:0};
  let calls=0;const procs=[];
  const startProcess=args=>{
    calls++;
    if(calls===1){
      assert.ok(args.some(x=>String(x).includes('writer-approved-once.mjs')));
      assert.ok(args.includes('RA_YANDEX_REPLY_WRITE_ENABLED=true'));
      const p=fakeProc([JSON.stringify(challenge),JSON.stringify(writerReady)],{throwAt:2});procs.push(p);return p;
    }
    const p=fakeProc([JSON.stringify(handoff),JSON.stringify(browserEvidence)]);procs.push(p);return p;
  };
  const result=await orchestrateServerReply(request,{startProcess,now:()=>1000});
  assert.deepEqual(result,{ok:false,mode:'execute',status:'RECONCILIATION_REQUIRED',
    errorCode:'SERVER_REPLY_RESULT_UNKNOWN',providerWrites:1,noRetry:true});
  assert.equal(procs[0].writes.length,2);
  assert.match(procs[0].writes[1],/"op":"execute"/);
});

test('Stage15 source keeps browser and writer roles separated and contains no client-laptop bridge',()=>{
  assert.match(orchestrator,/review-yandex-browser/);
  assert.match(orchestrator,/review-yandex-writer/);
  assert.match(orchestrator,/writer-readiness\.mjs/);
  assert.match(orchestrator,/writer-approved-once\.mjs/);
  assert.match(orchestrator,/SERVER_REPLY_RESULT_UNKNOWN/);
  assert.doesNotMatch(orchestrator,/ssh2|NamedPipe|connectNative|C:\\\\Users\\/);
});

test('Stage15 CLI entry guards resolve current symlinks to immutable release paths',()=>{
  const resolverUrl=new URL('../tools/yandex-server-browser/browser-csrf-resolver.mjs',import.meta.url);
  const orchestratorUrl=new URL('../tools/vps15/server-reply-orchestrator.mjs',import.meta.url);
  assert.equal(resolverIsMainEntrypoint(resolverUrl.href,'/opt/review-activator-yandex-browser/current/tools/yandex-server-browser/browser-csrf-resolver.mjs',
    {realpath:()=>fileURLToPath(resolverUrl)}),true);
  assert.equal(orchestratorIsMainEntrypoint(orchestratorUrl.href,'/opt/review-activator-server-reply/current/tools/vps15/server-reply-orchestrator.mjs',
    {realpath:()=>fileURLToPath(orchestratorUrl)}),true);
  assert.equal(orchestratorIsMainEntrypoint(orchestratorUrl.href,'/wrong/current',
    {realpath:()=>fileURLToPath(resolverUrl)}),false);
  assert.match(resolver,/realpathSync/);
  assert.match(orchestrator,/realpathSync/);
  assert.doesNotMatch(resolver,/import\.meta\.url===\x60file:\/\/\$\{process\.argv\[1\]\}\x60/);
  assert.doesNotMatch(orchestrator,/import\.meta\.url===\x60file:\/\/\$\{process\.argv\[1\]\}\x60/);
});
