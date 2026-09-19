// No HTTP, credentials, session/RPC/provider imports or retry. Only bounded
// DNS plus TCP/TLS handshakes to the existing transport's fixed hostname.
import dns from 'node:dns';import net from 'node:net';import tls from 'node:tls';
import {readFileSync,readlinkSync} from 'node:fs';import {userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {safeNetworkDiagnostic} from '../../lib/server/yandex-session/network-diagnostic.js';
export const HOST='yandex.ru';export const TIMEOUT_MS=5000;
export const PROXY_NAMES=['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','ALL_PROXY','http_proxy','https_proxy',
 'no_proxy','all_proxy','NODE_USE_ENV_PROXY','NODE_OPTIONS','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'];
export function socketProbe({address=HOST,family,secure=false,connect=net.connect,tlsConnect=tls.connect}={}){
 if(address!==HOST&&!net.isIP(address))throw Error('DIAGNOSTIC_DESTINATION_DENIED');
 return new Promise(resolve=>{
  const start=performance.now();let done=false,connected=false,socket;
  const phase=()=>secure&&connected?'TLS_HANDSHAKE':'TCP_CONNECT';
  const finish=(ok,error,timeout=false)=>{
   if(done)return;done=true;clearTimeout(timer);
   const r={result:ok?'PASS':'FAIL',family:family??'AUTO',elapsed_ms:Math.round(performance.now()-start),
    tcp_connected:connected,tls:secure,authorized:secure&&ok?socket.authorized===true:null,
    timeout_phase:timeout?phase():null,diagnostic:ok?null:safeNetworkDiagnostic(error,{phase:phase(),aborted:timeout})};
   socket?.destroy();resolve(r);
  };
  const timer=setTimeout(()=>finish(false,null,true),TIMEOUT_MS);
  try{
   const opts={host:address,port:443,...(family?{family}:{}),...(secure?{servername:HOST,rejectUnauthorized:true}:{})};
   socket=(secure?tlsConnect:connect)(opts);
   socket.once('connect',()=>{connected=true;if(!secure)finish(true);});
   if(secure)socket.once('secureConnect',()=>finish(socket.authorized===true));
   socket.once('error',e=>finish(false,e));
  }catch(e){finish(false,e);}
 });
}
const safeRead=fn=>{try{return fn();}catch{return 'UNAVAILABLE';}};
export async function main(){
 const report={hostname:HOST,http_requests:0,credentials_loaded:false,utc:new Date().toISOString(),
  node:process.version,undici:process.versions.undici,user:userInfo().username,uid:userInfo().uid,cwd:process.cwd(),
  netns:safeRead(()=>readlinkSync('/proc/self/ns/net')),cgroup:safeRead(()=>readFileSync('/proc/self/cgroup','utf8').trim()),
  no_new_privileges:safeRead(()=>/^NoNewPrivs:\s*(\d+)/m.exec(readFileSync('/proc/self/status','utf8'))?.[1]??null),
  proxy_presence:Object.fromEntries(PROXY_NAMES.map(k=>[k,Boolean(process.env[k])])),
  dns_order:dns.getDefaultResultOrder(),auto_select_family:net.getDefaultAutoSelectFamily(),
  auto_select_family_attempt_timeout_ms:net.getDefaultAutoSelectFamilyAttemptTimeout(),
  timeout_per_probe_ms:TIMEOUT_MS,ca_count:tls.getCACertificates('default').length,probes:[]};
 let timer;
 try{
  const found=await Promise.race([dns.promises.lookup(HOST,{all:true}),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Object.assign(Error('DNS_TIMEOUT'),{code:'EAI_AGAIN'})),TIMEOUT_MS);
  })]);clearTimeout(timer);
  const addresses=found.filter(e=>net.isIP(e.address)===e.family).slice(0,16);
  report.dns={result:'PASS',addresses};
  for(const family of [4,6]){
   const address=addresses.find(e=>e.family===family)?.address;
   if(!address){report.probes.push({family,result:'NOT_AVAILABLE'});continue;}
   for(const secure of [false,true])report.probes.push(await socketProbe({address,family,secure}));
  }
 }catch(error){clearTimeout(timer);report.dns={result:'FAIL',diagnostic:safeNetworkDiagnostic(error,{phase:'DNS'})};}
 // Exact Node default family selection, no HTTP request/body is ever sent.
 report.probes.push(await socketProbe({secure:true}));
 console.log(JSON.stringify(report));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==2||process.platform!=='linux'){console.log(JSON.stringify({error:'DIAGNOSTIC_CONTEXT_DENIED'}));process.exitCode=1;}
 else await main();
}
