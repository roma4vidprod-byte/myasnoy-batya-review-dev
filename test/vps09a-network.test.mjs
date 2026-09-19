import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {safeNetworkDiagnostic} from '../lib/server/yandex-session/network-diagnostic.js';
import {socketProbe,HOST} from '../tools/vps09a/network.mjs';
for(const [code,category]of Object.entries({ENOTFOUND:'DNS_FAILED',EAI_AGAIN:'DNS_FAILED',EACCES:'NETWORK_DENIED',
 EPERM:'NETWORK_DENIED',EAFNOSUPPORT:'NETWORK_DENIED',ENETUNREACH:'ROUTE_UNREACHABLE',
 UND_ERR_CONNECT_TIMEOUT:'TCP_CONNECT_TIMEOUT',ECONNRESET:'CONNECTION_RESET',
 ERR_TLS_CERT_ALTNAME_INVALID:'TLS_FAILED',CERT_HAS_EXPIRED:'TLS_FAILED',
 UND_ERR_HEADERS_TIMEOUT:'RESPONSE_HEADERS_TIMEOUT',UND_ERR_BODY_TIMEOUT:'RESPONSE_BODY_TIMEOUT'})){
 test('safe network cause '+code,()=>assert.equal(safeNetworkDiagnostic({cause:{code}},{phase:'REQUEST_HEADERS'}).category,category));
}
test('timeout phase remains explicit without invented OS error',()=>{
 const r=safeNetworkDiagnostic({}, {phase:'RESPONSE_BODY',aborted:true});assert.equal(r.category,'ABORT_TIMEOUT');assert.deepEqual(r.codes,[]);
});
test('raw message/URL/headers/unknown properties never escape, getters not evaluated',()=>{
 const e={message:'SYNTHETIC_SECRET',url:'SYNTHETIC_SECRET',headers:{Cookie:'SYNTHETIC_SECRET'},code:'SYNTHETIC_SECRET',syscall:'SYNTHETIC_SECRET'};
 Object.defineProperty(e,'cause',{get(){throw Error('SYNTHETIC_SECRET');}});
 const s=JSON.stringify(safeNetworkDiagnostic(e,{phase:'SYNTHETIC_SECRET'}));assert.doesNotMatch(s,/SYNTHETIC_SECRET/);assert.match(s,/NETWORK_UNKNOWN/);
});
test('nested aggregate bounded, cyclic cause accepted safely',()=>{
 const e={errors:[{code:'ENETUNREACH'},{code:'ETIMEDOUT',syscall:'connect'}]};e.cause=e;
 const r=safeNetworkDiagnostic(e);assert.deepEqual(r.codes,['ENETUNREACH','ETIMEDOUT']);assert.equal(r.syscall,'connect');
});
test('diagnostic TLS sends no application data and validates fixed SNI',async()=>{
 let destroyed=0;
 const r=await socketProbe({secure:true,tlsConnect:o=>{assert.equal(o.host,HOST);assert.equal(o.port,443);assert.equal(o.servername,HOST);assert.equal(o.rejectUnauthorized,true);
  const s=new EventEmitter();s.authorized=true;s.destroy=()=>destroyed++;s.write=()=>assert.fail('no HTTP data');
  queueMicrotask(()=>{s.emit('connect');s.emit('secureConnect');});return s;}});
 assert.equal(r.result,'PASS');assert.equal(destroyed,1);
});
test('diagnostic OS error safe and no retry',async()=>{
 let calls=0;const r=await socketProbe({connect:()=>{calls++;const s=new EventEmitter();s.destroy=()=>{};queueMicrotask(()=>s.emit('error',{code:'EACCES',message:'SYNTHETIC_SECRET'}));return s;}});
 assert.equal(calls,1);assert.equal(r.diagnostic.category,'NETWORK_DENIED');assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_SECRET/);
});
test('diagnostic rejects foreign hostname before socket',()=>assert.throws(()=>socketProbe({address:'not-authorized.invalid'}),/DESTINATION_DENIED/));
test('diagnostic graph has no HTTP/session/store/writer imports',()=>{
 const s=readFileSync(new URL('../tools/vps09a/network.mjs',import.meta.url),'utf8');assert.doesNotMatch(s,/from ['"].*(?:https?|crypto|store|service|session\.mjs|review-persistence)/);
 assert.doesNotMatch(s,/fetch\(|\.request\(|\.write\(|Cookie:|Authorization:/);
});
