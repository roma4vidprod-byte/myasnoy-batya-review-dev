// Diagnostic only: fixed hostname, DNS/TCP/TLS, no HTTP or application imports.
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import {pathToFileURL} from 'node:url';
import {safeNetworkDiagnostic} from '../../lib/server/yandex-session/network-diagnostic.js';
export const HOST='yandex.ru';
export const TIMEOUT=10000;
export async function probe(input,{tcp=net.connect,ssl=tls.connect,lookup=dns.promises.lookup}={}) {
  const {mode,ip,family}=input??{};
  if(!['dns','tcp','tls','family'].includes(mode)||
    (['tcp','tls'].includes(mode)&&net.isIP(ip)!==4)||
    (mode==='family'&&![0,4].includes(family)))throw Error('DIAGNOSTIC_ARGUMENT_INVALID');
  if(mode==='dns'){
    let timer;const start=performance.now();
    try{const addresses=await Promise.race([lookup(HOST,{all:true}),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(Error(),{code:'EAI_AGAIN'})),2000);
    })]);return {result:'PASS',elapsed_ms:Math.round(performance.now()-start),
      addresses:addresses.filter(e=>net.isIP(e.address)===e.family).map(e=>({address:e.address,family:e.family}))};
    }catch(e){return {result:'FAIL',diagnostic:safeNetworkDiagnostic(e,{phase:'DNS'})};}finally{clearTimeout(timer);}
  }
  return new Promise(resolve=>{
    const start=performance.now(),secure=mode!=='tcp',events=[];let socket,done=false,tcpMs=null;
    const elapsed=()=>Math.round(performance.now()-start);
    const finish=(ok,error,expired=false)=>{
      if(done)return;done=true;clearTimeout(timer);
      const phase=tcpMs===null?'TCP_CONNECT':'TLS_HANDSHAKE';
      const r={result:ok?'PASS':'FAIL',tcp_connected:tcpMs!==null,tcp_ms:tcpMs,elapsed_ms:elapsed(),
        selected_ip:net.isIP(socket?.remoteAddress)?socket.remoteAddress:null,
        tls:secure,tls_version:secure&&ok?socket.getProtocol():null,certificate_valid:secure&&ok?socket.authorized===true:null,
        timeout_phase:expired?phase:null,diagnostic:ok?null:safeNetworkDiagnostic(error,{phase,aborted:expired}),events,http_requests:0};
      socket?.destroy();resolve(r);
    };
    const timer=setTimeout(()=>finish(false,null,true),TIMEOUT);
    try{
      const opts={host:mode==='family'?HOST:ip,port:443,
        ...(mode==='family'?(family===4?{family:4}:{}):{family:4}),
        ...(secure?{servername:HOST,rejectUnauthorized:true}:{})};
      socket=(secure?ssl:tcp)(opts);
      for(const event of ['connectionAttempt','connectionAttemptFailed','connectionAttemptTimeout'])socket.on(event,(address,port,fam,error)=>{
        if(events.length<16&&net.isIP(address))events.push({event,ip:address,family:fam,elapsed_ms:elapsed(),
          ...(error?{diagnostic:safeNetworkDiagnostic(error,{phase:'TCP_CONNECT'})}:{})});
      });
      socket.once('connect',()=>{tcpMs=elapsed();if(!secure)finish(true);});
      if(secure)socket.once('secureConnect',()=>finish(socket.authorized===true));
      socket.once('error',e=>finish(false,e));
    }catch(e){finish(false,e);}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==2||process.platform!=='linux')throw Error();
    let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>512)throw Error();}
    console.log(JSON.stringify(await probe(JSON.parse(raw))));
  }catch{console.log(JSON.stringify({result:'FAIL',error:'DIAGNOSTIC_CONTEXT_INVALID'}));process.exitCode=1;}
}
