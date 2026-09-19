import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';import {probe,HOST} from '../tools/vps09b/node-probe.mjs';
for(const mode of ['tcp','tls'])test(`VPS09B ${mode} fixed IP, port, no HTTP`,async()=>{
  const connect=o=>{assert.equal(o.host,'192.0.2.1');assert.equal(o.port,443);assert.equal(o.family,4);
    if(mode==='tls'){assert.equal(o.servername,HOST);assert.equal(o.rejectUnauthorized,true);}
    const s=new EventEmitter();s.authorized=true;s.remoteAddress='192.0.2.1';s.getProtocol=()=> 'TLSv1.3';s.destroy=()=>{};s.write=()=>assert.fail('NO_HTTP');
    queueMicrotask(()=>{s.emit('connect');if(mode==='tls')s.emit('secureConnect');});return s;};
  const r=await probe({mode,ip:'192.0.2.1'},{tcp:connect,ssl:connect});assert.equal(r.result,'PASS');assert.equal(r.http_requests,0);
});
for(const family of [0,4])test(`VPS09B family ${family} is diagnostic only`,async()=>{
 const r=await probe({mode:'family',family},{ssl:o=>{assert.equal(o.host,HOST);assert.equal(o.family,family||undefined);
  const s=new EventEmitter();s.destroy=()=>{};queueMicrotask(()=>s.emit('error',{code:'ENETUNREACH',message:'PRIVATE_SENTINEL'}));return s;}});
 assert.equal(r.diagnostic.category,'ROUTE_UNREACHABLE');assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SENTINEL/);
});
test('VPS09B TLS error is not misreported as TCP failure',async()=>{
 const r=await probe({mode:'tls',ip:'192.0.2.1'},{ssl:()=>{const s=new EventEmitter();s.destroy=()=>{};
  queueMicrotask(()=>{s.emit('connect');s.emit('error',{code:'CERT_HAS_EXPIRED'});});return s;}});
 assert.equal(r.tcp_connected,true);assert.equal(r.diagnostic.phase,'TLS_HANDSHAKE');assert.equal(r.diagnostic.category,'TLS_FAILED');
});
test('VPS09B rejects injected target/mode/family',async()=>{
 for(const input of [{mode:'tls',ip:'foreign.invalid'},{mode:'http'},{mode:'family',family:6},{mode:'tcp',ip:'::1'}])
 await assert.rejects(probe(input),/ARGUMENT_INVALID/);
});
test('VPS09B DNS output redacted to IP/family only',async()=>{
 const r=await probe({mode:'dns'},{lookup:async()=>[{address:'192.0.2.1',family:4,secret:'PRIVATE_SENTINEL'},{address:'bad',family:4}]});
 assert.deepEqual(r.addresses,[{address:'192.0.2.1',family:4}]);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SENTINEL/);
});
test('VPS09B probes cannot import auth/store/persistence or send HTTP',()=>{
 const s=readFileSync(new URL('../tools/vps09b/node-probe.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(s,/fetch\(|\.write\(|from ['"].*(?:node:https?|store|crypto|session\.mjs|service\.js)/);
 const p=readFileSync(new URL('../tools/vps09b/reliability.py',import.meta.url),'utf8');
 assert.match(p,/\(141,1\)/);assert.match(p,/-verify_hostname/);assert.doesNotMatch(p,/curl_easy_send|urlopen|requests\.get|Cookie|Authorization/);
});
test('VPS09B telemetry installer pins source and has no business invocation',()=>{
 const s=readFileSync(new URL('../tools/vps09b/deploy-telemetry.py',import.meta.url),'utf8');
 assert.match(s,/652fed6ab1dbae3dd05fae9dccbe1d02c78927f7/);
 assert.match(s,/assert all\(digest\(ROOT\/p\)==h for p,h in OLD\.items\(\)\)/);
 assert.match(s,/assert complete\[-1\]\['kind'\]=='complete'/);
 assert.match(s,/backup\.mkdir\(mode=0o700\)/);
 assert.doesNotMatch(s,/manual-first|manual-replay|mutable-full|curl|psql|systemctl','(?:start|restart)|KEYS_JSON|\.env/);
});
