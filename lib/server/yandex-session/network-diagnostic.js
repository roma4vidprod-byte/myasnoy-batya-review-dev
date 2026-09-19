// Fixed safe metadata only. Never read/return message, stack, URL or headers.
const codes = new Set(['EAI_AGAIN','ENOTFOUND','EAI_FAIL','EACCES','EPERM','EAFNOSUPPORT',
  'ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','EADDRNOTAVAIL','ETIMEDOUT','ECONNRESET',
  'EPIPE','ECONNABORTED','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN','ERR_SSL_WRONG_VERSION_NUMBER','ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE']);
const phases = new Set(['DNS','TCP_CONNECT','TLS_HANDSHAKE','REQUEST_HEADERS','RESPONSE_BODY']);
const own = (x,k) => {
  try { return x && typeof x==='object' ? Object.getOwnPropertyDescriptor(x,k)?.value : undefined; }
  catch { return undefined; }
};
export function safeNetworkDiagnostic(error,{phase,aborted=false}={}) {
  const seen=new Set(),found=[],queue=[error];
  while(queue.length && seen.size<12){
    const e=queue.shift();if(!e||typeof e!=='object'||seen.has(e))continue;seen.add(e);
    const code=own(e,'code');if(codes.has(code))found.push({code,syscall:own(e,'syscall')});
    const cause=own(e,'cause');if(cause)queue.push(cause);
    const children=own(e,'errors');if(Array.isArray(children))queue.push(...children.slice(0,8));
  }
  let category='NETWORK_UNKNOWN';
  const list=[...new Set(found.map(e=>e.code))];
  if(aborted===true)category='ABORT_TIMEOUT';
  else if(list.some(c=>['EAI_AGAIN','ENOTFOUND','EAI_FAIL'].includes(c)))category='DNS_FAILED';
  else if(list.some(c=>['EACCES','EPERM','EAFNOSUPPORT'].includes(c)))category='NETWORK_DENIED';
  else if(list.some(c=>['ENETUNREACH','EHOSTUNREACH'].includes(c)))category='ROUTE_UNREACHABLE';
  else if(list.some(c=>c.includes('CERT')||c.startsWith('ERR_SSL')||c.includes('ISSUER')||c.includes('SIGNATURE')))category='TLS_FAILED';
  else if(list.some(c=>['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(c)))category='TCP_CONNECT_TIMEOUT';
  else if(list.includes('UND_ERR_HEADERS_TIMEOUT'))category='RESPONSE_HEADERS_TIMEOUT';
  else if(list.includes('UND_ERR_BODY_TIMEOUT'))category='RESPONSE_BODY_TIMEOUT';
  else if(list.includes('ECONNRESET'))category='CONNECTION_RESET';
  else if(list.some(c=>['EPIPE','ECONNABORTED','UND_ERR_SOCKET'].includes(c)))category='CONNECTION_CLOSED';
  else if(list.includes('ECONNREFUSED'))category='CONNECTION_REFUSED';
  const syscall=found.map(e=>e.syscall).find(v=>['getaddrinfo','connect','read','write'].includes(v))??null;
  return Object.freeze({category,phase:phases.has(phase)?phase:'UNKNOWN',codes:list,syscall,
    hostname:'yandex.ru',aborted:aborted===true});
}
